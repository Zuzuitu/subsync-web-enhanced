#!/usr/bin/env python3
import json
import os
import re
import shutil
from pathlib import Path

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError, sync_playwright

from srt_timing import measure_srt_timing

ROOT = Path(__file__).resolve().parents[2]
FIXTURE_DIR = ROOT / "tests" / "generated" / "romanian-audio-e2e"
SRT_IN = FIXTURE_DIR / "target.rum.srt"
MKV_IN = FIXTURE_DIR / "reference-romanian.mkv"
RESULT = FIXTURE_DIR / "public-pages-romanian-audio.json"
SAVED = FIXTURE_DIR / "public-pages-output.rum.srt"
PREVIEW_URL = os.environ.get(
    "SUBSYNC2_PREVIEW_URL",
    "https://zuzuitu.github.io/subsync-web-enhanced/",
).rstrip("/") + "/"
MIN_CORRELATION_BUCKETS = 20
MIN_SPARSE_CUES = 64
MIN_SPARSE_CUES_PER_MINUTE = 8.0
REQUIRE_CONTEXT_ANCHORS = os.environ.get("SUBSYNC2_REQUIRE_CONTEXT_ANCHORS", "0") == "1"
REQUIRE_FINE_TIMING = os.environ.get("SUBSYNC2_REQUIRE_FINE_TIMING", "0") == "1"


def parse_srt_start(text):
    match = re.search(r"(?m)^(\d{2}):(\d{2}):(\d{2}),(\d{3})\s+-->", text)
    if not match:
        raise SystemExit("Could not parse first SRT cue timestamp")
    h, m, s, ms = map(int, match.groups())
    return h * 3600 + m * 60 + s + ms / 1000


browser_path = (
    shutil.which("google-chrome")
    or shutil.which("google-chrome-stable")
    or shutil.which("chromium")
    or shutil.which("chromium-browser")
)

fixture = json.loads((FIXTURE_DIR / "fixture.json").read_text(encoding="utf-8"))
cue_count = len(fixture.get("phrases", []))
if fixture.get("sparseRegression"):
    if fixture.get("speechLayout") != "distributed":
        raise SystemExit("Public Romanian sparse E2E fixture is not distributed across the timeline")
    if float(fixture.get("speechSpanRatio", 0)) < 0.85:
        raise SystemExit(
            "Public Romanian sparse E2E fixture does not span enough of the timeline: "
            + str(fixture.get("speechSpanRatio"))
        )
    if cue_count < MIN_SPARSE_CUES:
        raise SystemExit(
            f"Public Romanian sparse E2E fixture has only {cue_count} cues; "
            f"expected at least {MIN_SPARSE_CUES}"
        )
    if float(fixture.get("cueDensityPerMinute", 0)) < MIN_SPARSE_CUES_PER_MINUTE:
        raise SystemExit(
            "Public Romanian sparse E2E fixture cue density is too low: "
            + str(fixture.get("cueDensityPerMinute"))
        )
if cue_count <= MIN_CORRELATION_BUCKETS:
    raise SystemExit(
        f"Romanian E2E fixture has only {cue_count} cues; "
        f"canonical correlation requires {MIN_CORRELATION_BUCKETS}"
    )

with sync_playwright() as p:
    launch = {
        "headless": True,
        "args": ["--no-sandbox", "--disable-dev-shm-usage"],
    }
    if browser_path:
        launch["executable_path"] = browser_path
    browser = p.chromium.launch(**launch)
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
    page.on(
        "response",
        lambda response: (
            responses.append({"status": response.status, "url": response.url}),
            http_failures.append({"status": response.status, "url": response.url})
            if response.status >= 400
            else None,
        ),
    )

    page.goto(PREVIEW_URL, wait_until="load", timeout=60_000)
    page.wait_for_selector("#subsync_app", timeout=30_000)

    page.evaluate("""() => {
      window.__roAsrTransitions = [];
      const record = () => {
        for (const item of document.querySelectorAll('[data-asset-name="asr/rum"]')) {
          const value = [item.dataset.assetName, item.dataset.assetState, item.textContent].join('|');
          if (!window.__roAsrTransitions.includes(value)) {
            window.__roAsrTransitions.push(value);
          }
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
        details = {
            "status": "timeout",
            "url": PREVIEW_URL,
            "detectedReferenceLanguage": detected,
            "appText": page.locator("#subsync_app").inner_text(),
            "assetTransitions": page.evaluate("window.__roAsrTransitions"),
            "responses": responses,
            "consoleMessages": console_messages,
            "consoleErrors": console_errors,
            "pageErrors": page_errors,
            "httpFailures": http_failures,
        }
        RESULT.write_text(json.dumps(details, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(json.dumps(details, indent=2, ensure_ascii=False))
        raise

    app_text = page.locator("#subsync_app").inner_text()
    if "Subtitles synchronized" not in app_text:
        raise SystemExit("Public Pages Romanian audio workflow did not synchronize: " + app_text)

    transitions = page.evaluate("window.__roAsrTransitions")
    states = [entry.split("|", 2)[1] for entry in transitions]
    for required in ("downloading", "verifying", "storing", "ready"):
        if required not in states:
            raise SystemExit(f"Public Romanian ASR asset lifecycle missed {required}: {states}")

    model_responses = [
        item
        for item in responses
        if item["url"].split("?", 1)[0].endswith("/assets/data/ggml-tiny-q5_1.bin")
    ]
    if not any(item["status"] == 200 for item in model_responses):
        raise SystemExit("Public Pages Romanian Whisper model was not fetched successfully")

    whisper_js = [
        item
        for item in responses
        if item["url"].split("?", 1)[0].endswith("/scripts/whisper.js")
    ]
    whisper_wasm = [
        item
        for item in responses
        if item["url"].split("?", 1)[0].endswith("/scripts/whisper.wasm")
    ]
    if not any(item["status"] == 200 for item in whisper_js):
        raise SystemExit("Public Pages whisper.js was not fetched successfully")
    if not any(item["status"] == 200 for item in whisper_wasm):
        raise SystemExit("Public Pages whisper.wasm was not fetched successfully")

    evidence_match = re.search(r"reference words:\s*(\d+)", app_text)
    if not evidence_match:
        raise SystemExit("Public Romanian audio workflow did not expose reference-word diagnostics")
    reference_words = int(evidence_match.group(1))
    if reference_words < 20:
        raise SystemExit(f"Public Romanian ASR produced too few usable reference words: {reference_words}")

    anchor_match = re.search(r"context anchors:\s*(\d+)", app_text)
    context_anchors = int(anchor_match.group(1)) if anchor_match else 0
    if REQUIRE_CONTEXT_ANCHORS and context_anchors <= 0:
        raise SystemExit(
            "Post-deploy Romanian audio workflow produced no lexical context anchors"
        )

    probe_match = re.search(
        r"Romanian probes:\s*(\d+)\s*/\s*(\d+).*adaptive lock:\s*verified",
        app_text,
    )
    if not probe_match:
        raise SystemExit(
            "Public Romanian audio workflow did not expose a verified adaptive convergence lock: "
            + app_text
        )
    completed_probes, total_probes = map(int, probe_match.groups())
    if completed_probes >= total_probes:
        raise SystemExit(
            f"Public Romanian adaptive ASR did not stop early: "
            f"{completed_probes}/{total_probes} probes"
        )

    page.get_by_text("Show details", exact=True).click()
    details_strong = page.locator("#subsync_app dd:not([hidden]) strong")
    if details_strong.count() < 5:
        raise SystemExit(f"Public synchronization details exposed only {details_strong.count()} values")
    points = details_strong.nth(1).inner_text()
    correlation = details_strong.nth(2).inner_text()
    formula = details_strong.nth(3).inner_text()
    max_change = details_strong.nth(4).inner_text()

    precision_evidence_row = page.locator('[data-diagnostic="precision-evidence"]')
    precision_robustness_row = page.locator('[data-diagnostic="precision-robustness"]')
    if precision_evidence_row.is_hidden() or precision_robustness_row.is_hidden():
        raise SystemExit("Public Romanian audio workflow did not expose precision diagnostics")
    precision_evidence = precision_evidence_row.inner_text()
    precision_robustness = precision_robustness_row.inner_text()
    thirds = re.search(r"thirds\s+(\d+)/(\d+)/(\d+)", precision_evidence)
    buckets_match = re.search(r"(\d+)\s+cue buckets", precision_evidence)
    if not thirds or not buckets_match:
        raise SystemExit("Public Romanian precision evidence is malformed: " + precision_evidence)
    precision_buckets = int(buckets_match.group(1))
    precision_thirds = tuple(map(int, thirds.groups()))
    if precision_buckets < MIN_CORRELATION_BUCKETS:
        raise SystemExit(
            f"Public Romanian precision diagnostics exposed only {precision_buckets} canonical cue buckets"
        )
    if any(value <= 0 for value in precision_thirds):
        raise SystemExit(
            f"Public Romanian precision evidence did not cover all title thirds: {precision_thirds}"
        )
    if not re.search(r"leave-one-cue max\s+\d+\s+ms", precision_robustness):
        raise SystemExit("Public Romanian formula sensitivity is malformed: " + precision_robustness)

    save_button = page.get_by_role("button", name="Save subtitles", exact=True)
    if save_button.is_disabled():
        raise SystemExit("Public Romanian audio workflow did not enable subtitle save")
    save_button.click()
    popup = page.locator("#subsync_app .popup").last
    popup.wait_for(state="visible", timeout=10_000)
    links = popup.locator("a:not(.popup_close)")
    if links.count() < 1:
        raise SystemExit("Public save popup did not expose an output format")

    with page.expect_download(timeout=30_000) as download_info:
        links.first.click()
    download_info.value.save_as(str(SAVED))

    original = SRT_IN.read_text(encoding="utf-8")
    output = SAVED.read_text(encoding="utf-8")
    shift = parse_srt_start(output) - parse_srt_start(original)
    expected_shift = -8.0
    max_fine_timing_error = 0.60
    timing_quality = measure_srt_timing(original, output, expected_shift)
    if REQUIRE_FINE_TIMING:
        if abs(shift - expected_shift) > max_fine_timing_error:
            raise SystemExit(
                f"Public Romanian audio fine timing error too large: {shift:.3f}s "
                f"(expected {expected_shift:.3f}s ± {max_fine_timing_error:.2f}s)"
            )
        if timing_quality["startP95AbsErrorSeconds"] > max_fine_timing_error:
            raise SystemExit(
                "Public Romanian audio full-title timing error too large: "
                f"p95={timing_quality['startP95AbsErrorSeconds']:.3f}s "
                f"(limit {max_fine_timing_error:.2f}s)"
            )
        if abs(timing_quality["affineErrorDriftAcrossTitleSeconds"]) > 0.35:
            raise SystemExit(
                "Public Romanian audio timing drift too large across title: "
                f"{timing_quality['affineErrorDriftAcrossTitleSeconds']:.3f}s "
                "(limit ±0.35s)"
            )

    required_diacritics = [
        "așteaptă", "dimineață", "împreună", "poliția",
        "mulțumesc", "părintele", "înțelegem", "niciodată",
    ]
    missing = [token for token in required_diacritics if token not in output.lower()]
    if missing:
        raise SystemExit("Public saved Romanian subtitles lost text/diacritics: " + ", ".join(missing))

    details = {
        "status": "pass",
        "browser": "chromium",
        "url": PREVIEW_URL,
        "detectedReferenceLanguage": detected,
        "referenceWords": reference_words,
        "romanianContextAnchors": context_anchors,
        "romanianAdaptiveProbesCompleted": completed_probes,
        "romanianAdaptiveProbesTotal": total_probes,
        "assetTransitions": transitions,
        "modelResponses": model_responses,
        "whisperJsResponses": whisper_js,
        "whisperWasmResponses": whisper_wasm,
        "pointsText": points,
        "correlationText": correlation,
        "formulaText": formula,
        "maxChangeText": max_change,
        "precisionEvidenceText": precision_evidence,
        "precisionRobustnessText": precision_robustness,
        "precisionBuckets": precision_buckets,
        "precisionThirdBuckets": precision_thirds,
        "savedTimingShiftSeconds": shift,
        "timingQuality": timing_quality,
        "strictFineTimingRequired": REQUIRE_FINE_TIMING,
        "romanianDiacriticsVerifiedInSavedSubtitle": required_diacritics,
        "consoleErrors": console_errors,
        "pageErrors": page_errors,
        "httpFailures": http_failures,
    }
    RESULT.write_text(json.dumps(details, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(details, indent=2, ensure_ascii=False))

    context.close()
    browser.close()

    if console_errors or page_errors or http_failures:
        raise SystemExit("Public Romanian audio workflow emitted browser/runtime errors")
