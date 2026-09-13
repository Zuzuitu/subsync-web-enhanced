#!/usr/bin/env python3
import argparse
import functools
import http.server
import json
import re
import shutil
import socketserver
import tempfile
import threading
from pathlib import Path

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError, sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument("--browser", choices=("chromium", "webkit"), default="chromium")
args = parser.parse_args()

ROOT = Path(__file__).resolve().parents[2]
DIST = ROOT / "web" / "dist"
FIXTURE_DIR = ROOT / "tests" / "generated" / "romanian-audio-e2e"
SRT_IN = FIXTURE_DIR / "target.rum.srt"
MKV_IN = FIXTURE_DIR / "reference-romanian.mkv"
RESULT = FIXTURE_DIR / f"{args.browser}-romanian-audio.json"
SAVED = FIXTURE_DIR / f"{args.browser}-output.rum.srt"
MIN_CORRELATION_BUCKETS = 20
MIN_SPARSE_CUES = 64
MIN_SPARSE_CUES_PER_MINUTE = 8.0

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

def parse_srt_start(text):
    match = re.search(r"(?m)^(\d{2}):(\d{2}):(\d{2}),(\d{3})\s+-->", text)
    if not match:
        raise SystemExit("Could not parse first SRT cue timestamp")
    h, m, s, ms = map(int, match.groups())
    return h * 3600 + m * 60 + s + ms / 1000

pages_root_ctx = tempfile.TemporaryDirectory(prefix="subsync2-ro-asr-pages-")
pages_root = Path(pages_root_ctx.name)
pages_base = "subsync-web-enhanced"
(pages_root / pages_base).symlink_to(DIST, target_is_directory=True)

handler = functools.partial(QuietHandler, directory=str(pages_root))
server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler)
server.daemon_threads = True
threading.Thread(target=server.serve_forever, daemon=True).start()
url = f"http://127.0.0.1:{server.server_address[1]}/{pages_base}/"

browser_path = (
    shutil.which("google-chrome")
    or shutil.which("google-chrome-stable")
    or shutil.which("chromium")
    or shutil.which("chromium-browser")
)

try:
    with sync_playwright() as p:
        if args.browser == "chromium":
            launch = {
                "headless": True,
                "args": ["--no-sandbox", "--disable-dev-shm-usage"],
            }
            if browser_path:
                launch["executable_path"] = browser_path
            browser = p.chromium.launch(**launch)
        else:
            browser = p.webkit.launch(headless=True)
        context = browser.new_context(accept_downloads=True)
        page = context.new_page()

        console_messages = []
        console_errors = []
        page_errors = []
        http_failures = []
        responses = []
        def record_console(msg):
            entry = {"type": msg.type, "text": msg.text}
            console_messages.append(entry)
            if msg.type == "error":
                console_errors.append(msg.text)
        page.on("console", record_console)
        page.on("pageerror", lambda exc: page_errors.append(str(exc)))
        page.on("response", lambda response: (
            responses.append({"status": response.status, "url": response.url}),
            http_failures.append({"status": response.status, "url": response.url})
                if response.status >= 400 else None
        ))

        fixture = json.loads((FIXTURE_DIR / "fixture.json").read_text(encoding="utf-8"))
        cue_count = len(fixture.get("phrases", []))
        if fixture.get("sparseRegression"):
            if fixture.get("speechLayout") != "distributed":
                raise SystemExit("Romanian sparse E2E fixture is not distributed across the timeline")
            if float(fixture.get("speechSpanRatio", 0)) < 0.85:
                raise SystemExit(
                    "Romanian sparse E2E fixture does not span enough of the timeline: "
                    + str(fixture.get("speechSpanRatio"))
                )
            if cue_count < MIN_SPARSE_CUES:
                raise SystemExit(
                    f"Romanian sparse E2E fixture has only {cue_count} cues; "
                    f"expected at least {MIN_SPARSE_CUES}"
                )
            if float(fixture.get("cueDensityPerMinute", 0)) < MIN_SPARSE_CUES_PER_MINUTE:
                raise SystemExit(
                    "Romanian sparse E2E fixture cue density is too low: "
                    + str(fixture.get("cueDensityPerMinute"))
                )
        if cue_count <= MIN_CORRELATION_BUCKETS:
            raise SystemExit(
                f"Romanian E2E fixture has only {cue_count} cues; "
                f"canonical correlation requires {MIN_CORRELATION_BUCKETS}"
            )

        page.goto(url, wait_until="load")
        page.wait_for_selector("#subsync_app", timeout=30_000)

        page.evaluate("""() => {
          window.__roAsrTransitions = [];
          window.__roPrematureSaveEnabled = false;
          const record = () => {
            for (const item of document.querySelectorAll('[data-asset-name="asr/rum"]')) {
              const value = [item.dataset.assetName, item.dataset.assetState, item.textContent].join('|');
              if (!window.__roAsrTransitions.includes(value)) {
                window.__roAsrTransitions.push(value);
              }
            }
            const app = document.querySelector('#subsync_app');
            const text = app?.innerText || '';
            const save = [...(app?.querySelectorAll('button') || [])]
              .find(button => button.textContent.trim() === 'Save subtitles');
            if (text.includes('adaptive lock: pending') && save && !save.disabled) {
              window.__roPrematureSaveEnabled = true;
            }
          };
          new MutationObserver(record).observe(document.querySelector('#subsync_app'), {
            subtree: true, childList: true, attributes: true, characterData: true
          });
          record();
        }""")

        sub_input = page.locator('input[name="streams-group-sub-file"]')
        ref_input = page.locator('input[name="streams-group-ref-file"]')

        sub_input.set_input_files(str(SRT_IN))
        sub_group = sub_input.locator("xpath=..")
        sub_group.locator('input[type="radio"]').first.wait_for(state="attached", timeout=60_000)
        sub_group.locator("select").first.select_option("rum")

        ref_input.set_input_files(str(MKV_IN))
        ref_group = ref_input.locator("xpath=..")
        ref_group.locator('input[type="radio"]').first.wait_for(state="attached", timeout=60_000)
        ref_select = ref_group.locator("select").first
        detected = ref_select.input_value()
        if detected != "rum":
            raise SystemExit(f"Embedded MKV ron language did not canonicalize to rum: {detected!r}")
        ref_select.select_option("rum")

        page.get_by_role("button", name="Start", exact=True).click()

        try:
            page.wait_for_function(
                """() => {
                  const text = document.querySelector('#subsync_app')?.innerText || '';
                  return [
                    'Subtitles synchronized',
                    'No need to synchronize',
                    "Couldn't synchronize",
                    'Synchronization inconclusive',
                    'Synchronization terminated',
                    'Synchronization failed'
                  ].some(value => text.includes(value));
                }""",
                timeout=600_000,
            )
        except PlaywrightTimeoutError:
            timeout_details = {
                "status": "timeout",
                "browser": args.browser,
                "url": url,
                "detectedReferenceLanguage": detected,
                "appText": page.locator("#subsync_app").inner_text(),
                "assetTransitions": page.evaluate("window.__roAsrTransitions"),
                "responses": responses,
                "consoleMessages": console_messages,
                "consoleErrors": console_errors,
                "pageErrors": page_errors,
                "httpFailures": http_failures,
            }
            RESULT.write_text(
                json.dumps(timeout_details, indent=2, ensure_ascii=False) + "\n",
                encoding="utf-8",
            )
            print(json.dumps(timeout_details, indent=2, ensure_ascii=False))
            raise

        app_text = page.locator("#subsync_app").inner_text()
        if page.evaluate("window.__roPrematureSaveEnabled"):
            raise SystemExit(
                "Romanian Save subtitles became enabled before adaptive lock verification"
            )
        if "Subtitles synchronized" not in app_text:
            raise SystemExit("Romanian audio PWA workflow did not synchronize: " + app_text)

        transitions = page.evaluate("window.__roAsrTransitions")
        states = [entry.split("|", 2)[1] for entry in transitions]
        for required in ("downloading", "verifying", "storing", "ready"):
            if required not in states:
                raise SystemExit(f"Romanian ASR asset lifecycle missed {required}: {states}")

        model_responses = [
            item for item in responses
            if item["url"].split("?", 1)[0].endswith("/assets/data/ggml-tiny-q5_1.bin")
        ]
        if not any(item["status"] == 200 for item in model_responses):
            raise SystemExit("Romanian Whisper model was not fetched successfully")

        evidence_match = re.search(r"reference words:\s*(\d+)", app_text)
        if not evidence_match:
            raise SystemExit("Romanian audio workflow did not expose reference-word diagnostics")
        reference_words = int(evidence_match.group(1))
        if reference_words < 20:
            raise SystemExit(f"Romanian ASR produced too few usable reference words: {reference_words}")

        anchor_match = re.search(r"context anchors:\s*(\d+)", app_text)
        if not anchor_match:
            raise SystemExit("Romanian audio workflow did not expose context-anchor diagnostics")
        context_anchors = int(anchor_match.group(1))
        if context_anchors <= 0:
            raise SystemExit("Romanian audio workflow produced no lexical context anchors")

        probe_match = re.search(
            r"Romanian probes:\s*(\d+)\s*/\s*(\d+).*adaptive lock:\s*verified",
            app_text,
        )
        if not probe_match:
            raise SystemExit(
                "Romanian audio workflow did not expose a verified adaptive convergence lock: "
                + app_text
            )
        completed_probes, total_probes = map(int, probe_match.groups())
        if completed_probes >= total_probes:
            raise SystemExit(
                f"Romanian adaptive ASR did not stop early: {completed_probes}/{total_probes} probes"
            )

        page.get_by_text("Show details", exact=True).click()
        details_strong = page.locator("#subsync_app dd:not([hidden]) strong")
        if details_strong.count() < 5:
            raise SystemExit(
                f"Synchronization details exposed only {details_strong.count()} values"
            )
        points = details_strong.nth(1).inner_text()
        correlation = details_strong.nth(2).inner_text()
        formula = details_strong.nth(3).inner_text()
        max_change = details_strong.nth(4).inner_text()

        save_button = page.get_by_role("button", name="Save subtitles", exact=True)
        if save_button.is_disabled():
            raise SystemExit("Romanian audio workflow did not enable subtitle save")
        save_button.click()
        popup = page.locator("#subsync_app .popup").last
        popup.wait_for(state="visible", timeout=10_000)
        links = popup.locator("a:not(.popup_close)")
        if links.count() < 1:
            raise SystemExit("Save popup did not expose an output format")

        with page.expect_download(timeout=30_000) as download_info:
            links.first.click()
        download_info.value.save_as(str(SAVED))

        original = SRT_IN.read_text(encoding="utf-8")
        output = SAVED.read_text(encoding="utf-8")
        shift = parse_srt_start(output) - parse_srt_start(original)
        if not (-9.5 <= shift <= -6.0):
            raise SystemExit(f"Romanian audio saved timing correction out of range: {shift:.3f}s")

        required_diacritics = [
            "așteaptă", "dimineață", "împreună", "poliția",
            "mulțumesc", "părintele", "înțelegem", "niciodată",
        ]
        missing = [token for token in required_diacritics if token not in output.lower()]
        if missing:
            raise SystemExit("Saved Romanian subtitles lost text/diacritics: " + ", ".join(missing))

        details = {
            "status": "pass",
            "browser": args.browser,
            "url": url,
            "detectedReferenceLanguage": detected,
            "referenceWords": reference_words,
            "romanianContextAnchors": context_anchors,
            "romanianAdaptiveProbesCompleted": completed_probes,
            "romanianAdaptiveProbesTotal": total_probes,
            "assetTransitions": transitions,
            "modelResponses": model_responses,
            "pointsText": points,
            "correlationText": correlation,
            "formulaText": formula,
            "maxChangeText": max_change,
            "savedTimingShiftSeconds": shift,
            "romanianDiacriticsVerifiedInSavedSubtitle": required_diacritics,
            "consoleErrors": console_errors,
            "pageErrors": page_errors,
            "httpFailures": http_failures,
        }
        RESULT.write_text(
            json.dumps(details, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        print(json.dumps(details, indent=2, ensure_ascii=False))

        context.close()
        browser.close()

        if console_errors or page_errors or http_failures:
            raise SystemExit("Romanian audio PWA workflow emitted browser/runtime errors")
finally:
    server.shutdown()
    server.server_close()
    pages_root_ctx.cleanup()
