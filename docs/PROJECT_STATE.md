# SubSync2 — Project State

LAST_UPDATED: 2026-09-12 23:10 Europe/Rome

## Canonical status

This file is the human-readable technical checkpoint for SubSync2.
Repository truth overrides chat memory. Before material changes, read in this order:
1. `docs/PROJECT_STATE.md`
2. `config/project-invariants.json`
3. `AGENTS.md`
4. relevant current implementation

Do not rely on a checkpoint-pinned `main` SHA without reading the repository at session start.

## Current status

Repository: `Zuzuitu/subsync-web-enhanced`

Upstream: `sc0ty/subsync`

Pinned upstream baseline: `c888da7257d57bf039523c9f7015feacb4b95dc3`

Public preview: `https://zuzuitu.github.io/subsync-web-enhanced/`

Latest deliberate product preview deployment:
- Deploy PWA Preview run `34716967459`: **PASS**;
- deployed product commit: `f7296ad6ecbd5f0d56772fd845b4d14f925180ab`;
- GitHub Pages artifact/deployment: **PASS**;
- complete pinned original sc0ty catalog mirrored and signature-verified: **226 packages** = 9 speech models + 217 dictionaries;
- mirrored payload: **528,928,835 bytes**.

Current `main` after merging the persistent live-Pages regression is
`3057324ce541767d25074f32467f03b459c417ae` (PR #25). PR #25 changes only
test/workflow tooling; it does not change the shipped PWA runtime or product
assets, so a second product redeploy is not required for that merge. Main-push
CI run `34718933042`: **PASS**.

The public preview is **not** the older pre-Romanian build anymore. It now
contains the language-download/cache UX, stage-specific diagnostics and the
genuine Romanian-audio Whisper path from PR #22.

## Immediate milestone

All automated release-candidate, deployment and live-public-site validation is
green. The only remaining validation required for the Romanian-audio milestone
is a **physical iPhone/Safari Romanian-audio test** against the public preview.

Do not claim physical-iPhone Romanian-audio support is confirmed until the user
actually runs this test and reports the result.

Batch/multi-upload remains deferred until the single-file path is stable on the
physical device.

## Product goal

Revive and modernize sc0ty/SubSync as a browser-first installable PWA while
preserving the original synchronization algorithm and original language catalog
where technically sound.

Primary workflows:
- English reference audio + Romanian subtitles using the original sc0ty
  PocketSphinx/dictionary path;
- Romanian reference audio + Romanian subtitles using isolated local Whisper
  speech recognition and the original SubSync correlation/timing logic.

Media remains browser-local. Do not introduce a backend media-upload workaround
or a paid API/service without explicit user approval.

## Governance and invariants

- repository truth > chat memory;
- material changes: branch -> PR -> CI green -> merge;
- do not make material commits directly on `main`;
- production auto-deploy remains disabled;
- preview deployment is deliberate/manual when product changes require it;
- do not weaken invariants or synchronization thresholds to make CI green;
- reproduce -> isolate -> regression -> smallest justified fix -> CI -> checkpoint;
- do not invent test results or root causes;
- preserve GPLv3 and visible credit to Michał Szymaniak / sc0ty;
- preserve the original sc0ty language catalog;
- keep media processing browser-first/local;
- do not replace PocketSphinx globally with Whisper;
- do not migrate the whole legacy extractor to modern LLVM merely to optimize Romanian ASR;
- do not claim iPhone-like WebKit CI is equivalent to physical iPhone Safari.

Canonical synchronization thresholds remain unchanged:
- `minPointsNo = 20`
- `minCorrelation = 0.9999`
- `maxPointDist = 2`
- `minWordProb = 0.3`
- `minWordLen = 5`
- `minWordsSim = 0.6`

The Romanian regression deliberately uses 24 subtitle cues. The former 16-cue
fixture was mathematically incapable of satisfying `minPointsNo=20`; the
correct fix was increasing fixture evidence, not lowering the threshold. Tests
must reject Romanian fixtures with 20 or fewer cues for this regression.

## Original sc0ty language catalog

Original speech models preserved:
- `chi`
- `dut`
- `eng`
- `fre`
- `ger`
- `gre`
- `ita`
- `rus`
- `spa`

Total original catalog:
- **9 speech models**;
- **217 dictionary packages**.

Original asset publication remains pinned/signature-verified. The deliberate
Pages deploy mirrors the complete catalog under same-origin `assets/data/`,
while browser IDBFS stores packages actually downloaded by the user.

Live Public Pages representative-language validation after the Romanian release
candidate:
- run `34718016222`: **PASS**;
- mirror manifest: 226 packages / 528,928,835 bytes;
- Italian dictionary + speech: HTTP 200;
- French dictionary + speech: HTTP 200;
- Spanish dictionary + speech: HTTP 200;
- zero console/page errors.

The tiny representative fixtures intentionally lack enough evidence to
synchronize. Their purpose is live catalog/delivery/model-loading validation,
not per-language recognition accuracy.

## Architecture

### English reference audio + Romanian subtitles

`MKV ENG -> WORKERFS -> FFmpeg Demux -> AudioDec -> Resampler -> PocketSphinx ENG -> words`

`RO SRT -> SubtitleDec -> original sc0ty ENG<->RO dictionary -> comparison words`

`reference words + subtitle words -> original SubSync correlator -> timing formula -> corrected SRT`

This workflow is confirmed end to end and remains the original-sc0ty path.

### Romanian reference audio + Romanian subtitles

`MKV RON/RUM -> WORKERFS -> legacy FFmpeg Demux -> AudioDec -> Resampler -> PcmSink -> isolated whisper.cpp WASM SIMD -> Romanian words`

`RO SRT -> SubtitleDec -> Romanian subtitle words`

`reference words + subtitle words -> original SubSync correlator -> timing formula -> corrected SRT`

Romanian aliases `ro`, `rum`, `ron` canonicalize to internal `rum`; Whisper
language is `ro`.

## Romanian ASR implementation

PR #22 `Add genuine local Romanian audio recognition` merged to `main` at
`146aaaf9ec7f45d46e625644be30f4aa12108b0d`.

Pinned engine:
- `ggml-org/whisper.cpp`
- tag `v1.5.4`
- commit `0b9af32a8b3fa7e2ae5f15a9a08f5b10394993f5`

Pinned model:
- `ggml-tiny-q5_1.bin`
- revision `5359861c739e955e79d9a303bcbc70fb988958b1`
- SHA-256 `818710568da3ca15689e31a743197b520007872ff9576237bda97bd1b469c3d7`
- size `32,152,673` bytes (~30.7 MiB)
- browser asset `asr/rum`

Toolchains:
- legacy extractor: Emscripten `1.39.11-fastcomp`, preserving FFmpeg n4.2,
  SphinxBase and PocketSphinx compatibility;
- isolated Romanian Whisper module: pinned `emscripten/emsdk:3.1.50` image from
  `config/romanian-asr.json`;
- single-threaded WASM SIMD;
- no pthreads;
- no SharedArrayBuffer requirement;
- no shared WebAssembly memory.

Do not restart the rejected whole-extractor LLVM migration without new evidence.
Previous reproduction showed incompatibilities in SphinxBase, FFmpeg 4.2 and
old/new Emscripten/Whisper SIMD combinations.

Romanian model lifecycle:
`download -> SHA-256 verify -> store in IDBFS -> ready -> reuse locally`

The service worker intentionally avoids duplicating large `assets/data/`
packages in Cache Storage; language/model persistence is handled by application
IDBFS.

Third-party notices are recorded in `THIRD_PARTY_NOTICES.md` for whisper.cpp
and the Whisper model. Piper voices remain CI-only fixtures, not production
runtime dependencies.

## Merged-main release-candidate validation

Release-candidate regression was run from exact merged-main commit
`46372bb9e4f3ae4cf6d12a8b640aed33d5ade172`.

All required gates passed:
- CI `34715999591`: **PASS**;
- Legacy WebAssembly Build `34716200123`: **PASS**;
- MKV WASM Fast Diagnostic `34716202061`: **PASS**;
- Mobile WebKit Compatibility `34716200576`: **PASS**;
- Large-file Browser Stress `34716202978`: **PASS**.

Fresh Legacy validation re-confirmed:
- legacy extractor/correlator build;
- isolated Whisper SIMD build;
- no-shared-memory assertions;
- runtime `WASM_SIMD = 1`;
- canonical MKV matrix and split-window seek regression;
- ENG-audio + RO-subtitle E2E;
- PWA shell;
- language download/cache UX;
- pinned upstream language loading;
- primary real-PWA flow;
- Romanian-audio Chromium E2E;
- Romanian-audio iPhone-like WebKit E2E.

Merged-main Romanian E2E in both Chromium and WebKit:
- 140 usable Romanian reference words;
- 23 synchronization points;
- displayed correlation 99.99%;
- formula `0.9990x-8.234`;
- saved timing correction `-8.243 s` for the known +8.0 s fixture;
- model lifecycle download -> verify -> store -> ready;
- Romanian diacritics preserved;
- zero console errors, page errors and HTTP failures.

## Deliberate preview deployment and live public verification

The validated release candidate was deliberately deployed through
`deploy/pages-preview` after all merged-main gates were green.

Deploy run `34716967459`: **PASS**.

Deployed product commit:
`f7296ad6ecbd5f0d56772fd845b4d14f925180ab`.

The deploy rebuilt the authoritative browser engines and PWA, then mirrored the
complete signature-verified original sc0ty catalog before GitHub Pages upload.
Production auto-deploy was not enabled.

### Live public Romanian-audio E2E

A dedicated regression now exercises genuine Romanian audio end to end against
the **actual public GitHub Pages URL**, rather than only local staging.

Initial live run `34718135955`: **PASS**.

Measured public-site result:
- browser: Chromium;
- reference language detected/canonicalized to `rum`;
- **135** usable Romanian reference words;
- **21** synchronization points;
- displayed correlation **99.99%**;
- formula `1.0022x-8.410`;
- saved timing correction **-8.391 s** for the +8.0 s fixture;
- `whisper.js`: HTTP 200;
- `whisper.wasm`: HTTP 200;
- pinned `ggml-tiny-q5_1.bin`: HTTP 200;
- model lifecycle: downloading -> verifying SHA-256 -> storing locally -> ready;
- Romanian diacritics preserved in the saved SRT;
- zero console errors;
- zero page errors;
- zero HTTP failures.

PR #25 made this live-Pages Romanian regression permanent. Its validation was
full green before merge:
- Public Pages Language Smoke `34718281001`: **PASS**;
- Legacy WebAssembly Build `34718281098`: **PASS**;
- governance CI: **PASS**.

PR #25 merged at
`3057324ce541767d25074f32467f03b459c417ae`; main-push CI `34718933042` is
**PASS**. Because PR #25 contains test/workflow tooling only, no additional PWA
redeploy is necessary after that merge.

## MKV reliability status

Historical observation: some real direct MKV + SRT files failed while extracted
audio + the same SRT worked. The exact historical root cause remains unconfirmed
without a representative original failing file.

Confirmed deterministic reliability fix:
- split-window seek could jump forward to a later keyframe and leave a gap;
- `Demux::seek()` now uses `AVSEEK_FLAG_BACKWARD`;
- requested 62.5 s seek previously observed first packet at 70.0 s;
- fixed fresh-WASM regression observed packet coverage from 60.0 s around the
  requested start;
- do not present this as the universal root cause of every historical MKV.

Current matrix includes successful deterministic coverage for:
- AAC;
- AC3;
- E-AC3;
- H.264 + stereo AAC;
- HEVC/H.265 + E-AC3 5.1;
- multiple/reversed audio tracks;
- embedded subtitles;
- Romanian subtitles;
- split-window seeking.

## Large-file browser stress

Canonical generated direct-MKV fixture:
- H.264 1280x720;
- English AAC reference audio;
- duration 90.064 s;
- 143,952,449 bytes = 137.28 MiB.

Merged-main stress run `34716202978`: **PASS** in Chromium and iPhone-like
WebKit.

Observed process-tree RSS on Linux CI for that RC:
- Chromium peak: 1071.08 MiB;
- WebKit peak: 1779.86 MiB.

These values are regression baselines only. They are not exact browser-tab
memory and are not physical-iPhone memory measurements. The synthetic stress
audio intentionally produces no useful speech words; the test measures direct
MKV/WORKERFS/browser survival rather than speech accuracy.

## PWA / cache / diagnostics status

Implemented and regression-tested:
- installable PWA shell;
- subpath-safe GitHub Pages hosting;
- service worker with SubSync2-scoped cache cleanup;
- language/model download progress;
- IDBFS reuse across runs;
- deliberate language-data cache cleanup;
- same-origin original-language asset delivery;
- stage-specific diagnostics for initialization, language assets, pipeline,
  demux, decode, resample, speech recognition, subtitles, dictionary,
  processing and correlation;
- evidence counts for decoded subtitles, subtitle words, reference words and
  synchronization points;
- corrected SRT download.

Failure diagnostics must distinguish observed evidence from an unproven root
cause. Native exception module/stage information is authoritative when present.

## Physical iPhone status

The earlier primary ENG-audio + RO-subtitle workflow was successfully tested by
the user on a physical iPhone/Safari device.

The new genuine **Romanian-audio** path has strong iPhone-like WebKit CI evidence
and live GitHub Pages Chromium evidence, but it has **not yet been validated on
a physical iPhone/Safari device**.

Required physical test on the current public preview:
1. open the public preview in real iPhone Safari;
2. select a Romanian SRT and a matching MKV with Romanian audio;
3. run synchronization;
4. on first use observe Romanian Whisper model download/verify/store/ready;
5. save the corrected SRT and verify practical alignment;
6. repeat the same workflow once to confirm model reuse from local cache;
7. report PASS/FAIL and, on failure, provide the visible stage/diagnostic text.

Do not mark this milestone complete until that real-device result is reported.

## Next sequence

1. Perform the physical iPhone/Safari Romanian-audio test against the deployed preview.
2. If it passes, record the physical-device result in this checkpoint and treat the current single-file Romanian path as release-stable at this milestone.
3. If it fails, use the existing stage diagnostics and live-site evidence to reproduce and apply the smallest justified fix.
4. Only after single-file reliability is solid, consider batch/multi-upload and further product modernization.

## Open blockers

- physical-iPhone/Safari validation of genuine Romanian audio is pending on the already-deployed release candidate;
- the historical real-world MKV failure class remains reproduction-dependent on a representative failing file;
- not every original sc0ty language/model pair has a dedicated full recognition/correlation E2E, although the complete signed catalog is deployed and representative live loading is validated;
- batch/multi-upload remains deliberately deferred.
