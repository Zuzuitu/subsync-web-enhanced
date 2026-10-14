#!/usr/bin/env python3
"""Test the actual local detector in a worker; lexical fallback cannot mask failure."""
import argparse
import base64
import functools
import http.server
import json
import shutil
import subprocess
import threading
from pathlib import Path
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument("--browser", choices=("chromium", "webkit"), required=True)
parser.add_argument("--source-ref", help="Optional historical implementation for before/after reproduction")
parser.add_argument("--pcm", type=Path, help="Optional local mono 16 kHz float32 PCM, never uploaded")
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
config = json.loads((root / "config/neural-vad.json").read_text())
source = (subprocess.run(["git", "show", args.source_ref + ":web/src/extractor/neural-vad.js"],
                        cwd=root, check=True, capture_output=True, text=True).stdout
          if args.source_ref else (root / "web/src/extractor/neural-vad.js").read_text())
source = source.replace("export default class NeuralVad", "class NeuralVad")
pcm_bytes = args.pcm.read_bytes() if args.pcm else b""
if args.pcm and (len(pcm_bytes) < 16000 * 4 or len(pcm_bytes) % 4 or len(pcm_bytes) > 16000 * 64 * 4):
    raise SystemExit("PCM must contain 1–64 seconds of mono 16 kHz float32 samples")
pcm_base64 = base64.b64encode(pcm_bytes).decode("ascii")
signal_bins = ((len(pcm_bytes) // 4 // 512 * 512 - 256) // 4000 + 1) if args.pcm else 16


class Handler(http.server.SimpleHTTPRequestHandler):
    fault = None

    def do_GET(self):
        if self.fault == "module" and self.path.endswith("ort-wasm-simd-threaded.mjs"):
            self.send_error(404, "Injected module load failure")
            return
        super().do_GET()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


handler = functools.partial(Handler, directory=str(root / "web/dist"))
server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
origin = f"http://127.0.0.1:{server.server_port}"
try:
    with sync_playwright() as playwright:
        launch = {"headless": True}
        if args.browser == "chromium":
            executable = next((path for name in ("google-chrome", "google-chrome-stable",
                              "chromium", "chromium-browser") if (path := shutil.which(name))), None)
            if executable:
                launch["executable_path"] = executable
            launch["args"] = ["--no-sandbox", "--disable-dev-shm-usage"]
        browser = getattr(playwright, args.browser).launch(**launch)
        try:
            page = browser.new_page()
            page.goto(origin + "/icon.svg")
            results = []
            for fault in (("module",) if args.source_ref else (None, "module", "shared-memory")):
                Handler.fault = fault
                result = page.evaluate("""async ({source, base, fallbackBase, fault, pcmBase64}) => {
              const code = source + `\nself.onmessage = async ({data: {base, fallbackBase, fault, pcmBase64}}) => {
                let detector;
                const allocations = [];
                const Memory = WebAssembly.Memory;
                WebAssembly.Memory = function(descriptor) {
                  allocations.push({shared: Boolean(descriptor.shared), maximum: descriptor.maximum});
                  if (fault === 'shared-memory' && descriptor.shared) {
                    throw new TypeError('shared WebAssembly.Memory is unsupported');
                  }
                  return new Memory(descriptor);
                };
                WebAssembly.Memory.prototype = Memory.prototype;
                try {
                  detector = await NeuralVad.create(base, fallbackBase);
                  detector.push(new Float32Array(16000), 100);
                  const first = await detector.drain(100, 101);
                  detector.push(new Float32Array(16000), 200);
                  const second = await detector.drain(200, 201);
                  detector.beginProbe(300, 301);
                  detector.push(new Float32Array(16000 * 70), 230);
                  detector.push(new Float32Array(16000), 300);
                  detector.push(new Float32Array(16000 * 70), 301);
                  const retainedSamples = detector.count;
                  const overflowWindows = detector.overflowWindows;
                  const bounded = await detector.drain(300, 301);
                  // Deterministic, redistributable non-silent PCM exercises real
                  // recurrent inference; no movie, transcript or network model.
                  const pcm = pcmBase64
                    ? new Float32Array(Uint8Array.from(atob(pcmBase64), char => char.charCodeAt(0)).buffer)
                    : new Float32Array(16000 * 4);
                  let random = 123456789;
                  for (let i = 0; !pcmBase64 && i < pcm.length; i++) {
                    random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
                    const envelope = .1 + .15 * Math.sin(i / 16000 * Math.PI * 7) ** 2;
                    pcm[i] = envelope * (Math.sin(i * .08) + .2 * (random / 4294967296 - .5));
                  }
                  detector.beginProbe(400, 400 + pcm.length / 16000);
                  detector.push(pcm, 400);
                  const signal = await detector.drain(400, 400 + pcm.length / 16000);
                  detector.delete();
                  postMessage({first, second, bounded, signal, retainedSamples, overflowWindows,
                    initialization: detector.initialization, allocations,
                    threads: self.ort.env.wasm.numThreads});
                } catch (error) {
                  if (detector) detector.delete();
                  postMessage({error: String(error), stage: error.voiceStage, allocations});
                }
              };`;
              const url = URL.createObjectURL(new Blob([code], {type: 'text/javascript'}));
              const worker = new Worker(url);
              try {
                return await new Promise((resolve, reject) => {
                  const timer = setTimeout(() => reject(new Error('Voice worker timeout')), 120000);
                  worker.onmessage = event => { clearTimeout(timer); resolve(event.data); };
                  worker.onerror = error => { clearTimeout(timer); reject(new Error(error.message)); };
                  worker.postMessage({base, fallbackBase, fault, pcmBase64});
                });
              } finally { worker.terminate(); URL.revokeObjectURL(url); }
            }""", {"source": source, "base": origin + "/scripts/vad/" + config["directory"] + "/",
                     "fallbackBase": origin + "/scripts/vad/" + config["fallbackRuntime"]["directory"] + "/",
                     "fault": fault, "pcmBase64": pcm_base64})
                assert "error" not in result, {"fault": fault, "result": result}
                assert result["threads"] == 1, result
                assert len(result["first"]) == len(result["second"]) == len(result["bounded"]) == 4, result
                assert len(result["signal"]) == signal_bins, result
                assert result["retainedSamples"] == 16000, result
                assert result["overflowWindows"] == 0, result
                init = result["initialization"]
                assert init["fallbackSucceeded"] == init["fallbackAttempted"] == bool(fault), result
                assert init["runtimeCode"] == (2 if fault else 1), result
                assert init["primaryFailureCode"] == (1 if fault == "module" else 3 if fault else 0), result
                if fault == "module":
                    assert not result["allocations"], 'classic unshared loader must not allocate JS shared memory'
                if fault == "shared-memory":
                    assert len(result["allocations"]) == 1, 'only the rejected primary shared-memory attempt is allowed'
                for index, (first, second) in enumerate(zip(result["first"], result["second"])):
                    assert first["time"] == 100 + (index + .5) * .25
                    assert second["time"] == first["time"] + 100
                    assert 0 <= first["energy"] < .1, result
                    assert abs(first["energy"] - second["energy"]) < 1e-6, result
                    bounded = result["bounded"][index]
                    assert bounded["time"] == first["time"] + 200, result
                    assert abs(bounded["energy"] - first["energy"]) < 1e-6, result
                results.append({"fault": fault, "result": result})
            # Runtime compatibility must not change the detector signal.
            max_delta = max(abs(a["energy"] - b["energy"])
                            for case in results[1:]
                            for a, b in zip(results[0]["result"]["signal"], case["result"]["signal"]))
            assert max_delta < 1e-5, max_delta
            print(json.dumps({"browser": args.browser, "version": browser.version,
                              "modelSha256": config["files"][0]["sha256"],
                              "maxRuntimeProbabilityDelta": max_delta, "cases": results}))
        finally:
            browser.close()
finally:
    server.shutdown()
    server.server_close()
