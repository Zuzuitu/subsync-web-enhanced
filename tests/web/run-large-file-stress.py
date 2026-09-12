#!/usr/bin/env python3
import functools
import http.server
import json
import os
import socketserver
import tempfile
import threading
import time
from pathlib import Path

import psutil
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
DIST = ROOT / "web" / "dist"
FIXTURE_DIR = ROOT / "tests" / "generated" / "large-file-stress"
MKV = FIXTURE_DIR / "reference-large.mkv"
SRT = FIXTURE_DIR / "target.rum.srt"
FIXTURE_MANIFEST = FIXTURE_DIR / "fixture.json"
ENGINE = os.environ.get("SUBSYNC2_BROWSER_ENGINE", "chromium").strip().lower()
RESULT = ROOT / "tests" / "generated" / f"large-file-stress-{ENGINE}.json"

if ENGINE not in {"chromium", "webkit"}:
    raise SystemExit(f"Unsupported browser engine: {ENGINE}")
for path in (DIST, MKV, SRT, FIXTURE_MANIFEST):
    if not path.exists():
        raise SystemExit(f"Missing large-file stress input: {path.relative_to(ROOT)}")

fixture = json.loads(FIXTURE_MANIFEST.read_text(encoding="utf-8"))
if fixture["bytes"] < 128 * 1024 * 1024:
    raise SystemExit("Large-file fixture is below the 128 MiB stress floor")


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass


def descendants_rss_bytes():
    root = psutil.Process(os.getpid())
    total = 0
    for proc in root.children(recursive=True):
        try:
            total += proc.memory_info().rss
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass
    return total


def memory_sampler(stop_event, samples):
    while not stop_event.wait(0.1):
        samples.append((time.monotonic(), descendants_rss_bytes()))


pages_ctx = tempfile.TemporaryDirectory(prefix="subsync2-large-pages-")
pages_root = Path(pages_ctx.name)
pages_base = "subsync-web-enhanced"
(pages_root / pages_base).symlink_to(DIST, target_is_directory=True)

handler = functools.partial(QuietHandler, directory=str(pages_root))
server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler)
server.daemon_threads = True
threading.Thread(target=server.serve_forever, daemon=True).start()
url = f"http://127.0.0.1:{server.server_address[1]}/{pages_base}/"

diagnostics = {
    "status": "running",
    "engine": ENGINE,
    "fixtureBytes": fixture["bytes"],
    "fixtureMiB": fixture["mib"],
    "fixtureDuration": fixture["probe"]["format"].get("duration"),
    "url": url,
}

try:
    with sync_playwright() as p:
        browser_type = p.chromium if ENGINE == "chromium" else p.webkit

        baseline_rss = descendants_rss_bytes()
        samples = []
        stop_memory = threading.Event()
        sampler = threading.Thread(
            target=memory_sampler,
            args=(stop_memory, samples),
            daemon=True,
        )
        sampler.start()

        browser = browser_type.launch(headless=True)
        if ENGINE == "webkit":
            device = dict(p.devices["iPhone 14"])
            context = browser.new_context(**device)
        else:
            context = browser.new_context()

        page = context.new_page()
        console_errors = []
        page_errors = []
        http_failures = []
        page.on(
            "console",
            lambda msg: console_errors.append(msg.text)
            if msg.type == "error"
            else None,
        )
        page.on("pageerror", lambda exc: page_errors.append(str(exc)))
        page.on(
            "response",
            lambda response: http_failures.append(
                {"status": response.status, "url": response.url}
            )
            if response.status >= 400
            else None,
        )

        started = time.monotonic()
        page.goto(url, wait_until="load", timeout=60_000)
        page.wait_for_selector("#subsync_app", timeout=30_000)

        browser_info = page.evaluate(
            """() => ({
              userAgent: navigator.userAgent,
              platform: navigator.platform,
              maxTouchPoints: navigator.maxTouchPoints,
              deviceMemory: navigator.deviceMemory || null,
            })"""
        )

        sub_input = page.locator('input[name="streams-group-sub-file"]')
        ref_input = page.locator('input[name="streams-group-ref-file"]')

        sub_input.set_input_files(str(SRT))
        sub_group = sub_input.locator("xpath=..")
        sub_group.locator('input[type="radio"]').first.wait_for(
            state="attached", timeout=30_000
        )
        sub_group.locator("select").first.select_option("rum")

        load_started = time.monotonic()
        ref_input.set_input_files(str(MKV))
        ref_group = ref_input.locator("xpath=..")
        ref_group.locator('input[type="radio"]').first.wait_for(
            state="attached", timeout=120_000
        )
        stream_load_seconds = time.monotonic() - load_started

        labels = ref_group.locator("label")
        stream_labels = [labels.nth(i).inner_text() for i in range(labels.count())]
        english_index = next(
            (
                i
                for i, label in enumerate(stream_labels)
                if "English reference" in label
            ),
            None,
        )
        if english_index is None:
            raise SystemExit(
                "Could not find the intended English reference audio stream: "
                + json.dumps(stream_labels, ensure_ascii=False)
            )

        english_label = labels.nth(english_index)
        english_label.locator('input[type="radio"]').check()
        ref_group.locator("select").first.select_option("eng")
        selected_label_text = english_label.inner_text()
        if "English reference" not in selected_label_text:
            raise SystemExit(
                "Large direct-MKV workflow did not select the intended English track"
            )

        page.get_by_role("button", name="Start", exact=True).click()

        page.wait_for_function(
            """() => {
              const app = document.querySelector('#subsync_app')?.innerText || '';
              const popup = Array.from(document.querySelectorAll('#subsync_app .popup'))
                .map(node => node.innerText || '')
                .join(String.fromCharCode(10));
              const terminal = [
                'Subtitles synchronized',
                'No need to synchronize',
                "Couldn't synchronize",
                'Synchronization inconclusive',
                'Synchronization terminated'
              ].some(value => app.includes(value));
              return terminal || popup.includes('Synchronization failed');
            }""",
            timeout=240_000,
        )
        elapsed_seconds = time.monotonic() - started

        app_text = page.locator("#subsync_app").inner_text()
        popups = page.locator("#subsync_app .popup")
        popup_texts = [popups.nth(i).inner_text() for i in range(popups.count())]

        if any("Synchronization failed" in text for text in popup_texts):
            raise SystemExit(
                "Large direct-MKV workflow hit a fatal synchronization failure: "
                + json.dumps(popup_texts, ensure_ascii=False)
            )
        if "Synchronization terminated" in app_text:
            raise SystemExit("Large direct-MKV workflow terminated unexpectedly")
        if "Diagnostics" not in app_text:
            raise SystemExit("Large direct-MKV workflow did not expose diagnostics")
        if "Decoded subtitles:" not in app_text or "reference words:" not in app_text:
            raise SystemExit(
                "Large direct-MKV workflow did not expose processing evidence"
            )

        stop_memory.set()
        sampler.join(timeout=2)
        final_rss = descendants_rss_bytes()
        rss_values = [value for _, value in samples] or [final_rss]
        peak_rss = max(rss_values)
        peak_delta = max(0, peak_rss - baseline_rss)

        diagnostics.update(
            {
                "status": "pass",
                "browser": browser_info,
                "streamLabels": stream_labels,
                "selectedReferenceLabel": selected_label_text,
                "streamLoadSeconds": round(stream_load_seconds, 3),
                "elapsedSeconds": round(elapsed_seconds, 3),
                "terminalText": app_text,
                "popupTexts": popup_texts,
                "baselineDescendantRssBytes": baseline_rss,
                "peakDescendantRssBytes": peak_rss,
                "peakDescendantRssMiB": round(peak_rss / (1024 * 1024), 2),
                "peakDeltaRssBytes": peak_delta,
                "peakDeltaRssMiB": round(peak_delta / (1024 * 1024), 2),
                "memorySamples": len(samples),
                "consoleErrors": console_errors,
                "pageErrors": page_errors,
                "httpFailures": http_failures,
                "physicalIPhone": False,
            }
        )

        RESULT.parent.mkdir(parents=True, exist_ok=True)
        RESULT.write_text(
            json.dumps(diagnostics, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        print(json.dumps(diagnostics, indent=2, ensure_ascii=False))

        context.close()
        browser.close()

        if console_errors or page_errors or http_failures:
            raise SystemExit(
                f"{ENGINE} large-file stress emitted browser/runtime/network errors"
            )
finally:
    server.shutdown()
    server.server_close()
    pages_ctx.cleanup()
