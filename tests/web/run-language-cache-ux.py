#!/usr/bin/env python3
import functools
import http.server
import json
import shutil
import socketserver
import tempfile
import threading
import wave
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
DIST = ROOT / "web" / "dist"
RESULT = ROOT / "tests" / "generated" / "web-language-cache-ux.json"

fixture_ctx = tempfile.TemporaryDirectory(prefix="subsync2-language-cache-")
fixture_dir = Path(fixture_ctx.name)
sub_path = fixture_dir / "target.rum.srt"
audio_path = fixture_dir / "reference.eng.wav"

sub_path.write_text(
    """1
00:00:00,100 --> 00:00:00,400
prieten familie oameni muzică stradă

2
00:00:00,500 --> 00:00:00,900
dimineață poliție întrebare răspuns fereastră
""",
    encoding="utf-8",
)

with wave.open(str(audio_path), "wb") as wav:
    wav.setnchannels(1)
    wav.setsampwidth(2)
    wav.setframerate(16000)
    wav.writeframes(b"\x00\x00" * 16000)

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

TERMINAL_STATES = [
    "Subtitles synchronized",
    "No need to synchronize",
    "Couldn't synchronize",
    "Synchronization inconclusive",
    "Synchronization terminated",
]

def install_transition_recorder(page):
    page.evaluate(
        """() => {
          window.__assetTransitions = [];
          const record = () => {
            for (const item of document.querySelectorAll('[data-asset-name]')) {
              const value = [
                item.dataset.assetName,
                item.dataset.assetState,
                item.textContent
              ].join('|');
              if (!window.__assetTransitions.includes(value)) {
                window.__assetTransitions.push(value);
              }
            }
          };
          const root = document.querySelector('#subsync_app');
          new MutationObserver(record).observe(root, {
            subtree: true,
            childList: true,
            attributes: true,
            characterData: true,
          });
          record();
        }"""
    )

def select_inputs(page):
    sub_input = page.locator('input[name="streams-group-sub-file"]')
    ref_input = page.locator('input[name="streams-group-ref-file"]')

    sub_input.set_input_files(str(sub_path))
    sub_group = sub_input.locator("xpath=..")
    sub_group.locator('input[type="radio"]').first.wait_for(
        state="attached", timeout=30_000
    )
    sub_group.locator("select").first.select_option("rum")

    ref_input.set_input_files(str(audio_path))
    ref_group = ref_input.locator("xpath=..")
    ref_group.locator('input[type="radio"]').first.wait_for(
        state="attached", timeout=30_000
    )
    ref_group.locator("select").first.select_option("eng")

def wait_terminal(page):
    page.wait_for_function(
        """states => {
          const text = document.querySelector('#subsync_app')?.innerText || '';
          return states.some(value => text.includes(value));
        }""",
        TERMINAL_STATES,
        timeout=180_000,
    )
    return page.locator("#subsync_app").inner_text()

def asset_zip_responses(responses):
    return [
        item for item in responses
        if item["url"].split("?", 1)[0].endswith(
            ("/assets/data/speech-eng.zip", "/assets/data/dict-eng-rum.zip")
        )
    ]

diagnostics = {
    "url": url,
    "status": "running",
    "firstRun": {},
    "secondRun": {},
    "clearCache": {},
}

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
        page.on(
            "console",
            lambda msg: console_errors.append(msg.text)
            if msg.type == "error"
            else None,
        )
        page.on("pageerror", lambda exc: page_errors.append(str(exc)))
        page.on(
            "response",
            lambda response: responses.append(
                {"status": response.status, "url": response.url}
            ),
        )

        # First run: both required assets must be downloaded, extracted and stored.
        page.goto(url, wait_until="load")
        page.wait_for_selector("#subsync_app", timeout=30_000)
        install_transition_recorder(page)
        select_inputs(page)
        page.get_by_role("button", name="Start", exact=True).click()

        page.wait_for_function(
            """() => {
              const items = Array.from(document.querySelectorAll('[data-asset-state]'));
              return items.length >= 2 && items.every(item => item.dataset.assetState === 'ready');
            }""",
            timeout=120_000,
        )
        first_terminal = wait_terminal(page)
        first_transitions = page.evaluate("window.__assetTransitions")
        first_responses = asset_zip_responses(responses)

        for name in ("dict/eng-rum", "speech/eng"):
            states = [
                transition.split("|", 2)[1]
                for transition in first_transitions
                if transition.startswith(name + "|")
            ]
            for required in ("downloading", "extracting", "ready"):
                if required not in states:
                    raise SystemExit(
                        f"First-run asset lifecycle for {name} missed {required}: {states}"
                    )

        if len([item for item in first_responses if item["status"] == 200]) < 2:
            raise SystemExit(
                "First run did not fetch both primary language packages with HTTP 200: "
                + json.dumps(first_responses, indent=2)
            )

        diagnostics["firstRun"] = {
            "transitions": first_transitions,
            "assetResponses": first_responses,
            "terminalState": first_terminal,
        }

        # Second run in the same browser origin: IDBFS must serve both assets as cached.
        responses.clear()
        page.goto(url, wait_until="load")
        page.wait_for_selector("#subsync_app", timeout=30_000)
        install_transition_recorder(page)
        select_inputs(page)
        page.get_by_role("button", name="Start", exact=True).click()

        page.wait_for_function(
            """() => {
              const items = Array.from(document.querySelectorAll('[data-asset-state]'));
              return items.length >= 2 && items.every(item => item.dataset.assetState === 'cached');
            }""",
            timeout=60_000,
        )
        second_terminal = wait_terminal(page)
        second_transitions = page.evaluate("window.__assetTransitions")
        second_responses = asset_zip_responses(responses)

        for name in ("dict/eng-rum", "speech/eng"):
            states = [
                transition.split("|", 2)[1]
                for transition in second_transitions
                if transition.startswith(name + "|")
            ]
            if "cached" not in states:
                raise SystemExit(
                    f"Second run did not report cached asset {name}: {states}"
                )

        if second_responses:
            raise SystemExit(
                "Cached second run unexpectedly downloaded language ZIPs: "
                + json.dumps(second_responses, indent=2)
            )

        diagnostics["secondRun"] = {
            "transitions": second_transitions,
            "assetResponses": second_responses,
            "terminalState": second_terminal,
        }

        # Cache management UI: list stored packages, clear them, and persist deletion.
        page.get_by_role("button", name="Back", exact=True).click()
        page.get_by_role("button", name="Advanced options", exact=True).click()
        popup = page.locator("#subsync_app .popup").last
        popup.wait_for(state="visible", timeout=10_000)
        page.wait_for_function(
            """() => {
              const popup = Array.from(document.querySelectorAll('#subsync_app .popup')).at(-1);
              return popup && popup.innerText.includes('2 cached packages');
            }""",
            timeout=30_000,
        )

        cached_items = popup.locator("[data-cached-asset]")
        cached_names = [
            cached_items.nth(i).get_attribute("data-cached-asset")
            for i in range(cached_items.count())
        ]
        if sorted(cached_names) != ["dict/eng-rum", "speech/eng"]:
            raise SystemExit(f"Unexpected cache-management list: {cached_names}")

        page.once("dialog", lambda dialog: dialog.accept())
        popup.get_by_role(
            "button", name="Clear downloaded language data", exact=True
        ).click()
        page.wait_for_function(
            """() => {
              const popup = Array.from(document.querySelectorAll('#subsync_app .popup')).at(-1);
              return popup && popup.innerText.includes('No downloaded language data.');
            }""",
            timeout=30_000,
        )
        if popup.locator("[data-cached-asset]").count() != 0:
            raise SystemExit("Cache entries remained visible after clearing")

        # Reload to prove the IDBFS deletion was persisted, not only reflected in memory.
        page.goto(url, wait_until="load")
        page.wait_for_selector("#subsync_app", timeout=30_000)
        page.get_by_role("button", name="Advanced options", exact=True).click()
        popup = page.locator("#subsync_app .popup").last
        popup.wait_for(state="visible", timeout=10_000)
        page.wait_for_function(
            """() => {
              const popup = Array.from(document.querySelectorAll('#subsync_app .popup')).at(-1);
              return popup && popup.innerText.includes('No downloaded language data.');
            }""",
            timeout=30_000,
        )

        diagnostics["clearCache"] = {
            "cachedNamesBeforeClear": cached_names,
            "persistedEmptyAfterReload": True,
        }
        diagnostics["consoleErrors"] = console_errors
        diagnostics["pageErrors"] = page_errors
        diagnostics["status"] = "pass"

        RESULT.parent.mkdir(parents=True, exist_ok=True)
        RESULT.write_text(
            json.dumps(diagnostics, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        print(json.dumps(diagnostics, indent=2, ensure_ascii=False))

        context.close()
        browser.close()

        if console_errors or page_errors:
            raise SystemExit("Language cache UX emitted browser/runtime errors")
finally:
    server.shutdown()
    server.server_close()
    pages_root_ctx.cleanup()
    fixture_ctx.cleanup()
