#!/usr/bin/env python3
import functools
import http.server
import json
import re
import socketserver
import tempfile
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
DIST = ROOT / "web" / "dist"
FIXTURE = ROOT / "tests" / "generated" / "en-ro-e2e"
SRT_IN = FIXTURE / "target.rum.srt"
MKV_IN = FIXTURE / "reference-english.mkv"
RESULT = ROOT / "tests" / "generated" / "mobile-webkit-primary-workflow.json"
SAVED = ROOT / "tests" / "generated" / "mobile-webkit-output.srt"

for path in (SRT_IN, MKV_IN):
    if not path.is_file() or path.stat().st_size == 0:
        raise SystemExit(f"Missing mobile fixture: {path.relative_to(ROOT)}")

def parse_srt_start(text):
    match = re.search(r"(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->", text)
    if not match:
        raise SystemExit("Could not parse first SRT timestamp")
    h, m, s, ms = map(int, match.groups())
    return h * 3600 + m * 60 + s + ms / 1000.0

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

pages_root_ctx = tempfile.TemporaryDirectory(prefix="subsync2-webkit-")
pages_root = Path(pages_root_ctx.name)
pages_base = "subsync-web-enhanced"
(pages_root / pages_base).symlink_to(DIST, target_is_directory=True)

handler = functools.partial(QuietHandler, directory=str(pages_root))
server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler)
server.daemon_threads = True
threading.Thread(target=server.serve_forever, daemon=True).start()
url = f"http://127.0.0.1:{server.server_address[1]}/{pages_base}/"

diagnostics = {
    "url": url,
    "browser": "webkit",
    "deviceProfile": "iPhone 14",
    "status": "running",
    "consoleErrors": [],
    "pageErrors": [],
    "httpFailures": [],
}

try:
    with sync_playwright() as p:
        browser = p.webkit.launch(headless=True)
        device = dict(p.devices["iPhone 14"])
        context = browser.new_context(**device, accept_downloads=True)
        page = context.new_page()

        page.on("console", lambda msg: diagnostics["consoleErrors"].append(msg.text) if msg.type == "error" else None)
        page.on("pageerror", lambda exc: diagnostics["pageErrors"].append(str(exc)))
        page.on("response", lambda response: diagnostics["httpFailures"].append({
            "status": response.status,
            "url": response.url,
        }) if response.status >= 400 else None)

        page.goto(url, wait_until="load")
        page.wait_for_selector("#subsync_app", timeout=30_000)

        diagnostics["initialText"] = page.locator("#subsync_app").inner_text()
        diagnostics["navigator"] = page.evaluate("""() => ({
          userAgent: navigator.userAgent,
          platform: navigator.platform,
          maxTouchPoints: navigator.maxTouchPoints,
          webAssembly: typeof WebAssembly !== 'undefined',
          worker: typeof Worker !== 'undefined',
          indexedDB: typeof indexedDB !== 'undefined',
          serviceWorker: 'serviceWorker' in navigator,
        })""")

        if "Browser not supported" in diagnostics["initialText"]:
            diagnostics["status"] = "unsupported"
            raise SystemExit("WebKit/iPhone capability probe rejected the browser")

        sw_ready = page.evaluate("""async () => {
          if (!('serviceWorker' in navigator)) return false;
          try {
            await Promise.race([
              navigator.serviceWorker.ready,
              new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000))
            ]);
            return true;
          } catch (_) {
            return false;
          }
        }""")
        diagnostics["serviceWorkerReady"] = sw_ready

        sub_input = page.locator('input[name="streams-group-sub-file"]')
        ref_input = page.locator('input[name="streams-group-ref-file"]')

        sub_input.set_input_files(str(SRT_IN))
        sub_group = sub_input.locator("xpath=..")
        sub_group.locator('input[type="radio"]').first.wait_for(state="attached", timeout=90_000)
        sub_group.locator("select").first.select_option("rum")

        ref_input.set_input_files(str(MKV_IN))
        ref_group = ref_input.locator("xpath=..")
        ref_group.locator('input[type="radio"]').first.wait_for(state="attached", timeout=90_000)
        ref_group.locator("select").first.select_option("eng")

        diagnostics["inputsLoaded"] = True
        page.get_by_role("button", name="Start", exact=True).click()

        page.wait_for_function(
            """() => {
              const text = document.querySelector('#subsync_app')?.innerText || '';
              return [
                'Subtitles synchronized',
                'No need to synchronize',
                "Couldn't synchronize",
                'Synchronization inconclusive',
                'Synchronization terminated'
              ].some(value => text.includes(value));
            }""",
            timeout=300_000,
        )

        app_text = page.locator("#subsync_app").inner_text()
        diagnostics["syncText"] = app_text
        if "Subtitles synchronized" not in app_text:
            diagnostics["status"] = "sync-failed"
            raise SystemExit("WebKit PWA did not report successful subtitle synchronization")

        page.get_by_text("Show details", exact=True).click()
        strong = page.locator("#subsync_app").locator("strong")
        diagnostics["pointsText"] = strong.nth(1).inner_text()
        diagnostics["correlationText"] = strong.nth(2).inner_text()
        diagnostics["formulaText"] = strong.nth(3).inner_text()
        diagnostics["maxChangeText"] = strong.nth(4).inner_text()

        save_button = page.get_by_role("button", name="Save subtitles", exact=True)
        if save_button.is_disabled():
            raise SystemExit("WebKit save button remained disabled")
        save_button.click()

        popup = page.locator("#subsync_app .popup").last
        popup.wait_for(state="visible", timeout=15_000)
        diagnostics["savePopupText"] = popup.inner_text()
        format_links = popup.locator("a:not(.popup_close)")
        if format_links.count() < 1:
            raise SystemExit("WebKit save popup exposed no subtitle format link")

        with page.expect_download(timeout=30_000) as download_info:
            format_links.first.click()
        download = download_info.value
        diagnostics["downloadSuggestedFilename"] = download.suggested_filename
        download.save_as(str(SAVED))

        original_text = SRT_IN.read_text(encoding="utf-8")
        output_text = SAVED.read_text(encoding="utf-8")
        original_start = parse_srt_start(original_text)
        output_start = parse_srt_start(output_text)
        shift = output_start - original_start

        diagnostics["savedTimingShiftSeconds"] = shift
        diagnostics["savedBytes"] = SAVED.stat().st_size

        if not (-9.5 <= shift <= -6.0):
            raise SystemExit(f"WebKit saved timing correction out of range: {shift:.3f}s")

        for token in ("împreună", "înțelege", "poliție", "greșit", "mulțumesc", "întrebare"):
            if token not in output_text:
                raise SystemExit(f"WebKit saved SRT lost Romanian token: {token}")

        if diagnostics["consoleErrors"] or diagnostics["pageErrors"] or diagnostics["httpFailures"]:
            raise SystemExit("WebKit PWA emitted browser/runtime errors")

        diagnostics["status"] = "pass"
        print(json.dumps(diagnostics, indent=2, ensure_ascii=False))
        context.close()
        browser.close()
finally:
    RESULT.parent.mkdir(parents=True, exist_ok=True)
    RESULT.write_text(json.dumps(diagnostics, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    server.shutdown()
    server.server_close()
    pages_root_ctx.cleanup()
