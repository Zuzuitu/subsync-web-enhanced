# SubSync2 — Project State

LAST_UPDATED: 2026-09-14 22:55 Europe/Rome

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

Current product/runtime state:
- PR #36 `Disambiguate Romanian correlation and reserve confirmation checks`:
  **MERGED**;
- PR #36 merge / deployed product-runtime commit:
  `0d7a7b4177518e4fd324b200c1773be6eb8f1c0d`;
- main-push CI `34816651422`: **PASS**;
- canonical sc0ty synchronization thresholds remain unchanged;
- Romanian primary fast path remains 16 × 15 s;
- Romanian same-language matching now augments single-word evidence with hashed
  adjacent-word lexical context anchors;
- rescue keeps the 360 s / 6-minute sampled-audio cap while reserving extra
  verifier boundaries: three 30 s discovery probes plus two 15 s confirmation
  probes from four content-aware locations;
- maximum adaptive probe boundaries are now 21;
- Romanian adaptive Save remains fail-closed until verified adaptive convergence.

PR #36 validation:
- CI `34787178683`: **PASS**;
- Mobile WebKit Compatibility `34787178727`: **PASS**;
- Large-file Browser Stress `34787178687`: **PASS**;
- Public Pages Language Smoke PR gate `34787178802`: **PASS**;
- Legacy WebAssembly Build `34787178704`: **PASS**.

Latest deliberate product preview deployment:
- Deploy PWA Preview `34816680938`: **PASS**;
- deployed product commit:
  `0d7a7b4177518e4fd324b200c1773be6eb8f1c0d`;
- fresh legacy extractor/correlator build: **PASS**;
- isolated Romanian Whisper SIMD build/runtime: **PASS**;
- Romanian Chromium E2E: **PASS**;
- Romanian iPhone-like WebKit E2E: **PASS**;
- GitHub Pages artifact/deployment: **PASS**.

Post-deploy public Pages validation:
- Public Pages Language Smoke `34817766344`: **PASS**;
- live `whisper.js` and `whisper.wasm` were served with exact version hash
  `0d7a7b4177518e4fd324b200c1773be6eb8f1c0d`;
- representative original-language delivery and catalog checks passed;
- live Romanian E2E: **156** usable reference words, **141** Romanian context
  anchors, adaptive lock after **10/21** probes, **27** synchronization points,
  displayed **100.00%** correlation, formula `1.0003x-8.824`, and saved
  timing correction **-8.818 s** for the known +8 s fixture;
- zero console errors, page errors or HTTP failures.

The public fixture converged during the primary phase, so it validates the exact
PR #36 runtime, anchor path and unchanged fast path, but does not substitute for
the real physical Frozen II reproduction that motivated PR #36.

## Immediate milestone

PR #36 has now passed the authoritative physical iPhone/Safari Frozen II test:
- same >2 GB dual-audio Frozen II MKV + Romanian SRT;
- Cached Romanian Whisper model;
- elapsed **12:42**;
- **21/21** probes, rescue **5/5**;
- **248** usable reference words;
- **185** Romanian lexical context anchors;
- **25** synchronization points;
- candidate gain **+1** on the final probe;
- candidate span **81%**;
- canonical span **81%**;
- stable checks **3/3**;
- adaptive lock **verified**;
- displayed correlation **100.00%**;
- formula `1.0002x-0.943`;
- max change `0:00:933`.

The user then supplied the preferred original SRT and the SubSync2 output from
this physical run for exact offline timing comparison. Across **1,133 text-matched
cues**:
- mean start residual (original - SubSync2): **+166.8 ms**;
- median start residual: **+168.0 ms**;
- time-third medians: **+293 ms** at the beginning, **+134 ms** in the middle,
  and approximately **+4 ms** in the final third;
- the residual is almost perfectly affine rather than random:
  `originalTime ≈ 0.9999242315 × subSync2Time + 0.363043 s`;
- the affine residual explains the matched-cue timing difference with
  **R² ≈ 0.999988** and leaves < **1 ms** maximum fitting error;
- residual drift is approximately **-75.8 ppm**, i.e. about **-273 ms/hour**;
- the correction crosses zero at roughly **79.9 min** into the title.

Therefore the user's visual “200–300 ms early” observation is real, but the
problem is not a constant offset: it is a small intercept + slope error in the
final linear timing formula. Two non-timing content differences exist between
the supplied SRTs (one title-text replacement and one missing credit cue), but
they do not affect the 1,133 matched-cue timing analysis.

Code inspection exposed a concrete timing-contract mismatch:
- original sc0ty/PocketSphinx emits reference `Word.time` at the midpoint of
  each recognized segment;
- Romanian Whisper currently emits `Word.time` at the leading edge while also
  exposing the segment duration.

Because the original correlator was tuned against PocketSphinx midpoint
semantics, the active fix moves Romanian Whisper correlation timestamps to the
recognized-word midpoint rather than applying an arbitrary hard-coded delay.
Context-anchor acoustic bounds are preserved explicitly so this timestamp
change does not inflate or shift lexical-pair spans.

Branch under validation:
`fix/romanian-whisper-midpoint-timing`.

The deterministic Romanian browser fixture is also tightened from a broad
historical accepted shift range to a **±0.60 s fine-timing error** around the
known -8.0 s correction. In addition, the browser regression now measures
**all cue timestamps across the full title**, reports affine residual slope /
drift and beginning-middle-end timing, requires p95 absolute start error ≤
0.60 s, and caps synthetic full-title affine drift at **±0.35 s**. This closes
the previous test gap where only the first saved cue was checked. No canonical
sc0ty thresholds are changed.

## PR #38 midpoint timing — deployed and physical Frozen II validation

PR #38 `Align Romanian Whisper timing with sc0ty word midpoints` merged at:
`ff81b54509d5ec766200f5d724c9ca8f505fbbe3`.

Release evidence:
- PR CI: PASS;
- Mobile WebKit Compatibility: PASS;
- Large-file Browser Stress: PASS;
- Legacy WebAssembly Build rerun attempt #2: PASS;
- main CI `34834920368`: PASS;
- deliberate Deploy PWA Preview `34834963153`, attempt #2: PASS;
- post-deploy Public Pages Language Smoke `34842464186`: PASS on exact runtime
  `ff81b54509d5ec766200f5d724c9ca8f505fbbe3`;
- strict public Romanian timing smoke: 156 reference words, 136 context anchors,
  10/21 probes, 26 points, formula `1.0004x-8.561`, saved shift -8.554 s,
  p95 absolute start error 0.5461 s, affine drift 0.1687 s, zero console/page errors.

Authoritative physical iPhone/Safari retest on the same Frozen II >2 GB dual-audio
title:
- cached Romanian Whisper model, 30.7 MiB;
- elapsed **12:17**;
- **20/21** probes;
- rescue **4/5**;
- **233** reference words;
- **173** Romanian context anchors;
- stable checks **3/3**;
- **26** synchronization points;
- candidate gain **+1**;
- candidate span **81%**;
- canonical span **81%**;
- adaptive lock **verified**;
- displayed correlation **100.00%**;
- displayed formula `1.0001x-105.169`;
- max change `1:45:159`.

The user supplied both the preferred original SRT and the SubSync2 result from this
exact physical run. Both files contain **1,135 cues**. After whitespace
normalization, cue text matches for all 1,135 cues; only one cue differs in raw
formatting because of a line-break/space variation.

Exact timing comparison (original - SubSync2) over all 1,135 cues:
- mean start residual: **-63.6 ms**;
- median start residual: **-62.0 ms**;
- mean absolute start error: **94.4 ms**;
- median absolute start error: **78.0 ms**;
- p95 absolute start error: **226.6 ms**;
- maximum absolute start error: **283.0 ms**;
- time-third medians: **+47.5 ms** beginning, **-62.0 ms** middle,
  **-171.0 ms** final third;
- residual remains almost perfectly affine:
  `originalTime ≈ 0.9999383794 × subSync2Time + 0.096033 s`;
- residual slope: approximately **-61.6 ppm**;
- residual drift across the title: approximately **-375.9 ms**;
- maximum error after fitting that residual affine relation: **<0.6 ms**.

Compared with the previous physical PR #36 result, the midpoint fix materially
improved practical timing:
- mean absolute start error: **174.5 ms -> 94.4 ms** (~46% lower);
- median absolute start error: **168 ms -> 78 ms** (~54% lower);
- p95 absolute start error: **343 ms -> 226.6 ms** (~34% lower);
- maximum absolute start error: **360 ms -> 283 ms** (~21% lower).

The residual is now small enough to be a fine-polish issue rather than a
synchronization failure. Do not introduce a title/device-specific hard-coded
offset. Any further improvement should come from better formula estimation or
matched-point confidence/polish logic and must preserve canonical sc0ty
thresholds.

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


### Physical iPhone reproduction — 13 September 2026

The first full physical retest of the PR #29 adaptive build used the public
Pages PWA on real iPhone/Safari with a real >2 GB dual-audio
`Frozen.II.2019.1080p.10bit.BluRay.Dual.RoDubbed.x265.HEVC-PSA.mkv`,
Romanian audio selected, and the corresponding Romanian SRT.

Observed evidence:
- Romanian Whisper model was already **Cached · 30.7 MiB**, so model download
  time did not explain the runtime;
- at elapsed **5:23**, probe **9/16**:
  - 84 reference words;
  - 10 synchronization points;
  - displayed correlation 100.00%;
  - formula `1.0004x-1.851`;
  - max change `0:01:829`;
  - stable checks 0;
  - evidence span 0%;
  - adaptive lock pending;
  - **Save subtitles was incorrectly enabled while the adaptive lock was
    pending**;
- at elapsed **10:05**, probe **16/16**:
  - 151 reference words;
  - 15 synchronization points;
  - displayed correlation 100.00%;
  - formula `1.0007x-2.531`;
  - max change `0:02:495`;
  - stable checks 0;
  - evidence span 0%;
  - adaptive lock pending;
  - terminal state: `Synchronization inconclusive`;
  - diagnostic: 15 points found, canonical minimum remains 20.

The user reports that the output behavior recovered most of the deliberately
large (>10 s) offset but remained visibly out of sync. Treat that as practical
device evidence, while the noncanonical intermediate formula itself must not be
treated as an accepted final synchronization result.

Confirmed conclusions:
- the physical failure is **not** caused by lowering/raising thresholds; the
  canonical 20-point guard correctly rejected an under-evidenced result;
- Romanian ASR itself produced substantial evidence (151 reference words), but
  the 16 × 15 s primary sample budget produced only 15 canonical candidate
  points on this real title;
- the synthetic fixture was easier than this real movie and therefore cannot be
  the sole release criterion;
- exposing Save while `adaptive lock: pending` is a real UX/safety bug.

### PR #32 — rescue probes and fail-closed Save policy

PR #32 `Add Romanian rescue probes for real iPhone convergence` merged at
`b8c8a292957fce2f509c43d95c357091ae45adb3`.

The fix is driven directly by the 13 September physical iPhone reproduction and
preserves the successful primary path:
- primary stage remains **16 × 15 s** progressive/farthest-first probes;
- if adaptive convergence verifies during primary, processing stops early as
  before;
- if primary probing does not verify, up to **8 rescue probes** are appended
  from previously unscanned timeline gaps;
- rescue windows are capped at 15 s and may be shorter where only a smaller
  unused gap remains;
- primary and rescue windows do not intentionally overlap;
- maximum long-title sparse candidate count is **24**;
- maximum sampled Romanian audio is **360 s / 6 minutes**;
- one Romanian Whisper context/worker is retained for memory safety;
- canonical sc0ty thresholds remain unchanged.

Runtime diagnostics expose:
- `primaryWindows`;
- `rescueWindowsTotal`;
- `rescueWindowsCompleted`;
- phase `primary` / `rescue`.

The Save policy is fail-closed for long Romanian adaptive runs:
- `Save subtitles` remains disabled while adaptive lock is pending;
- `subReady` alone is insufficient for this path;
- the weaker legacy `Synchronization inconclusive` save fallback is forbidden
  for Romanian adaptive runs;
- export is enabled only after verified adaptive convergence;
- non-Romanian legacy behavior remains unchanged.

Regression coverage includes the unit-level `tests/js/save-policy.js` check
and browser monitoring that fails if Save becomes enabled while the UI still
reports `adaptive lock: pending`.

PR #32 gates, main CI, deliberate deploy and post-deploy live smoke are all
green. The remaining validation is physical-device rescue behavior on the same
real-title class; no automated WebKit result is labeled as a physical iPhone
test.

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

Production auto-deploy remains disabled. Moving `deploy/pages-preview` remains
a deliberate release action.

### PR #29 historical adaptive deployment

PR #29 product runtime
`9768cd3daf4d0368993ab6e4b1ae3b9cd84affe7` was the first deployed adaptive
release. Deploy `34747503470` passed. Its post-deploy retry
`34749671716` passed and established the permanent live regression baseline.
PR #30 later strengthened that regression and recorded a live adaptive lock
after 10/16 probes in run `34749834500`.

### PR #32 historical deployed runtime

The current product runtime is PR #32 merge commit
`b8c8a292957fce2f509c43d95c357091ae45adb3`.

Deliberate deployment:
- Deploy PWA Preview `34759835092`: **PASS**;
- authoritative build job: **PASS**;
- fresh legacy WebAssembly extractor/correlator: **PASS**;
- isolated Romanian Whisper SIMD: **PASS**;
- Romanian Chromium E2E: **PASS**;
- Romanian iPhone-like WebKit E2E: **PASS**;
- Pages deploy job: **PASS**.

Post-deploy public verification:
- Public Pages Language Smoke `34760470647`: **PASS**;
- representative original-language delivery checks: **PASS**;
- full signed 226-package catalog checks: **PASS**;
- live Romanian reference words: **167**;
- adaptive lock: **verified after 10/24 probes**;
- synchronization points: **28**;
- displayed correlation: **100.00%**;
- formula: `0.9994x-8.584`;
- saved timing correction: **-8.597 s** for the known +8 s fixture;
- `whisper.js` and `whisper.wasm`: HTTP 200 with query/version hash
  `b8c8a292957fce2f509c43d95c357091ae45adb3`;
- pinned Romanian model: HTTP 200;
- model lifecycle download -> verify -> store -> ready: **PASS**;
- Romanian diacritics preserved;
- zero console, page and HTTP errors.

Because this deterministic public fixture converged at 10/24, it did not enter
rescue. This is expected and confirms the primary fast path was not regressed.
The physical Frozen II retest remains the authoritative test of the rescue
phase and of real-iPhone wall-clock/practical alignment.


### PR #34 current deployed runtime

Current product runtime:
`d2d78f7497ec42ebb1f1c4c149e4a3b9bbdb5556`.

PR #34 gates:
- CI `34780660040`: **PASS**;
- Mobile WebKit Compatibility `34780660115`: **PASS**;
- Large-file Browser Stress `34780660006`: **PASS**;
- Legacy WebAssembly Build `34780660103`, attempt 2: **PASS**.

Merged-main gate:
- CI `34783010599`: **PASS**.

Deliberate deployment:
- Deploy PWA Preview `34783030385`: **PASS**;
- fresh legacy WebAssembly extractor/correlator: **PASS**;
- isolated Romanian Whisper SIMD: **PASS**;
- Romanian Chromium E2E: **PASS**;
- Romanian iPhone-like WebKit E2E: **PASS**;
- Pages deployment: **PASS**.

Post-deploy public validation:
- Public Pages Language Smoke `34783620010`: **PASS**;
- exact live JS/WASM version hash:
  `d2d78f7497ec42ebb1f1c4c149e4a3b9bbdb5556`;
- live Romanian reference words: **148**;
- adaptive lock: **verified after 9/20 probes**;
- synchronization points: **26**;
- displayed correlation: **100.00%**;
- formula: `1.0002x-8.884`;
- saved timing correction: **-8.880 s**;
- zero console, page and HTTP errors.

This deterministic fixture converged before rescue, which is correct for the
preserved primary fast path. It does not substitute for the real physical
Frozen II rescue reproduction.

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

Romanian audio physical status:

1. **Pre-adaptive test — partial PASS**
   - real >2 GB direct MKV opened;
   - Romanian audio selected;
   - Romanian model and local processing worked;
   - an early save improved timing but remained materially inaccurate.

2. **PR #29 16-probe adaptive retest — FAIL / INCONCLUSIVE**
   - real iPhone/Safari;
   - Frozen II >2 GB dual-audio MKV;
   - model reused from cache;
   - run stayed foregrounded and reached terminal state;
   - 10:05 elapsed;
   - 16/16 probes completed;
   - 151 reference words;
   - 15 points versus canonical minimum 20;
   - adaptive lock never verified;
   - practical synchronization remained incorrect;
   - Save was observed enabled prematurely at 9/16 while lock was pending.

3. **PR #32 uniform rescue retest — FAIL / INCONCLUSIVE**
   - product runtime:
     `b8c8a292957fce2f509c43d95c357091ae45adb3`;
   - real iPhone/Safari, same Frozen II title;
   - Cached Romanian model;
   - 17:30 elapsed;
   - 24/24 probes, rescue 8/8;
   - 224 reference words;
   - 18 points versus canonical minimum 20;
   - displayed 100.00% correlation but adaptive lock pending;
   - provisional formula `1.0002x-1.029`;
   - uniform rescue improved 15 -> 18 points but remained insufficient.

4. **PR #34 content-aware contextual rescue — PHYSICAL FAIL / INCONCLUSIVE**
   - product runtime:
     `d2d78f7497ec42ebb1f1c4c149e4a3b9bbdb5556`;
   - real iPhone/Safari, same Frozen II title;
   - 12:52 elapsed;
   - 20/20 probes, rescue 4/4;
   - 243 reference words;
   - 26 points;
   - candidate gain +4;
   - candidate and canonical span 81%;
   - stable checks 2/3;
   - adaptive lock pending;
   - displayed correlation 100.00%;
   - provisional formula `1.0002x-0.950`;
   - max change `0:00:941`;
   - canonical point/span guards were satisfied, but verification did not reach
     the required third stable confirmation.

5. **PR #36 context-anchor + confirmation-reserve — PHYSICAL PASS / FINE TIMING FOLLOW-UP**
   - product runtime:
     `0d7a7b4177518e4fd324b200c1773be6eb8f1c0d`;
   - real iPhone/Safari, same Frozen II title;
   - 12:42 elapsed;
   - 21/21 probes, rescue 5/5;
   - 248 reference words;
   - 185 Romanian context anchors;
   - 25 points;
   - candidate gain +1;
   - candidate and canonical span 81%;
   - stable checks 3/3;
   - adaptive lock verified;
   - displayed correlation 100.00%;
   - formula `1.0002x-0.943`;
   - max change `0:00:933`;
   - practical synchronization succeeded, with a reported residual timing bias
     of approximately 200–300 ms early versus the preferred original timing.

6. **PR #38 midpoint timing alignment — PHYSICAL PASS**
   - runtime:
     `ff81b54509d5ec766200f5d724c9ca8f505fbbe3`;
   - original PocketSphinx midpoint timing semantics are now used by Romanian
     Whisper reference words;
   - context-anchor acoustic bounds remain correct for centered reference words;
   - no hard-coded device/title timing offset was introduced;
   - exact post-deploy public smoke is green;
   - real iPhone/Safari Frozen II retest verified adaptive lock after 20/21
     probes and produced 26 points over 81% canonical span;
   - exact SRT-vs-original comparison shows 94.4 ms mean absolute start error,
     78 ms median absolute start error, p95 226.6 ms and max 283 ms;
   - the midpoint fix materially reduces the previous physical residual and is
     the current physically validated Romanian single-file baseline.

Model bytes persist through browser IDBFS. Active job persistence/resume across
Safari background suspension is still not implemented; physical release tests
must keep Safari foregrounded unless resume behavior is explicitly under test.

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
- a simple Android/NVIDIA Shield Pro application is a future product option,
  but only after the browser single-file workflow is release-stable on the
  physical iPhone; it should reuse the validated synchronization/ASR concepts
  or core rather than diverge into a second algorithm prematurely.

## Next sequence

1. Treat PR #38 runtime `ff81b54509d5ec766200f5d724c9ca8f505fbbe3`
   as the current physically validated Romanian single-file baseline.
2. Do not add a constant +/− millisecond compensation based on Frozen II.
3. If pursuing additional accuracy, first add matched-point/formula-confidence
   diagnostics or a bounded evidence-polish strategy that can justify using the
   remaining probe when formula uncertainty is still material.
4. Preserve all canonical sc0ty thresholds and the 360 s sampled-audio cap.
5. Keep batch/multi-upload deferred until the user decides the single-file
   accuracy/runtime trade-off is good enough for product expansion.


## Session closeout — 13 September 2026

Confirmed state at closeout:
- repository truth and branch -> PR -> green CI -> merge remain mandatory;
- PR #32 physical uniform rescue failed at 18/20 points after 24/24 probes;
- no canonical sc0ty threshold was weakened;
- PR #34 content-aware point-gain-first rescue is merged at
  `d2d78f7497ec42ebb1f1c4c149e4a3b9bbdb5556`;
- PR #34 CI/WebKit/stress/fresh-WASM gates are green;
- main CI `34783010599` is green;
- deliberate Deploy PWA Preview `34783030385` is green;
- post-deploy Public Pages Language Smoke `34783620010` is green;
- live `whisper.js` / `whisper.wasm` carry exact runtime hash
  `d2d78f7497ec42ebb1f1c4c149e4a3b9bbdb5556`;
- live Romanian fixture converged after 9/20 primary probes with 148 reference
  words and 26 points, so rescue was correctly not consumed by that fixture;
- Romanian adaptive Save remains fail-closed until verified lock;
- candidate evidence diagnostics now remain useful before the 20-point
  canonical gate;
- iPhone-like WebKit CI remains automation, not physical-iPhone evidence;
- Safari background job resume is still not implemented;
- browser-first/local processing, GPLv3/sc0ty attribution, original catalog and
  no-paid-service-without-approval rules remain unchanged;
- Android/NVIDIA Shield and batch/multi-upload work remain deferred until the
  web single-file path is physically release-stable.

## Open blockers

- Romanian single-file synchronization now has a physical PASS on PR #38 and
  exact SRT comparison confirms sub-300 ms maximum start error on the Frozen II
  reproduction, but a small affine residual remains if further fine-polish is
  desired;
- browser job resume/persistence across Safari suspension/backgrounding is not
  implemented;
- the historical real-world direct-MKV failure class remains
  reproduction-dependent on a representative failing file;
- not every original sc0ty language/model pair has a dedicated full
  recognition/correlation E2E, although the complete signed catalog is deployed
  and representative live loading is validated;
- batch/multi-upload remains deliberately deferred pending the next product
  decision.

