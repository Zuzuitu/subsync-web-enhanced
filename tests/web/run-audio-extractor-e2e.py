#!/usr/bin/env python3
import argparse
import functools
import http.server
import json
import shutil
import socketserver
import subprocess
import tempfile
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
DIST = ROOT / "web" / "dist"
RESULT_DIR = ROOT / "tests" / "generated" / "audio-extractor-e2e"

parser = argparse.ArgumentParser()
parser.add_argument("--browser", choices=("chromium", "webkit"), default="chromium")
parser.add_argument("--input", default="tests/generated/reference-aac.mkv")
args = parser.parse_args()

source = ROOT / args.input
if not source.is_file() or source.stat().st_size == 0:
    raise SystemExit(f"Missing Audio Extractor fixture: {source.relative_to(ROOT)}")

RESULT_DIR.mkdir(parents=True, exist_ok=True)

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

handler = functools.partial(QuietHandler, directory=str(DIST))
server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler)
server.daemon_threads = True
threading.Thread(target=server.serve_forever, daemon=True).start()
url = f"http://127.0.0.1:{server.server_address[1]}/?tab=audio"

def probe(path):
    raw = subprocess.check_output([
        "ffprobe", "-v", "error",
        "-show_entries", "stream=codec_type,codec_name,channels,sample_rate",
        "-of", "json", str(path),
    ], text=True)
    return json.loads(raw)

diagnostics = {
    "browser": args.browser,
    "source": str(source.relative_to(ROOT)),
    "status": "running",
    "consoleErrors": [],
    "pageErrors": [],
    "httpFailures": [],
}

try:
    with sync_playwright() as p:
        browser_type = p.chromium if args.browser == "chromium" else p.webkit
        launch = {"headless": True}
        if args.browser == "chromium":
            browser_path = (
                shutil.which("google-chrome")
                or shutil.which("google-chrome-stable")
                or shutil.which("chromium")
                or shutil.which("chromium-browser")
            )
            if browser_path:
                launch["executable_path"] = browser_path
            launch["args"] = ["--no-sandbox", "--disable-dev-shm-usage"]
            browser = browser_type.launch(**launch)
            context = browser.new_context(accept_downloads=True)
        else:
            browser = browser_type.launch(**launch)
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
        page.wait_for_selector("iframe.audio_extractor_frame", timeout=30_000)
        frame = page.frame_locator("iframe.audio_extractor_frame")
        file_input = frame.locator("#fileInput")
        file_input.wait_for(state="attached", timeout=30_000)
        file_input.set_input_files(str(source))

        frame.locator("#tracksCard:not(.hidden)").wait_for(state="visible", timeout=60_000)
        frame.locator("#modeCard:not(.hidden)").wait_for(state="visible", timeout=60_000)
        track_count = frame.locator('input[name="audioTrack"]').count()
        if track_count < 1:
            raise SystemExit("Audio Extractor found no audio track")
        diagnostics["trackCount"] = track_count

        outputs = {}
        for mode, suffix in (("mka", ".original.mka"), ("mp3", ".subsync.mp3")):
            radio = frame.locator(f'input[name="mode"][value="{mode}"]')
            radio.check(force=True)
            frame.locator(".compatibility.ok").wait_for(state="visible", timeout=60_000)

            frame.locator("#extractBtn").click()
            frame.locator("#resultActions:not(.hidden)").wait_for(state="visible", timeout=120_000)
            frame.locator("#progressPct").wait_for(state="visible", timeout=10_000)
            progress = frame.locator("#progressPct").inner_text()
            if progress != "100%":
                raise SystemExit(f"{mode} extraction did not reach 100%: {progress}")

            output_path = RESULT_DIR / f"{args.browser}{suffix}"
            with page.expect_download(timeout=30_000) as download_info:
                frame.locator("#downloadBtn").click()
            download = download_info.value
            download.save_as(str(output_path))
            if not output_path.is_file() or output_path.stat().st_size == 0:
                raise SystemExit(f"{mode} extraction produced an empty file")
            outputs[mode] = {
                "bytes": output_path.stat().st_size,
                "suggestedFilename": download.suggested_filename,
                "probe": probe(output_path),
            }

        mka_streams = outputs["mka"]["probe"].get("streams", [])
        mka_audio = [s for s in mka_streams if s.get("codec_type") == "audio"]
        if len(mka_audio) != 1 or mka_audio[0].get("codec_name") != "aac":
            raise SystemExit(f"MKA stream-copy output is not one AAC audio stream: {mka_streams}")
        if any(s.get("codec_type") == "video" for s in mka_streams):
            raise SystemExit("MKA output unexpectedly contains video")

        mp3_streams = outputs["mp3"]["probe"].get("streams", [])
        mp3_audio = [s for s in mp3_streams if s.get("codec_type") == "audio"]
        if len(mp3_audio) != 1:
            raise SystemExit(f"MP3 output stream count mismatch: {mp3_streams}")
        mp3 = mp3_audio[0]
        if mp3.get("codec_name") != "mp3":
            raise SystemExit(f"MP3 output codec mismatch: {mp3}")
        if int(mp3.get("sample_rate", 0)) != 16000:
            raise SystemExit(f"MP3 output sample rate mismatch: {mp3}")
        if int(mp3.get("channels", 0)) != 1:
            raise SystemExit(f"MP3 output channel count mismatch: {mp3}")

        if diagnostics["consoleErrors"] or diagnostics["pageErrors"] or diagnostics["httpFailures"]:
            raise SystemExit("Audio Extractor E2E emitted browser/runtime/network errors")

        diagnostics["outputs"] = outputs
        diagnostics["status"] = "pass"
        print(json.dumps(diagnostics, indent=2))
        context.close()
        browser.close()
finally:
    (RESULT_DIR / f"{args.browser}.json").write_text(
        json.dumps(diagnostics, indent=2) + "\n", encoding="utf-8"
    )
    server.shutdown()
    server.server_close()
