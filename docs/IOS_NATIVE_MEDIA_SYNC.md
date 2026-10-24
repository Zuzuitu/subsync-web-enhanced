# Native iOS EN→RO synchronization — experimental 0.2.0

This client is separate from the production PWA. It processes the selected movie
and Romanian SRT locally. No media server, upload, paid API, Rock64 relay or web
engine change is introduced. Signed physical-iPhone acceptance is still required.
Exact PR/commit/CI status belongs to the top of PROJECT_STATE.md.

## Implemented flow

1. Select movie/audio and UTF-8 Romanian SRT through Files (unrestricted item
   picker, not an extension/MIME filter). Security-scoped/coordinated access is
   held during a bounded copy. One MiB chunks, SHA-256 identity, source size/mtime,
   a 64 MiB free-space reserve, cancellation and atomic staging protect inputs.
   The source is never modified. Imports/probing must finish in foreground.
2. Read actual audio tracks. Automatically use the unique English track or the
   only audio track; ambiguous files require explicit selection. Persist the
   chosen track with the job so retry cannot use another file's current selection.
3. A foreground tap submits a separate `BGContinuedProcessingTask` request.
   Native code verifies staged-file identities and every bundled asset, then uses
   the original FFmpeg decoder/resampler, PocketSphinx model/thresholds, Romanian
   dictionary translation and canonical C++ fit. The WebAssembly one-channel
   resampler layout value is preserved exactly. Recognition runs one worker.
4. Native packet stepping, real media position and reference-word counters drive
   progress. There is no timer-based pseudo-synchronization. Cancellation and
   expiration set a thread-safe native interrupt plus the completion guard.
5. A canonically accepted, finished result must pass finite-value, independent-cue
   count and SRT structure checks. Only timestamp ranges are changed. Original
   text, labels, BOM, line endings, markup and Romanian characters remain intact.
   All output/record writes are atomic and output is read back and hashed before
   success. A malformed/collapsed cue is refused rather than silently deleted.
6. Share/save the verified SRT through the system share sheet. Interrupted jobs
   retain local input identities and restart explicitly from zero. There is no
   claim of decoder/ASR-state checkpoint resumption. A missing/corrupt final SRT
   is rejected on export and app relaunch. Local copies remain in app storage.

`ios/Native/SubSyncMedia.cpp` is an orchestration adapter, not another estimator.
Original `gizmo/` files are compiled unchanged. Canonical defaults remain 1800 s,
0.9999, 2 s, 20 independent cues, word similarity 0.6, word probability 0.3,
minimum word length 5, same original English model and signed/pinned EN/RO data.
The last-valid-status rule mirrors `web/src/correlation-status.js`. No weaker
inconclusive-save path is introduced. Romanian-audio Whisper/VAD and other web
languages stay in the PWA; native universal-language support is not claimed.

## Verification and its limits

- Static FFmpeg n4.2, SphinxBase and PocketSphinx use exact repository pins.
  The build records resolved source SHAs, SDK, architecture and fingerprint;
  libraries are checked with `lipo`. FFmpeg protocols are file-only with network
  disabled. Codec availability is a compiled set, not proof that every real MKV
  works. AAC/AC3/EAC3/DTS/FLAC/MP3/Opus/Vorbis/PCM/SRT-related components are built.
- One Piper synthetic English MKV and offset Romanian SRT are generated once
  in CI, then the EXACT bytes are passed to browser WASM and native macOS. The
  reference WASM artifact is checked against its pinned source and hashes.
- The engine accepts no ground-truth offset, formula or expected times. The
  evaluator independently measures all cue boundaries, quality against known
  truth and maximum native/browser fit delta (100 ms ceiling). Silent input and
  cancellation must refuse success. The actual Swift SRT exporter runs too.
- A separate complete-dictionary comparison executes the actual production
  `Assets.loadDictionary('rum','eng',5)` JS and the actual native parsing code:
  **42,843 pairs match exactly**, with mapping SHA-256
  `0917d93c7aa23c66ea3c74f6c66d14e2fc1c014a8da5a3d4d2198fbe296085d6`.
  The low-level WASM fixture helper uses different trim/case normalization;
  translated-word counters can differ from that helper even when its accepted
  formula agrees. Production-loader equivalence is checked independently.
- First completed parity run on implementation `119b807ddd99a437270785e659e29fd0d894e770`
  (iOS workflow `40082482157`, native-build job `120838991993`): 79 reference words,
  281 translated subtitle words, 33 cues, 26 points; native/browser formula delta
  **0 seconds** across every cue. Formula `a=1.0019361972808838`,
  `b=-7.6191887855529785`, factor `0.999902499468495`, max distance `0.3390043676`.
- This is port fidelity, not zero ground-truth error: that same fixture's start
  MAE was **0.470909 s**, P95 **0.533 s**, max **0.541 s**, drift **0.142524 s**.
  SRT SHA-256 `260705b278cf9716b55de8f54168841c405e7679b3aa3294f4efcb652487d0b3`;
  MKV SHA-256 `97eab704024a844c5bc12fa72bd2e109589a3b553335213073fe8331609cfbb9`.
  Piper-generated inputs may differ between runs; never compare them as if
  identical. PR #94 and the precision roadmap remain necessary.
- Implementation `b9821c4137dae01530c2b0db88e1eb371471f774` passed the complete
  iOS workflow `40082922225`: all four Apple dependency targets, 22 Swift tests,
  full native/browser/SRT parity, both simulator architectures, arm64 iPhone
  build, actual iPhone 17 Pro / iOS 26.0 simulator launch/render, negative
  controls, evaluator checks and unsigned IPA packaging. Its second shared
  fixture again had zero native/browser fit delta; ground-truth start MAE
  0.463242 s, P95 0.583600 s, max 0.598000 s. This is NOT physical phone evidence.
- Single-worker synthetic macOS/WASM parity does not establish full PWA parallel
  scheduling parity, real-film edition/cut handling, codec universality, physical
  iPhone timing, battery/memory behavior or continued runtime while locked.

## Build and authorized installation

CI creates an unsigned arm64 app and an explicitly **UNSIGNED IPA**. These are
not directly installable on iPhone. No Apple signing identity/profile or paid
account is created by this work; no TestFlight publication occurs.

On a Mac with Xcode 26.3 and the Homebrew build tools:

```sh
brew install autoconf automake libtool pkg-config
python3 ios/tools/build-dependencies.py --platform iphoneos --arch arm64
python3 tests/fixtures/prepare-en-ro-assets.py
python3 ios/tools/stage-language-assets.py
python3 ios/tools/generate-project.py
```

Open `ios/SubSync2Background.xcodeproj`, select your authorized development team
and paired physical iPhone, enable Developer Mode if Xcode asks, and build.
Alternatively, with that account/device already configured locally:

```sh
python3 ios/tools/install-on-device.py --team YOURTEAMID --device YOUR_DEVICE_ID --prepare
```

Replace both placeholders with your own authorized IDs. Signing stays with Xcode
and the local Keychain. The helper verifies signing/provisioning before invoking
Apple's device-install tool. It is not run by CI and cannot invent credentials.
For simulator builds also build dependencies with `--platform iphonesimulator`
and `--arch arm64`, plus `--arch x86_64` for the universal simulator configuration.

## Remaining physical gate

Install with authorized signing; launch from the icon without the debugger.
Run the retained CPU test for 5–15 minutes across another app and screen locking;
export its evidence and use the evaluator/protocol in IOS_NATIVE_BACKGROUND_POC.md.
Then run actual native EN-audio/RO-SRT synchronization in foreground and background
on the SAME physical input, compare output timing/text, and test cancellation,
expiration, force quit/reopen/retry, low power, calls, space exhaustion and large
MKV/multiple-track/codecs. Do not mark this complete based on compilation,
simulator launch, host recognition or an unsigned IPA.

The CI reference WASM is bootstrapped from verified source at run `40058134891`
(PR #94 head `dc7a0be650854fa3b01256850c595a5abc8d8ae2`). GitHub artifacts have
retention limits. If that reference expires, rebuild the same audited source and
pin its replacement run; do not silently use an unrelated newer engine.

After background acceptance, resume PR #94, read-only evidence coverage, edition
diagnostics, preview, validated segment correction, performance and memory work.
