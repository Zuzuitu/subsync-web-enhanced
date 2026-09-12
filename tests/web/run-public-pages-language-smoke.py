#!/usr/bin/env python3
import json
import os
import tempfile
import time
import urllib.request
import wave
from pathlib import Path

from playwright.sync_api import sync_playwright

PREVIEW_URL = os.environ.get(
    "SUBSYNC2_PREVIEW_URL",
    "https://zuzuitu.github.io/subsync-web-enhanced/",
).rstrip("/") + "/"
RESULT = Path("tests/generated/public-pages-language-smoke.json")

LANGUAGES = [
    {
        "code": "ita",
        "name": "Italian",
        "dictionary": "dict-eng-ita.zip",
        "speech": "speech-ita.zip",
        "target": "amico famiglia persone musica strada mattina polizia domanda risposta finestra",
    },
    {
        "code": "fre",
        "name": "French",
        "dictionary": "dict-eng-fre.zip",
        "speech": "speech-fre.zip",
        "target": "ami famille personnes musique rue matin police question réponse fenêtre",
    },
    {
        "code": "spa",
        "name": "Spanish",
        "dictionary": "dict-eng-spa.zip",
        "speech": "speech-spa.zip",
        "target": "amigo familia personas música calle mañana policía pregunta respuesta ventana",
    },
]

ENGLISH_TEXT = "friend family people music street morning police question answer window"


def fetch_json_with_retry(url, attempts=12, delay=5):
    last_error = None
    for _ in range(attempts):
        try:
            request = urllib.request.Request(
                url,
                headers={"User-Agent": "SubSync2-Public-Pages-Smoke"},
            )
            with urllib.request.urlopen(request, timeout=30) as response:
                if response.status != 200:
                    raise RuntimeError(f"HTTP {response.status} for {url}")
                return json.loads(response.read().decode("utf-8"))
        except Exception as exc:
            last_error = exc
            time.sleep(delay)
    raise SystemExit(f"Could not fetch {url}: {last_error}")


def write_srt(path, text, offset=0):
    words = text.split()
    midpoint = max(1, len(words) // 2)
    parts = [" ".join(words[:midpoint]), " ".join(words[midpoint:])]
    starts = [1 + offset, 6 + offset]
    ends = [3 + offset, 8 + offset]
    chunks = []
    for index, (start, end, body) in enumerate(zip(starts, ends, parts), start=1):
        chunks.append(
            f"{index}\n"
            f"00:00:{start:02d},000 --> 00:00:{end:02d},000\n"
            f"{body}\n"
        )
    path.write_text("\n".join(chunks), encoding="utf-8")


def write_silence_wav(path, seconds=2):
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16000)
        wav.writeframes(b"\x00\x00" * 16000 * seconds)


def wait_for_terminal(page, timeout=180_000):
    page.wait_for_function(
        """() => {
          const text = document.querySelector('#subsync_app')?.innerText || '';
          const popup = Array.from(document.querySelectorAll('#subsync_app .popup'))
            .map(node => node.innerText || '')
            .join('\n');
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
    app_text = page.locator("#subsync_app").inner_text()
    popups = page.locator("#subsync_app .popup")
    popup_text = popups.last.inner_text() if popups.count() else ""
    if "Synchronization failed" in popup_text:
        raise SystemExit("Live PWA reported hard synchronization failure: " + popup_text)
    return app_text, popup_text


def assert_asset_response(responses, filename):
    matches = [
        item
        for item in responses
        if item["url"].split("?", 1)[0].endswith("/assets/data/" + filename)
    ]
    if not matches:
        raise SystemExit(f"Live PWA never requested {filename}")
    if not any(item["status"] == 200 for item in matches):
        raise SystemExit(
            f"Live PWA did not receive HTTP 200 for {filename}: "
            + json.dumps(matches, indent=2)
        )
    return matches


manifest = fetch_json_with_retry(PREVIEW_URL + "assets/data/upstream-manifest.json")
if manifest.get("selectedCount") != 226:
    raise SystemExit(
        f"Unexpected public mirror package count: {manifest.get('selectedCount')} != 226"
    )
if manifest.get("totalBytes") != 528928835:
    raise SystemExit(
        f"Unexpected public mirror byte count: {manifest.get('totalBytes')} != 528928835"
    )
if len(manifest.get("assets", [])) != 226:
    raise SystemExit("Public mirror manifest does not list all 226 packages")
if not all(item.get("signatureVerified") is True for item in manifest["assets"]):
    raise SystemExit("Public mirror manifest contains an unverified package")

diagnostics = {
    "previewUrl": PREVIEW_URL,
    "status": "running",
    "publicManifest": {
        "selectedCount": manifest["selectedCount"],
        "totalBytes": manifest["totalBytes"],
        "assetIndexSha256": manifest.get("assetIndexSha256"),
        "signingKeySha256": manifest.get("signingKeySha256"),
    },
    "languages": [],
}

with tempfile.TemporaryDirectory(prefix="subsync2-public-pages-languages-") as tmp:
    tmpdir = Path(tmp)
    reference_srt = tmpdir / "reference.eng.srt"
    write_srt(reference_srt, ENGLISH_TEXT)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        for language in LANGUAGES:
            target_srt = tmpdir / f"target.{language['code']}.srt"
            audio_wav = tmpdir / f"reference.{language['code']}.wav"
            write_srt(target_srt, language["target"], offset=2)
            write_silence_wav(audio_wav)

            entry = {
                "code": language["code"],
                "name": language["name"],
                "dictionaryAsset": language["dictionary"],
                "speechAsset": language["speech"],
                "dictionary": {},
                "speech": {},
            }

            # Dictionary path: English subtitle reference -> non-primary subtitle.
            context = browser.new_context()
            page = context.new_page()
            responses = []
            console_errors = []
            page_errors = []
            page.on(
                "response",
                lambda response: responses.append(
                    {"status": response.status, "url": response.url}
                ),
            )
            page.on(
                "console",
                lambda msg: console_errors.append(msg.text)
                if msg.type == "error"
                else None,
            )
            page.on("pageerror", lambda exc: page_errors.append(str(exc)))

            page.goto(PREVIEW_URL, wait_until="load", timeout=60_000)
            page.wait_for_selector("#subsync_app", timeout=30_000)

            sub_input = page.locator('input[name="streams-group-sub-file"]')
            ref_input = page.locator('input[name="streams-group-ref-file"]')
            sub_input.set_input_files(str(target_srt))
            sub_group = sub_input.locator("xpath=..")
            sub_group.locator('input[type="radio"]').first.wait_for(
                state="attached", timeout=30_000
            )
            sub_group.locator("select").first.select_option(language["code"])

            ref_input.set_input_files(str(reference_srt))
            ref_group = ref_input.locator("xpath=..")
            ref_group.locator('input[type="radio"]').first.wait_for(
                state="attached", timeout=30_000
            )
            ref_group.locator("select").first.select_option("eng")

            page.get_by_role("button", name="Start", exact=True).click()
            app_text, popup_text = wait_for_terminal(page)
            dict_responses = assert_asset_response(responses, language["dictionary"])

            if console_errors or page_errors:
                raise SystemExit(
                    f"{language['name']} dictionary path emitted browser errors: "
                    + json.dumps(
                        {"console": console_errors, "page": page_errors},
                        ensure_ascii=False,
                    )
                )

            entry["dictionary"] = {
                "responses": dict_responses,
                "terminalText": app_text,
                "popupText": popup_text,
                "consoleErrors": console_errors,
                "pageErrors": page_errors,
            }
            context.close()

            # Speech path: non-primary WAV reference -> same-language subtitle.
            context = browser.new_context()
            page = context.new_page()
            responses = []
            console_errors = []
            page_errors = []
            page.on(
                "response",
                lambda response: responses.append(
                    {"status": response.status, "url": response.url}
                ),
            )
            page.on(
                "console",
                lambda msg: console_errors.append(msg.text)
                if msg.type == "error"
                else None,
            )
            page.on("pageerror", lambda exc: page_errors.append(str(exc)))

            page.goto(PREVIEW_URL, wait_until="load", timeout=60_000)
            page.wait_for_selector("#subsync_app", timeout=30_000)

            sub_input = page.locator('input[name="streams-group-sub-file"]')
            ref_input = page.locator('input[name="streams-group-ref-file"]')
            sub_input.set_input_files(str(target_srt))
            sub_group = sub_input.locator("xpath=..")
            sub_group.locator('input[type="radio"]').first.wait_for(
                state="attached", timeout=30_000
            )
            sub_group.locator("select").first.select_option(language["code"])

            ref_input.set_input_files(str(audio_wav))
            ref_group = ref_input.locator("xpath=..")
            ref_group.locator('input[type="radio"]').first.wait_for(
                state="attached", timeout=30_000
            )
            ref_group.locator("select").first.select_option(language["code"])

            page.get_by_role("button", name="Start", exact=True).click()
            app_text, popup_text = wait_for_terminal(page)
            speech_responses = assert_asset_response(responses, language["speech"])

            if console_errors or page_errors:
                raise SystemExit(
                    f"{language['name']} speech path emitted browser errors: "
                    + json.dumps(
                        {"console": console_errors, "page": page_errors},
                        ensure_ascii=False,
                    )
                )

            entry["speech"] = {
                "responses": speech_responses,
                "terminalText": app_text,
                "popupText": popup_text,
                "consoleErrors": console_errors,
                "pageErrors": page_errors,
            }
            context.close()

            diagnostics["languages"].append(entry)

        browser.close()

diagnostics["status"] = "pass"
RESULT.parent.mkdir(parents=True, exist_ok=True)
RESULT.write_text(
    json.dumps(diagnostics, indent=2, ensure_ascii=False) + "\n",
    encoding="utf-8",
)
print(json.dumps(diagnostics, indent=2, ensure_ascii=False))
