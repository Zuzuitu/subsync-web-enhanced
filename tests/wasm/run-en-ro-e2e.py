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
RESULT_PATH = ROOT / "tests" / "generated" / "en-ro-e2e" / "browser-en-ro-e2e.json"

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
url = f"http://127.0.0.1:{server.server_address[1]}/tests/wasm/en-ro-e2e.html"

try:
    with sync_playwright() as p:
        launch = {
            "headless": True,
            "args": ["--no-sandbox", "--disable-dev-shm-usage"],
        }
        if browser_path:
            launch["executable_path"] = browser_path

        browser = p.chromium.launch(**launch)
        page = browser.new_page()
        console = []
        page.on("console", lambda msg: console.append(f"{msg.type}: {msg.text}"))
        page.on("pageerror", lambda exc: console.append(f"pageerror: {exc}"))
        page.goto(url, wait_until="load")

        timed_out = False
        try:
            page.wait_for_function(
                "document.documentElement.dataset.status === 'pass' || "
                "document.documentElement.dataset.status === 'fail'",
                timeout=120_000,
            )
        except PlaywrightTimeoutError:
            timed_out = True

        status = page.get_attribute("html", "data-status") or "unknown"
        phase = page.get_attribute("html", "data-phase") or "unknown"
        raw = page.get_attribute("html", "data-details") or ""
        phases = page.evaluate("window.__subsyncE2EPhases || []")
        try:
            details = json.loads(raw)
        except json.JSONDecodeError:
            details = {"raw": raw}

        if timed_out:
            status = "timeout"
            details = {"message": "EN-RO E2E timed out", "lastPhase": phase}

        print("\n".join(console))
        print("E2E status:", status)
        print("Last phase:", phase)
        print("E2E details:", json.dumps(details, indent=2, ensure_ascii=False))
        print("Phase timeline:", json.dumps(phases, indent=2, ensure_ascii=False))

        RESULT_PATH.parent.mkdir(parents=True, exist_ok=True)
        RESULT_PATH.write_text(
            json.dumps({
                "status": status,
                "timedOut": timed_out,
                "browserExecutable": browser_path or "playwright-bundled-chromium",
                "lastPhase": phase,
                "details": details,
                "phases": phases,
                "console": console,
            }, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        browser.close()

        if status != "pass":
            raise SystemExit(f"EN-RO E2E failed: status={status}, lastPhase={phase}")
finally:
    server.shutdown()
    server.server_close()
