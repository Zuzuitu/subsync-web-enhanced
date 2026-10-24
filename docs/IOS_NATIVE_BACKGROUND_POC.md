# iOS 26 native background milestone — 2026-10-24

Status: native CPU PoC implemented; NOT a released movie synchronizer. See the
latest top entry in PROJECT_STATE.md for exact PR/commit/build results. The
production PWA at https://sync.alexlab.media/ is independent of this project.

## Source audit and reuse boundary

| Stage | Actual source | Native port assessment |
|---|---|---|
| Orchestration | `web/src/synchro.js`, `web/src/extractor/worker.js` | JS manages worker lifecycle/windows, asset staging, status selection and output eligibility. This is not the fitting algorithm. Native orchestration still needs the same sequencing/save gates. |
| Demux/decode/PCM | `gizmo/media/{demux,audiodec,resampler,subdec}.cpp`, `web/src/extractor/pipeline.js` | Reusable C++; requires FFmpeg n4.2 static libraries, arm64/simulator cross-build, bounded reads, codec/seek tests and explicit network-protocol exclusion. No iOS FFmpeg binary is shipped yet. |
| English recognition | `gizmo/media/speechrec.cpp`, `config/legacy-build-pins.json` | PocketSphinx `ab6d6471800966990e12fdb6ed27ae36323cf2c4`, SphinxBase `4ffc4b79515fd18f7adfbf80c20f3c0ecb9edccd`. Preserve model descriptor, `-mmap 0`, word probability 0.3, minimum length 5, sample format/rate and utterance timestamps. A modern recognizer is not a parity substitute. |
| EN→RO lexical matching | `web/src/extractor/assets.js`, `gizmo/text/{dictionary,translator,utf8}.cpp` | Translate Romanian subtitle words to English through the SAME signed/pinned sc0ty eng-rum data. Preserve filtering/direction/lowercase/fuzzy matching. Asset catalog remains intact. |
| Canonical fit | `web/src/correlator/worker.js`, `gizmo/wasm/correlator.cpp`, `gizmo/synchro/synchronizer.cpp`, `gizmo/math/*` | Already C++, not a JS rewrite. This milestone compiles original files through a small C ABI adapter. Preserve 1800 s search, 0.9999 correlation, 2 s distance, 20 independent cues, 0.6 word similarity. |
| SRT output | `web/src/subtitle.js`, `web/src/save-policy.js`, `web/src/correlation-status.js` | Native export not yet implemented. It must retain cue order/text/diacritics and exact affine/clamping/millisecond semantics and fail closed until canonical eligibility. |
| Romanian audio | `web/src/extractor/romanian-whisper.js` and Romanian window/precision/VAD helpers | Separate from the primary English-audio workflow. Not silently ported/replaced or claimed compatible. Remains in the PWA. |

`ios/native-sources.json` names original sources compiled into the app; no forked
algorithm copy. The C ABI/direct-core tests prove adapter agreement and canonical
cue thresholds, **not** end-to-end EN→RO or WASM/native recognition parity.
Existing `gizmo/test` tests remain authoritative for the fit. Full parity must
reuse `tests/fixtures/generate-en-ro-e2e.py`, pinned assets in
`config/english-romanian-assets.json`, and `tests/web/run-primary-workflow.py` /
`tests/web/srt_timing.py`. Ground truth stays evaluator-only. PR #94 metrics and
all subsequent precision tasks remain pending, not discarded.

## What this milestone implements

- SwiftUI iOS 26 app, separate bundle ID `media.alexlab.subsync2.backgroundlab`.
  The interface explicitly says it does not synchronize movies yet.
- Static bundle-prefixed permitted identifier, early registration, explicit
  foreground tap, immediate-admission request (`strategy = .fail`) and native
  utility-priority work. No WKWebView, timer progress, silent audio or server.
- Fixed SHA-256 work calibrated for approximately 5/10/15 minutes. One unit is
  16 dependent hashes of 256 KiB. Progress is completed units, never wall time.
  Calibration is only 0.3 s and cancels on leaving foreground; estimated duration
  is not a guarantee. Steady-state workload memory is bounded.
- OS Progress reporting, synchronous lock-protected cancellation/expiration,
  finalization exactly once and cancellation checked between 256 KiB chunks.
  The system's own continued-task progress UI is used; no custom ActivityKit
  extension or fictional Live Activity implementation.
- Durable local records and atomic result/record writes, protection until first
  user authentication, excluded from device backup, schema/workload versioning,
  bounded event history, final-result readback. Corrupt records are preserved
  and block reuse. Failure to persist never becomes success.
- Queued/running records become interrupted on relaunch. Restart is explicit,
  uses a new job ID and begins at zero. **No exact decoder/ASR checkpoint resume
  is claimed.** All prior evidence remains available.
- Exportable local JSON with completed work, scene transitions, monotonic time,
  process CPU time, peak RSS (Darwin bytes), battery/thermal/low-power values.
  It contains no movie paths, audio, SRT text or user identifiers.
- A read-only evaluator refuses simulator/foreground/stalled/gapped evidence
  and needs tester confirmation of physical hardware, detached debugger and
  screen locking. Lock/protected-data notification is only an observed signal;
  it does not itself prove a lock/unlock test.

The job store is PoC infrastructure. Files picker/security-scoped input staging,
media identity/quota/stream copy and atomic SRT export remain phase 2/3 work.
No unimplemented media controls or fake sync button are exposed.

## Build and test

No prior iOS project, signing workflow or macOS job existed at baseline
`745c6db096c9f9e47c4bcf8471b44e1478aa5763`. This adds a macos-15 GitHub job
with explicit `/Applications/Xcode_26.3.app`, Swift 6 tests, simulator compile
and unsigned arm64 device compile. Those builds do not need Apple credentials.
No authorized Apple signing identity/provisioning profile has been established
in this session. No TestFlight upload, paid account setup or signed IPA is made.

On a Mac with Xcode 26.3:

```sh
python3 ios/tools/generate-project.py
python3 tests/ios/run-native-tests.py
swift test --package-path ios/BackgroundCore
xcodebuild -project ios/SubSync2Background.xcodeproj -scheme SubSync2Background \
  -configuration Release -destination 'generic/platform=iOS' \
  -derivedDataPath ios/build/device CODE_SIGNING_ALLOWED=NO build
```

The committed Xcode project is deterministic and requires no XcodeGen/CocoaPods.
To install on your own iPhone, open the project in Xcode, choose an authorized
personal/development team and the actual device, and sign with that team. Use
the system-granted development provisioning; do not claim an unsigned CI .app
can be installed. TestFlight needs separately authorized distribution signing.

## Mandatory physical acceptance, still pending

1. Build/install on physical iOS 26+ with signing; record device/iOS/source SHA.
   Disconnect Xcode/debugger and launch the installed app from its icon.
2. Start 10 or 15 estimated minutes explicitly. Verify progress in foreground;
   switch to WhatsApp/Safari for at least 5 minutes, then lock/unlock for several
   minutes while measurable CPU work remains. Do not count time after completion.
3. Return, export JSON, and inspect real counters/CPU/phase intervals. Run:

   ```sh
   python3 ios/tools/evaluate-background-evidence.py evidence.json \
     --confirm-physical-device --confirm-debugger-detached --confirm-screen-lock
   ```

   Supply confirmations only for actions actually performed. The evaluator
   reports observed intervals and CPU; it never proves continuous/unlimited
   runtime or subtitle accuracy. Exit 2 means physical acceptance is incomplete.
4. Separately test native cancel, system UI cancel/expiration, force quit and
   reopen, low power, call interruptions and storage exhaustion. An interrupted
   job must not be completed or automatically resubmitted. Retry begins at zero.
5. Only then integrate bounded, security-scoped Files import, pinned native
   FFmpeg/PocketSphinx/assets and actual EN→RO synchronization. Compare the same
   independent fixture against browser output: cue count, MAE/median/P95/max,
   thirds/drift, text and diacritics. Include silent/no-match/cut negative cases.
   Keep all canonical gates. Large MKV/codec/memory/battery tests follow.

## Platform references

- Apple: https://developer.apple.com/documentation/backgroundtasks/performing-long-running-tasks-on-ios-and-ipados
- Apple: https://developer.apple.com/documentation/backgroundtasks/bgcontinuedprocessingtask
- Apple WWDC25 API registration/progress/expiration/submission examples:
  https://developer.apple.com/videos/play/wwdc2025/227/
- Official runner image toolchain inventory:
  https://github.com/actions/runner-images/blob/main/images/macos/macos-15-Readme.md

GPLv3/sc0ty attribution is preserved in the app and bundled source notices.
Nothing changes the production web origin or existing language data.
