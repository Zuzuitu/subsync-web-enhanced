# SubSync2 — Project State

LAST_UPDATED: 2026-09-13 11:35 Europe/Rome

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

Current `main`:
- PR #29 `Verify Romanian ASR adaptively before early completion`: **MERGED**;
- merge commit: `9768cd3daf4d0368993ab6e4b1ae3b9cd84affe7`;
- main-push CI `34747473269`: **PASS**.

Latest deliberate product preview deployment:
- Deploy PWA Preview run `34747503470`: **PASS**;
- deployed product commit: `9768cd3daf4d0368993ab6e4b1ae3b9cd84affe7`;
- fresh legacy extractor/correlator build: **PASS**;
- isolated Romanian Whisper SIMD build/runtime: **PASS**;
- Romanian Chromium and iPhone-like WebKit E2E inside the deploy build: **PASS**;
- GitHub Pages artifact/deployment: **PASS**;
- complete pinned original sc0ty catalog mirrored and signature-verified: **226 packages** = 9 speech models + 217 dictionaries.

Post-deploy public Pages validation:
- first trigger `34749523692`: GitHub Actions **startup_failure** before any
  job started; this was infrastructure-only and produced no product verdict;
- retry `34749671716`: **PASS**;
- representative Italian/French/Spanish live assets: **PASS**;
- public manifest: 226 packages / 528,928,835 bytes, signatures verified;
- live Romanian audio E2E: **PASS** against the deployed `9768cd3d...` build.

## Immediate milestone

The browser implementation now has a verified adaptive Romanian long-title path
instead of blindly transcribing the whole movie or always consuming the maximum
sparse-window budget.

Automated release gates are green on the merged PR #29 implementation:
- canonical thresholds remain unchanged;
- Chromium Romanian E2E: **PASS**;
- iPhone-like WebKit Romanian E2E: **PASS**;
- both engines converged after **11/16** probes instead of exhausting all 16;
- both produced 182 usable reference words, 25 synchronization points,
  displayed 100.00% correlation, formula `1.0001x-8.843`, and saved timing
  shift `-8.842 s` for the known +8 s fixture;
- no console errors, page errors or HTTP failures.

Physical-device status is deliberately separate. A real iPhone/Safari test was
performed before the adaptive optimization and proved that the >2 GB direct-MKV
Romanian path could open the file, select Romanian audio, download the model,
produce correlation evidence and save an SRT, but the user saved an early
intermediate result after about five minutes and it still had roughly 4–5 s
residual error. The full old job was not allowed to finish because its projected
runtime was much longer.

Therefore the next physical milestone is a **retest of the current adaptive
build on the real iPhone**, letting the adaptive lock finish before saving.
Do not claim that the new optimization is physically validated until that test
is reported.

Batch/multi-upload remains deferred until the optimized single-file path is
confirmed on the physical device.

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

The Romanian long-title regression now uses **80** subtitle cues over a 481 s
distributed fixture, with at least 64 cues and at least 8 cues/min required by
the sparse-regression checks. The former 16-cue fixture was mathematically
incapable of satisfying `minPointsNo=20`; the correct fix remains increasing
realistic evidence, never lowering the canonical threshold.

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

## Romanian long-title performance and adaptive convergence

### Physical performance problem that triggered the work

The user tested a real >2 GB dual-audio MKV on physical iPhone Safari with a
Romanian SRT deliberately shifted by more than 10 s and Romanian audio selected.

Observed on the pre-optimization build:
- direct >2 GB MKV opened successfully;
- Romanian track selection worked;
- Romanian Whisper model download worked;
- synchronization produced enough evidence to enable saving after roughly five minutes;
- the user saved that intermediate SRT rather than waiting for the projected long completion;
- the intermediate subtitle was improved but remained approximately 4–5 s out of sync.

This was treated as a partial real-device pass and a performance/convergence
problem, not as evidence that the container or Romanian ASR path was broken.

### PR #27 — first sparse-window optimization

PR #27 `Speed up Romanian ASR with distributed sparse windows` merged at
`4e7c75b6c6f7fb86f78e85d4c8cf7ab776e136f5`.

It changed long Romanian-audio titles from whole-title transcription to
distributed sparse probing while keeping one Whisper context for memory safety.
The first version used 16 × 30 s windows. It preserved the original sc0ty
correlator and all thresholds.

The first optimized preview deploy exposed an important limitation: the
authoritative Romanian fixture could still run out of workflow time before all
fixed windows completed. Do not interpret that as a synchronization-algorithm
failure.

### PR #28 — rejected fixed-budget reduction

PR #28 `Bound Romanian sparse ASR to four minutes` attempted a fixed
20 × 12 s / 240 s maximum scan.

It was **not merged**. Its authoritative fresh-WASM Romanian E2E reached useful
recognition evidence but hit the timeout before completion. The lesson is
explicit: do not keep shrinking fixed windows arbitrarily and do not weaken
canonical synchronization thresholds to manufacture a pass.

### PR #29 — current adaptive design

PR #29 `Verify Romanian ASR adaptively before early completion` merged at
`9768cd3daf4d0368993ab6e4b1ae3b9cd84affe7`.

Current planner for titles longer than 240 s:
- 16 candidate windows;
- 15 s per window;
- one Whisper context / one Romanian reference worker;
- farthest-first temporal order: beginning/end coverage first, then repeatedly
  fill the largest timeline gaps;
- maximum fixed budget remains 240 s of candidate audio, but the job can stop
  earlier once convergence is independently verified;
- titles at or below 240 s keep full-scan behavior.

Adaptive early completion requires all of the following:
- normal sc0ty correlation must already be canonical; no threshold is relaxed;
- at least 4 usable words in a confirming probe;
- at least 1 new canonical synchronization point for each added confirmation;
- at least 3 stable correlated confirmations;
- actual used correlation evidence must span at least 75% of title duration;
- formula movement may be at most 0.75 s when evaluated across the title;
- an inconclusive/silent probe is neutral;
- a materially different canonical formula resets the stability sequence.

The correlator now exposes a fresh raw snapshot at Romanian probe boundaries,
including the reference-time span of points actually used by correlation. The
persistent final status still uses canonical-status selection, so weaker
intermediate snapshots do not overwrite a stronger valid solution.

Authoritative fresh-WASM result on the final PR #29 head
`ea980e318a5809d15343a1d0e5e321cd0b3132a4`:
- Legacy WebAssembly Build `34746893076`: **PASS**;
- MKV WASM Fast Diagnostic `34746893040`: **PASS**;
- Mobile WebKit Compatibility `34746893081`: **PASS**;
- Large-file Browser Stress `34746893052`: **PASS**;
- governance CI `34746893077`: **PASS**;
- Chromium Romanian E2E: 11/16 probes, 182 reference words, 25 points,
  100.00%, formula `1.0001x-8.843`, saved shift `-8.842 s`;
- iPhone-like WebKit Romanian E2E: the same 11/16 probes, 182 words, 25 points,
  100.00%, the same formula and saved shift;
- zero console, page and HTTP errors in both.

The 11 completed 15 s probes correspond to 165 s of planned Romanian audio
windows in this automated fixture, versus consuming the full 240 s candidate
budget. This is an automated-browser result, not a promise of a specific
physical-iPhone wall-clock time.

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

The current adaptive release was deliberately deployed through
`deploy/pages-preview` only after PR #29 was merged.

Current deployment:
- Deploy PWA Preview `34747503470`: **PASS**;
- deployed commit: `9768cd3daf4d0368993ab6e4b1ae3b9cd84affe7`;
- fresh build reused no unverified product binary;
- canonical MKV matrix: **PASS**;
- ENG-audio + RO-subtitle E2E: **PASS**;
- Romanian Chromium E2E: **PASS**;
- Romanian iPhone-like WebKit E2E: **PASS**;
- complete 226-package signed sc0ty mirror: **PASS**;
- GitHub Pages deployment: **PASS**.

Production auto-deploy remains disabled. Moving `deploy/pages-preview` is a
deliberate release action.

A dedicated public-Pages workflow validates:
- representative Italian/French/Spanish asset delivery;
- complete signed 226-package manifest;
- live Romanian Whisper JS/WASM/model delivery;
- Romanian model lifecycle;
- real public-URL Romanian synchronization and corrected SRT download.

Historical live validation for the earlier Romanian release:
- representative-language run `34718016222`: **PASS**;
- first live Romanian audio run `34718135955`: **PASS**;
- public Romanian result at that time: 135 reference words, 21 points,
  99.99%, formula `1.0022x-8.410`, saved shift `-8.391 s`.

Post-adaptive deployment validation:
- initial trigger `34749523692`: GitHub Actions **startup_failure** before a
  runner/job started; no SubSync2 code executed;
- retry `34749671716`: **PASS**;
- public manifest: 226 packages / 528,928,835 bytes;
- representative Italian/French/Spanish dictionary/speech assets: HTTP 200;
- live Romanian reference words: **159**;
- synchronization points: **28**;
- displayed correlation: **100.00%**;
- formula: `0.9996x-8.762`;
- saved timing correction: **-8.770 s** for the +8 s fixture;
- `whisper.js`, `whisper.wasm` and the pinned Romanian model: HTTP 200;
- live JS/WASM URLs carried version hash
  `9768cd3daf4d0368993ab6e4b1ae3b9cd84affe7`;
- model lifecycle download -> verify -> store -> ready: **PASS**;
- Romanian diacritics preserved;
- zero console, page and HTTP errors.

The permanent live Romanian smoke is strengthened in the checkpoint PR to
require not only a valid saved SRT but also a verified adaptive lock that stops
before all candidate probes are consumed.

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

The primary ENG-audio + RO-subtitle workflow was previously confirmed on a real
iPhone/Safari device.

Romanian audio now has two distinct physical-device milestones:

1. **Pre-adaptive physical test — partial PASS**
   - real >2 GB dual-audio MKV;
   - Romanian audio selected;
   - Romanian SRT deliberately offset by more than 10 s;
   - model download succeeded;
   - direct media processing produced enough evidence to enable save;
   - user saved the early intermediate result after roughly five minutes;
   - that intermediate result remained roughly 4–5 s out of sync;
   - full completion was not observed because the old path appeared too slow.

2. **Current adaptive build — RETEST REQUIRED**
   - deployed commit: `9768cd3daf4d0368993ab6e4b1ae3b9cd84affe7`;
   - automated Chromium and iPhone-like WebKit evidence is green;
   - the optimized build has not yet been allowed to finish on the physical
     iPhone, so do not claim physical performance/accuracy confirmation yet.

Model bytes persist through the browser cache/IDBFS lifecycle, but active
synchronization-job persistence/resume across Safari suspension is not
implemented. Until explicitly tested otherwise, keep Safari foregrounded while
the Romanian job is running.

## Fork / modernization review

The September 2026 fork review produced a selective-harvest decision, not a
repository migration.

Reviewed directions included:
- `blaaaakuu/subsync`: GPU word-matching/build modernization ideas;
- `Sefzz15/subsync`: optional piecewise/nonlinear synchronization ideas;
- `neck0l/subsync`: multi-engine ASR architecture including Vosk/Whisper;
- `pedromsilvapt/subsync`: conservative browser/no-pthreads build lessons;
- `chid/subsync`: core robustness/thread-safety patterns;
- modernized derivatives such as `CoolFreeze23/subsync-ptbr`: useful bug
  patterns only.

Canonical decisions:
- do **not** replace SubSync2 wholesale with another fork;
- GPU word matching is not the current iPhone priority because Romanian runtime
  is dominated by local ASR, and CUDA/OpenCL is not a Safari solution;
- piecewise synchronization is interesting as a future optional advanced mode
  for cuts/edition differences, but must not mask incomplete ASR or replace the
  original sc0ty linear path by default;
- multi-ASR abstraction is strategically interesting, but Romanian Whisper
  remains the current engine until another Romanian model is independently
  vetted for quality, licensing and browser memory/runtime;
- do not lower `minPointsNo`, correlation or other canonical thresholds based
  on fork behavior;
- modernization should be imported as small reviewed ideas, with SubSync2 tests
  and invariants remaining authoritative.

## Next sequence

1. Merge the strengthened permanent public Romanian smoke only after its PR
   validation proves the deployed site reaches a verified adaptive lock before
   16/16 probes.
2. Retest the current public preview on the physical iPhone using the real >2 GB
   Romanian-audio file and deliberately shifted Romanian SRT. Let the adaptive
   job reach its terminal result before saving.
3. Record physical elapsed time, adaptive probe count shown in diagnostics and
   practical final residual sync error.
4. If the optimized single-file path passes physically, mark Romanian
   single-file support release-stable for this milestone.
5. Only then prioritize batch/multi-upload or larger modernization work such as
   optional piecewise sync / multi-ASR abstractions.

## Open blockers

- the adaptive Romanian build still needs a full physical-iPhone/Safari retest;
- browser job resume/persistence across Safari suspension/backgrounding is not
  implemented;
- the historical real-world direct-MKV failure class remains
  reproduction-dependent on a representative failing file;
- not every original sc0ty language/model pair has a dedicated full
  recognition/correlation E2E, although the complete signed catalog is deployed
  and representative live loading is validated;
- batch/multi-upload remains deliberately deferred until optimized single-file
  reliability is physically confirmed.
