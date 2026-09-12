#!/usr/bin/env python3
import functools
import http.server
import json
import shutil
import socketserver
import tempfile
import threading
import time
import urllib.parse
import wave
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
DIST = ROOT / "web" / "dist"
CATALOG_PATH = ROOT / "web" / "src" / "data" / "assets.json"
RESULT = ROOT / "tests" / "generated" / "web-upstream-assets-smoke.json"

catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
speech = sorted(key for key in catalog if key.startswith("speech/"))
dictionaries = sorted(key for key in catalog if key.startswith("dict/"))

expected_speech = [
    "speech/chi",
    "speech/dut",
    "speech/eng",
    "speech/fre",
    "speech/ger",
    "speech/gre",
    "speech/ita",
    "speech/rus",
    "speech/spa",
]
if speech != expected_speech:
    raise SystemExit(f"Unexpected speech catalog: {speech}")
if len(dictionaries) != 217:
    raise SystemExit(f"Unexpected dictionary count: {len(dictionaries)}")
if catalog["speech/eng"]["url"] != "assets/data/speech-eng.zip":
    raise SystemExit("Primary English speech asset must remain same-origin")
if catalog["dict/eng-rum"]["url"] != "assets/data/dict-eng-rum.zip":
    raise SystemExit("Primary ENG-RO dictionary must remain same-origin")

for key in ("speech/ita", "dict/eng-ita"):
    url = catalog[key]["url"]
    if not url.startswith("https://github.com/sc0ty/subsync/releases/download/assets/"):
        raise SystemExit(f"Expected upstream on-demand URL for {key}: {url}")

fixture_ctx = tempfile.TemporaryDirectory(prefix="subsync2-upstream-assets-")
fixture_dir = Path(fixture_ctx.name)
sub_ita = fixture_dir / "target.ita.srt"
ref_eng = fixture_dir / "reference.eng.srt"
audio_ita = fixture_dir / "reference.ita.wav"

sub_ita.write_text(
    """1
00:00:03,000 --> 00:00:05,000
amico famiglia persone musica strada

2
00:00:08,000 --> 00:00:10,000
mattina polizia domanda risposta finestra
""",
    encoding="utf-8",
)
ref_eng.write_text(
    """1
00:00:01,000 --> 00:00:03,000
friend family people music street

2
00:00:06,000 --> 00:00:08,000
morning police question answer window
""",
    encoding="utf-8",
)

with wave.open(str(audio_ita), "wb") as wav:
    wav.setnchannels(1)
    wav.setsampwidth(2)
    wav.setframerate(16000)
    wav.writeframes(b"\x00\x00" * 16000 * 2)


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

browser_path = (
    shutil.which("google-chrome")
    or shutil.which("google-chrome-stable")
    or shutil.which("chromium")
    or shutil.which("chromium-browser")
)
url = f"http://127.0.0.1:{server.server_address[1]}/{pages_base}/"


def fetch_remote_zip(page, asset_url):
    result = page.evaluate(
        """async (url) => {
          const response = await fetch(url, {cache: 'no-store'});
          const data = new Uint8Array(await response.arrayBuffer());
          return {
            status: response.status,
            bytes: data.byteLength,
            magic: Array.from(data.slice(0, 2)),
            finalUrl: response.url,
          };
        }""",
        asset_url,
    )
    if result["status"] != 200 or result["bytes"] < 1000 or result["magic"] != [80, 75]:
        raise SystemExit("Remote asset CORS/ZIP probe failed: " + json.dumps(result))
    return result


def wait_for_terminal_or_failure(page, timeout=60_000):
    page.wait_for_function(
        """() => {
          const text = document.querySelector('#subsync_app')?.innerText || '';
          const popup = document.querySelector('#subsync_app .popup')?.innerText || '';
          return [
            'Subtitles synchronized',
            'No need to synchronize',
            "Couldn't synchronize",
            'Synchronization inconclusive',
            'Synchronization terminated'
          ].some(value => text.includes(value)) || popup.includes('Synchronization failed');
        }""",
        timeout=timeout,
    )
    body = page.locator("#subsync_app").inner_text()
    popups = page.locator("#subsync_app .popup")
    popup_text = popups.last.inner_text() if popups.count() else ""
    if "Synchronization failed" in popup_text:
        raise SystemExit("Upstream asset path caused synchronization failure: " + popup_text)
    return body, popup_text


try:
    with sync_playwright() as p:
        launch = {
            "headless": True,
            "args": ["--no-sandbox", "--disable-dev-shm-usage"],
        }
        if browser_path:
            launch["executable_path"] = browser_path

        browser = p.chromium.launch(**launch)
        context = browser.new_context()
        page = context.new_page()

        console_errors = []
        page_errors = []
        page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
        page.on("pageerror", lambda exc: page_errors.append(str(exc)))

        page.goto(url, wait_until="load")
        page.wait_for_selector("#subsync_app", timeout=30_000)

        # Real app path: ENG reference subtitles + Italian target subtitles.
        sub_input = page.locator('input[name="streams-group-sub-file"]')
        ref_input = page.locator('input[name="streams-group-ref-file"]')
        sub_input.set_input_files(str(sub_ita))
        sub_group = sub_input.locator("xpath=..")
        sub_group.locator('input[type="radio"]').first.wait_for(state="attached", timeout=30_000)
        sub_group.locator("select").first.select_option("ita")

        ref_input.set_input_files(str(ref_eng))
        ref_group = ref_input.locator("xpath=..")
        ref_group.locator('input[type="radio"]').first.wait_for(state="attached", timeout=30_000)
        ref_group.locator("select").first.select_option("eng")

        dictionary_cors_probe = fetch_remote_zip(page, catalog["dict/eng-ita"]["url"])
        page.get_by_role("button", name="Start", exact=True).click()
        dict_state, dict_popup = wait_for_terminal_or_failure(page)

        # Real app path: Italian audio model requested on demand.
        page.goto(url, wait_until="load")
        page.wait_for_selector("#subsync_app", timeout=30_000)
        sub_input = page.locator('input[name="streams-group-sub-file"]')
        ref_input = page.locator('input[name="streams-group-ref-file"]')
        sub_input.set_input_files(str(sub_ita))
        sub_group = sub_input.locator("xpath=..")
        sub_group.locator('input[type="radio"]').first.wait_for(state="attached", timeout=30_000)
        sub_group.locator("select").first.select_option("ita")

        ref_input.set_input_files(str(audio_ita))
        ref_group = ref_input.locator("xpath=..")
        ref_group.locator('input[type="radio"]').first.wait_for(state="attached", timeout=30_000)
        ref_group.locator("select").first.select_option("ita")

        page.get_by_role("button", name="Start", exact=True).click()
        speech_state, speech_popup = wait_for_terminal_or_failure(page, timeout=120_000)

        details = {
            "url": url,
            "status": "pass",
            "speechAssetCount": len(speech),
            "dictionaryAssetCount": len(dictionaries),
            "speechAssets": speech,
            "primaryLocalAssets": {
                "speech/eng": catalog["speech/eng"]["url"],
                "dict/eng-rum": catalog["dict/eng-rum"]["url"],
            },
            "dictionaryRemoteAsset": catalog["dict/eng-ita"]["url"],
            "speechRemoteAsset": catalog["speech/ita"]["url"],
            "dictionaryCorsProbe": dictionary_cors_probe,
            "dictionaryTerminalState": dict_state,
            "dictionaryPopup": dict_popup,
            "speechTerminalState": speech_state,
            "speechPopup": speech_popup,
            "consoleErrors": console_errors,
            "pageErrors": page_errors,
        }
        RESULT.parent.mkdir(parents=True, exist_ok=True)
        RESULT.write_text(
            json.dumps(details, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        print(json.dumps(details, indent=2, ensure_ascii=False))

        context.close()
        browser.close()

        if console_errors or page_errors:
            raise SystemExit("Upstream asset smoke emitted browser/runtime errors")
finally:
    server.shutdown()
    server.server_close()
    pages_root_ctx.cleanup()
    fixture_ctx.cleanup()
