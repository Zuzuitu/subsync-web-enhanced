#!/usr/bin/env python3
import functools
import http.server
import json
import shutil
import socketserver
import subprocess
import sys
import tempfile
import threading
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

expected_urls = {
    "speech/eng": "assets/data/speech-eng.zip",
    "dict/eng-rum": "assets/data/dict-eng-rum.zip",
    "speech/ita": "assets/data/speech-ita.zip",
    "dict/eng-ita": "assets/data/dict-eng-ita.zip",
}
for key, expected in expected_urls.items():
    if catalog[key]["url"] != expected:
        raise SystemExit(f"Expected same-origin URL for {key}: {catalog[key]['url']} != {expected}")

fixture_ctx = tempfile.TemporaryDirectory(prefix="subsync2-upstream-assets-")
fixture_dir = Path(fixture_ctx.name)
site_dir = fixture_dir / "site"
shutil.copytree(DIST, site_dir)

# Mirror only representative non-primary assets for this smoke. The deliberate
# Pages deploy mirrors the complete pinned catalog.
subprocess.run(
    [
        sys.executable,
        str(ROOT / "scripts" / "mirror-upstream-assets.py"),
        "--destination",
        str(site_dir / "assets" / "data"),
        "--cache-dir",
        str(fixture_dir / "cache"),
        "--asset",
        "dict/eng-ita",
        "--asset",
        "speech/ita",
        "--workers",
        "2",
    ],
    check=True,
)

mirror_manifest = json.loads(
    (site_dir / "assets" / "data" / "upstream-manifest.json").read_text(encoding="utf-8")
)
if mirror_manifest["selectedCount"] != 2:
    raise SystemExit("Representative upstream mirror did not materialize both assets")
if not all(item["signatureVerified"] for item in mirror_manifest["assets"]):
    raise SystemExit("Representative upstream assets were not signature verified")

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
(pages_root / pages_base).symlink_to(site_dir, target_is_directory=True)

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


def assert_asset_response(responses, filename):
    matches = [
        response
        for response in responses
        if response["url"].split("?", 1)[0].endswith("/assets/data/" + filename)
    ]
    if not matches or not any(response["status"] == 200 for response in matches):
        raise SystemExit(
            f"App did not fetch mirrored asset {filename} successfully: "
            + json.dumps(matches, indent=2)
        )
    return matches


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
        responses = []
        page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
        page.on("pageerror", lambda exc: page_errors.append(str(exc)))
        page.on("response", lambda response: responses.append({
            "status": response.status,
            "url": response.url,
        }))

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

        page.get_by_role("button", name="Start", exact=True).click()
        dict_state, dict_popup = wait_for_terminal_or_failure(page)
        dict_responses = assert_asset_response(responses, "dict-eng-ita.zip")

        # Real app path: Italian audio model requested on demand.
        page.goto(url, wait_until="load")
        page.wait_for_selector("#subsync_app", timeout=30_000)
        responses.clear()

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
        speech_responses = assert_asset_response(responses, "speech-ita.zip")

        details = {
            "url": url,
            "status": "pass",
            "speechAssetCount": len(speech),
            "dictionaryAssetCount": len(dictionaries),
            "speechAssets": speech,
            "catalogUrls": expected_urls,
            "mirrorManifest": mirror_manifest,
            "dictionaryResponses": dict_responses,
            "speechResponses": speech_responses,
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
