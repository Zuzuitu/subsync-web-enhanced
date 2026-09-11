#!/usr/bin/env python3
import functools
import http.server
import json
import shutil
import socketserver
import threading
from pathlib import Path

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
RESULT_PATH = ROOT / "tests" / "generated" / "browser-wasm-smoke.json"


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass


handler = functools.partial(QuietHandler, directory=str(ROOT))
server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler)
server.daemon_threads = True
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()

browser_path = (
    shutil.which("google-chrome")
    or shutil.which("google-chrome-stable")
    or shutil.which("chromium")
    or shutil.which("chromium-browser")
)

url = f"http://127.0.0.1:{server.server_address[1]}/tests/wasm/browser-smoke.html"

try:
    with sync_playwright() as p:
        launch_args = {
            "headless": True,
            "args": ["--no-sandbox", "--disable-dev-shm-usage"],
        }
        if browser_path:
            launch_args["executable_path"] = browser_path

        browser = p.chromium.launch(**launch_args)
        page = browser.new_page()
        console_lines = []
        page.on("console", lambda msg: console_lines.append(f"{msg.type}: {msg.text}"))
        page.on("pageerror", lambda exc: console_lines.append(f"pageerror: {exc}"))

        page.goto(url, wait_until="load")

        timed_out = False
        try:
            page.wait_for_function(
                "document.documentElement.dataset.status === 'pass' || "
                "document.documentElement.dataset.status === 'fail'",
                timeout=45_000,
            )
        except PlaywrightTimeoutError:
            timed_out = True

        status = page.get_attribute("html", "data-status") or "unknown"
        last_phase = page.get_attribute("html", "data-phase") or "unknown"
        details_raw = page.get_attribute("html", "data-details") or ""
        phases = page.evaluate("window.__subsyncSmokePhases || []")

        if timed_out:
            status = "timeout"
            details = {
                "message": "Browser/WASM smoke timed out",
                "lastPhase": last_phase,
            }
        else:
            try:
                details = json.loads(details_raw)
            except json.JSONDecodeError:
                details = {"raw": details_raw}

        print("\n".join(console_lines))
        print("Smoke status:", status)
        print("Last phase:", last_phase)
        print("Smoke details:", json.dumps(details, indent=2))
        print("Phase timeline:", json.dumps(phases, indent=2))

        RESULT_PATH.parent.mkdir(parents=True, exist_ok=True)
        RESULT_PATH.write_text(
            json.dumps(
                {
                    "status": status,
                    "timedOut": timed_out,
                    "browserExecutable": browser_path or "playwright-bundled-chromium",
                    "lastPhase": last_phase,
                    "details": details,
                    "phases": phases,
                    "console": console_lines,
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )

        browser.close()

        if status != "pass":
            raise SystemExit(
                f"Browser/WASM MKV smoke failed: status={status}, lastPhase={last_phase}"
            )
finally:
    server.shutdown()
    server.server_close()
