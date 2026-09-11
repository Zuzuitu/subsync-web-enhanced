#!/usr/bin/env python3
import functools
import hashlib
import http.server
import json
import shutil
import socketserver
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
DIST = ROOT / "web" / "dist"
CFG = json.loads((ROOT / "config" / "english-romanian-assets.json").read_text(encoding="utf-8"))
RESULT = ROOT / "tests" / "generated" / "web-app-smoke.json"

required_files = [
    "index.html",
    "app.css",
    "manifest.webmanifest",
    "icon.svg",
    "sw.js",
    "scripts/subsync.js",
    "scripts/extractor.wasm",
    "scripts/correlator.wasm",
    "assets/data/speech-eng.zip",
    "assets/data/dict-eng-rum.zip",
]
for relative in required_files:
    path = DIST / relative
    if not path.is_file() or path.stat().st_size == 0:
        raise SystemExit(f"Missing staged PWA file: {relative}")

def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

if sha256(DIST / "assets/data/speech-eng.zip") != CFG["speechEnglish"]["sha256"]:
    raise SystemExit("Staged English speech asset hash mismatch")
if sha256(DIST / "assets/data/dict-eng-rum.zip") != CFG["dictionaryEnglishRomanian"]["sha256"]:
    raise SystemExit("Staged English-Romanian dictionary hash mismatch")

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

handler = functools.partial(QuietHandler, directory=str(DIST))
server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler)
server.daemon_threads = True
threading.Thread(target=server.serve_forever, daemon=True).start()

browser_path = (
    shutil.which("google-chrome")
    or shutil.which("google-chrome-stable")
    or shutil.which("chromium")
    or shutil.which("chromium-browser")
)
url = f"http://127.0.0.1:{server.server_address[1]}/"

try:
    with sync_playwright() as p:
        launch = {"headless": True, "args": ["--no-sandbox", "--disable-dev-shm-usage"]}
        if browser_path:
            launch["executable_path"] = browser_path

        browser = p.chromium.launch(**launch)
        page = browser.new_page()
        console_errors = []
        page_errors = []
        failed = []

        page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
        page.on("pageerror", lambda exc: page_errors.append(str(exc)))
        page.on("response", lambda response: failed.append({
            "status": response.status,
            "url": response.url,
        }) if response.status >= 400 else None)

        page.goto(url, wait_until="load")
        page.wait_for_selector("#subsync_app", timeout=30_000)

        text = page.locator("#subsync_app").inner_text()
        for expected in ("Subtitle", "Reference", "Select file"):
            if expected not in text:
                raise SystemExit(f"PWA shell missing expected UI text: {expected!r}")

        manifest_ok = page.evaluate(
            "() => fetch('./manifest.webmanifest').then(r => r.ok)"
        )
        if not manifest_ok:
            raise SystemExit("PWA manifest is not fetchable")

        service_worker_ready = page.evaluate(
            """async () => {
              if (!('serviceWorker' in navigator)) return false;
              await Promise.race([
                navigator.serviceWorker.ready,
                new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000))
              ]);
              return true;
            }"""
        )
        if not service_worker_ready:
            raise SystemExit("Service worker did not become ready")

        details = {
            "url": url,
            "browserExecutable": browser_path or "playwright-bundled-chromium",
            "serviceWorkerReady": service_worker_ready,
            "consoleErrors": console_errors,
            "pageErrors": page_errors,
            "httpFailures": failed,
            "uiText": text,
        }

        RESULT.parent.mkdir(parents=True, exist_ok=True)
        RESULT.write_text(json.dumps(details, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(details, indent=2))

        browser.close()

        if console_errors or page_errors or failed:
            raise SystemExit("PWA shell emitted browser/runtime errors")
finally:
    server.shutdown()
    server.server_close()
