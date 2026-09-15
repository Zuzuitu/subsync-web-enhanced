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
RECOVERY_SITE = ROOT / "tests" / "generated" / "web-app-stale-recovery-site"

required_files = [
    "index.html",
    "app.css",
    "manifest.webmanifest",
    "icon.svg",
    "sw.js",
    "build-manifest.json",
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

build_manifest = json.loads((DIST / "build-manifest.json").read_text(encoding="utf-8"))
build_hash = build_manifest["buildHash"]
index_text = (DIST / "index.html").read_text(encoding="utf-8")
sw_text = (DIST / "sw.js").read_text(encoding="utf-8")

if "__BUILD_HASH__" in index_text or "__BUILD_HASH__" in sw_text:
    raise SystemExit("Staged PWA still contains unresolved build hash placeholders")
for expected in (
    f"./app.css?{build_hash}",
    f"./manifest.webmanifest?{build_hash}",
    f"./scripts/subsync.js?{build_hash}",
    f'var subsync2_build_hash = "{build_hash}"',
):
    if expected not in index_text:
        raise SystemExit(f"Staged index is missing build-versioned reference: {expected}")
if "event.request.mode === 'navigate'" not in sw_text:
    raise SystemExit("Service worker must use a dedicated navigation update strategy")
if "build-manifest.json" not in sw_text or "cache: 'no-store'" not in sw_text:
    raise SystemExit("Service worker must bypass shell cache for build manifest checks")


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass


def start_server(directory):
    handler = functools.partial(QuietHandler, directory=str(directory))
    server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler)
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def page_errors(page):
    console_errors = []
    runtime_errors = []
    failed = []
    page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
    page.on("pageerror", lambda exc: runtime_errors.append(str(exc)))
    page.on("response", lambda response: failed.append({
        "status": response.status,
        "url": response.url,
    }) if response.status >= 400 else None)
    return console_errors, runtime_errors, failed


server = start_server(DIST)
recovery_server = None

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
        console_errors, runtime_errors, failed = page_errors(page)

        page.goto(url, wait_until="load")
        page.wait_for_selector("#subsync_app", timeout=30_000)

        text = page.locator("#subsync_app").inner_text()
        for expected in ("Subtitle", "Reference", "Select file"):
            if expected not in text:
                raise SystemExit(f"PWA shell missing expected UI text: {expected!r}")

        page_build_hash = page.evaluate("() => window.subsync2_build_hash")
        if page_build_hash != build_hash:
            raise SystemExit(f"Page build hash mismatch: {page_build_hash} != {build_hash}")

        bundle_src = page.locator('script[src*="scripts/subsync.js"]').get_attribute("src")
        if not bundle_src or not bundle_src.endswith("?" + build_hash):
            raise SystemExit(f"Browser bundle is not versioned with build hash: {bundle_src}")

        manifest_ok = page.evaluate(
            "() => fetch('./manifest.webmanifest').then(r => r.ok)"
        )
        if not manifest_ok:
            raise SystemExit("PWA manifest is not fetchable")

        service_worker = page.evaluate(
            """async () => {
              if (!('serviceWorker' in navigator)) return null;
              const registration = await Promise.race([
                navigator.serviceWorker.ready,
                new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000))
              ]);
              return registration.active ? registration.active.scriptURL : null;
            }"""
        )
        if not service_worker or ("?" + build_hash) not in service_worker:
            raise SystemExit(f"Service worker is not bound to current build: {service_worker}")

        # Reproduce the pre-fix installed-PWA failure mode on an isolated origin:
        # first install a legacy cache-first worker, then publish the current
        # staged build. A build-busted navigation must escape the legacy shell,
        # load the current versioned bundle, activate the new worker, and make a
        # subsequent normal navigation current as well.
        if RECOVERY_SITE.exists():
            shutil.rmtree(RECOVERY_SITE)
        shutil.copytree(DIST, RECOVERY_SITE)
        current_index = (RECOVERY_SITE / "index.html").read_text(encoding="utf-8")
        current_sw = (RECOVERY_SITE / "sw.js").read_text(encoding="utf-8")
        current_manifest = (RECOVERY_SITE / "build-manifest.json").read_text(encoding="utf-8")

        (RECOVERY_SITE / "index.html").write_text(
            """<!doctype html><html><body><p id="legacy-shell">legacy shell</p>
<script>
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js');
}
</script></body></html>
""",
            encoding="utf-8",
        )
        (RECOVERY_SITE / "sw.js").write_text(
            """const CACHE_NAME = 'subsync2-shell-legacy';
const APP_SHELL = ['./', './index.html'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
});
""",
            encoding="utf-8",
        )

        recovery_server = start_server(RECOVERY_SITE)
        recovery_url = f"http://127.0.0.1:{recovery_server.server_address[1]}/"
        recovery = browser.new_page()
        recovery_console, recovery_runtime, recovery_failed = page_errors(recovery)

        recovery.goto(recovery_url, wait_until="load")
        recovery.wait_for_selector("#legacy-shell", timeout=10_000)
        recovery.evaluate(
            """async () => {
              await navigator.serviceWorker.ready;
              if (!navigator.serviceWorker.controller) {
                await new Promise(resolve => {
                  navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true });
                  setTimeout(resolve, 3000);
                });
              }
            }"""
        )

        (RECOVERY_SITE / "index.html").write_text(current_index, encoding="utf-8")
        (RECOVERY_SITE / "sw.js").write_text(current_sw, encoding="utf-8")
        (RECOVERY_SITE / "build-manifest.json").write_text(current_manifest, encoding="utf-8")

        recovery.goto(recovery_url + "?build=" + build_hash, wait_until="load")
        recovery.wait_for_selector("#subsync_app", timeout=30_000)
        recovered_hash = recovery.evaluate("() => window.subsync2_build_hash")
        recovered_bundle = recovery.locator('script[src*="scripts/subsync.js"]').get_attribute("src")
        if recovered_hash != build_hash:
            raise SystemExit(f"Legacy shell recovery loaded wrong build: {recovered_hash}")
        if not recovered_bundle or not recovered_bundle.endswith("?" + build_hash):
            raise SystemExit(f"Legacy shell recovery loaded stale bundle URL: {recovered_bundle}")

        recovery.wait_for_function(
            """hash => navigator.serviceWorker.ready.then(reg =>
              Boolean(reg.active && reg.active.scriptURL.includes('?' + hash))
            )""",
            arg=build_hash,
            timeout=15_000,
        )

        recovery.goto(recovery_url, wait_until="load")
        recovery.wait_for_selector("#subsync_app", timeout=30_000)
        normal_hash = recovery.evaluate("() => window.subsync2_build_hash")
        if normal_hash != build_hash:
            raise SystemExit(f"Normal navigation remained stale after recovery: {normal_hash}")

        details = {
            "url": url,
            "browserExecutable": browser_path or "playwright-bundled-chromium",
            "buildHash": build_hash,
            "pageBuildHash": page_build_hash,
            "bundleSrc": bundle_src,
            "serviceWorkerScript": service_worker,
            "serviceWorkerReady": True,
            "staleShellRecovery": {
                "bootstrapBuildHash": recovered_hash,
                "bootstrapBundleSrc": recovered_bundle,
                "normalNavigationBuildHash": normal_hash,
            },
            "consoleErrors": console_errors + recovery_console,
            "pageErrors": runtime_errors + recovery_runtime,
            "httpFailures": failed + recovery_failed,
            "uiText": text,
        }

        RESULT.parent.mkdir(parents=True, exist_ok=True)
        RESULT.write_text(json.dumps(details, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(details, indent=2))

        recovery.close()
        browser.close()

        if details["consoleErrors"] or details["pageErrors"] or details["httpFailures"]:
            raise SystemExit("PWA shell emitted browser/runtime errors")
finally:
    server.shutdown()
    server.server_close()
    if recovery_server is not None:
        recovery_server.shutdown()
        recovery_server.server_close()
