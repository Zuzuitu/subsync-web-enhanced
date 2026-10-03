#!/usr/bin/env python3
"""Test the actual local detector in a worker; lexical fallback cannot mask failure."""
import argparse
import functools
import http.server
import json
import threading
from pathlib import Path
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument("--browser", choices=("chromium", "webkit"), required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
config = json.loads((root / "config/neural-vad.json").read_text())
source = (root / "web/src/extractor/neural-vad.js").read_text().replace(
    "export default class NeuralVad", "class NeuralVad")
handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(root / "web/dist"))
server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
origin = f"http://127.0.0.1:{server.server_port}"
try:
    with sync_playwright() as playwright:
        browser = getattr(playwright, args.browser).launch(headless=True)
        try:
            page = browser.new_page()
            page.goto(origin + "/icon.svg")
            result = page.evaluate("""async ({source, base}) => {
              const code = source + `\nself.onmessage = async ({data: base}) => {
                let detector;
                try {
                  detector = await NeuralVad.create(base);
                  detector.push(new Float32Array(16000), 100);
                  const first = await detector.drain(100, 101);
                  detector.push(new Float32Array(16000), 200);
                  const second = await detector.drain(200, 201);
                  detector.delete();
                  postMessage({first, second, threads: self.ort.env.wasm.numThreads});
                } catch (error) {
                  if (detector) detector.delete();
                  postMessage({error: String(error)});
                }
              };`;
              const url = URL.createObjectURL(new Blob([code], {type: 'text/javascript'}));
              const worker = new Worker(url);
              try {
                return await new Promise((resolve, reject) => {
                  const timer = setTimeout(() => reject(new Error('Voice worker timeout')), 120000);
                  worker.onmessage = event => { clearTimeout(timer); resolve(event.data); };
                  worker.onerror = error => { clearTimeout(timer); reject(new Error(error.message)); };
                  worker.postMessage(base);
                });
              } finally { worker.terminate(); URL.revokeObjectURL(url); }
            }""", {"source": source, "base": origin + "/scripts/vad/" + config["directory"] + "/"})
            assert "error" not in result, result
            assert result["threads"] == 1, result
            assert len(result["first"]) == len(result["second"]) == 4, result
            for index, (first, second) in enumerate(zip(result["first"], result["second"])):
                assert first["time"] == 100 + (index + .5) * .25
                assert second["time"] == first["time"] + 100
                assert 0 <= first["energy"] < .1, result
                assert abs(first["energy"] - second["energy"]) < 1e-6, result
            print(json.dumps({"browser": args.browser, "version": browser.version,
                              "modelSha256": config["files"][0]["sha256"], "result": result}))
        finally:
            browser.close()
finally:
    server.shutdown()
    server.server_close()
