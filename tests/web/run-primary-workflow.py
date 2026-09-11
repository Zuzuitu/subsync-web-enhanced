#!/usr/bin/env python3
import functools
import http.server
import json
import os
import re
import shutil
import socketserver
import threading
import tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
DIST = ROOT / "web" / "dist"
FIXTURE = ROOT / "tests" / "generated" / "en-ro-e2e"
SRT_IN = FIXTURE / "target.rum.srt"
MKV_IN = FIXTURE / "reference-english.mkv"
BROWSER_ENGINE = os.environ.get("BROWSER_ENGINE", "chromium").lower()
if BROWSER_ENGINE not in {"chromium", "webkit"}:
    raise SystemExit(f"Unsupported BROWSER_ENGINE: {BROWSER_ENGINE}")

suffix = "" if BROWSER_ENGINE == "chromium" else f"-{BROWSER_ENGINE}"
RESULT = ROOT / "tests" / "generated" / f"web-primary-workflow{suffix}.json"
SAVED = ROOT / "tests" / "generated" / f"web-primary-workflow-output{suffix}.srt"

for path in (SRT_IN, MKV_IN):
    if not path.is_file() or path.stat().st_size == 0:
        raise SystemExit(f"Missing primary-workflow fixture: {path.relative_to(ROOT)}")

def parse_srt_start(text):
    match = re.search(r"(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->", text)
    if not match:
        raise SystemExit("Could not parse first SRT timestamp")
    h, m, s, ms = map(int, match.groups())
    return h * 3600 + m * 60 + s + ms / 1000.0

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

pages_root_ctx = tempfile.TemporaryDirectory(prefix="subsync2-pages-")
pages_root = Path(pages_root_ctx.name)
pages_base = "subsync-web-enhanced"
(pages_root / pages_base).symlink_to(DIST, target_is_directory=True)

handler = functools.partial(QuietHandler, directory=str(pages_root))
server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler)
server.daemon_threads = True
threading.Thread(target=server.serve_forever, daemon=True).start()

browser_path = None
if BROWSER_ENGINE == "chromium":
    browser_path = (
        shutil.which("google-chrome")
        or shutil.which("google-chrome-stable")
        or shutil.which("chromium")
        or shutil.which("chromium-browser")
    )
url = f"http://127.0.0.1:{server.server_address[1]}/{pages_base}/"

try:
    with sync_playwright() as p:
        browser_type = getattr(p, BROWSER_ENGINE)
        launch = {"headless": True}
        if BROWSER_ENGINE == "chromium":
            launch["args"] = ["--no-sandbox", "--disable-dev-shm-usage"]
            if browser_path:
                launch["executable_path"] = browser_path

        browser = browser_type.launch(**launch)
        context = browser.new_context(accept_downloads=True)
        page = context.new_page()

        console_errors = []
        page_errors = []
        http_failures = []
        page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
        page.on("pageerror", lambda exc: page_errors.append(str(exc)))
        page.on("response", lambda response: http_failures.append({
            "status": response.status,
            "url": response.url,
        }) if response.status >= 400 else None)

        page.goto(url, wait_until="load")
        page.wait_for_selector("#subsync_app", timeout=30_000)

        sub_input = page.locator('input[name="streams-group-sub-file"]')
        ref_input = page.locator('input[name="streams-group-ref-file"]')

        sub_input.set_input_files(str(SRT_IN))
        sub_group = sub_input.locator("xpath=..")
        sub_group.locator('input[type="radio"]').first.wait_for(state="attached", timeout=60_000)
        sub_selects = sub_group.locator("select")
        sub_selects.first.select_option("rum")

        ref_input.set_input_files(str(MKV_IN))
        ref_group = ref_input.locator("xpath=..")
        ref_group.locator('input[type="radio"]').first.wait_for(state="attached", timeout=60_000)
        ref_selects = ref_group.locator("select")
        ref_selects.first.select_option("eng")

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
            timeout=240_000,
        )

        app_text = page.locator("#subsync_app").inner_text()
        if "Subtitles synchronized" not in app_text:
            raise SystemExit("Built PWA did not report successful subtitle synchronization")

        page.get_by_text("Show details", exact=True).click()
        points = page.locator("#subsync_app").locator("strong").nth(1).inner_text()
        correlation = page.locator("#subsync_app").locator("strong").nth(2).inner_text()
        formula = page.locator("#subsync_app").locator("strong").nth(3).inner_text()
        max_change = page.locator("#subsync_app").locator("strong").nth(4).inner_text()

        save_button = page.get_by_role("button", name="Save subtitles", exact=True)
        if save_button.is_disabled():
            raise SystemExit("Save subtitles stayed disabled after successful synchronization")
        save_button.click()

        popup = page.locator("#subsync_app .popup").last
        try:
            popup.wait_for(state="visible", timeout=10_000)
        except Exception as exc:
            diagnostics = {
                "reason": "save-popup-not-visible",
                "exception": str(exc),
                "consoleErrors": console_errors,
                "pageErrors": page_errors,
                "httpFailures": http_failures,
                "appText": page.locator("#subsync_app").inner_text(),
                "bodyText": page.locator("body").inner_text(),
            }
            RESULT.parent.mkdir(parents=True, exist_ok=True)
            RESULT.write_text(
                json.dumps(diagnostics, indent=2, ensure_ascii=False) + "\n",
                encoding="utf-8",
            )
            print(json.dumps(diagnostics, indent=2, ensure_ascii=False))
            raise
        popup_text = popup.inner_text()
        format_links = popup.locator("a:not(.popup_close)")
        if format_links.count() < 1:
            raise SystemExit(
                "Save subtitles popup did not expose any output format; popup text: "
                + popup_text
            )

        with page.expect_download(timeout=30_000) as download_info:
            format_links.first.click()
        download = download_info.value
        suggested_filename = download.suggested_filename
        download.save_as(str(SAVED))

        original_text = SRT_IN.read_text(encoding="utf-8")
        output_text = SAVED.read_text(encoding="utf-8")
        original_start = parse_srt_start(original_text)
        output_start = parse_srt_start(output_text)
        shift = output_start - original_start

        if not (-9.5 <= shift <= -6.0):
            raise SystemExit(
                f"Saved SRT timing correction out of expected range: {shift:.3f}s"
            )

        romanian_tokens = [
            "mereu",
            "deoarece",
            "prieten",
            "oameni",
            "împreună",
            "înțelege",
            "dimineață",
            "părinte",
            "poliție",
            "greșit",
            "niciodată",
            "mulțumesc",
            "întrebare",
            "așteptare",
        ]
        missing_tokens = [token for token in romanian_tokens if token not in output_text]
        if missing_tokens:
            raise SystemExit(
                "Saved SRT lost Romanian text/diacritics: " + ", ".join(missing_tokens)
            )

        details = {
            "url": url,
            "pagesBasePath": "/" + pages_base + "/",
            "browserEngine": BROWSER_ENGINE,
            "browserExecutable": browser_path or f"playwright-bundled-{BROWSER_ENGINE}",
            "status": "pass",
            "pointsText": points,
            "correlationText": correlation,
            "formulaText": formula,
            "maxChangeText": max_change,
            "originalFirstStartSeconds": original_start,
            "outputFirstStartSeconds": output_start,
            "savedTimingShiftSeconds": shift,
            "savedBytes": SAVED.stat().st_size,
            "downloadSuggestedFilename": suggested_filename,
            "savePopupText": popup_text,
            "romanianTokensVerified": romanian_tokens,
            "consoleErrors": console_errors,
            "pageErrors": page_errors,
            "httpFailures": http_failures,
        }

        RESULT.parent.mkdir(parents=True, exist_ok=True)
        RESULT.write_text(json.dumps(details, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(json.dumps(details, indent=2, ensure_ascii=False))

        context.close()
        browser.close()

        if console_errors or page_errors or http_failures:
            raise SystemExit("Primary PWA workflow emitted browser/runtime errors")
finally:
    server.shutdown()
    server.server_close()
    pages_root_ctx.cleanup()
