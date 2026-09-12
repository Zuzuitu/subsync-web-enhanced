# SubSync2 — Project State

LAST_UPDATED: 2026-09-12 14:42 Europe/Rome

## Canonical status

This file is the human-readable technical checkpoint for SubSync2.
Repository truth overrides chat memory. Before material changes, read:
1. `docs/PROJECT_STATE.md`
2. `config/project-invariants.json`
3. `AGENTS.md`
4. relevant current implementation

## Current handoff checkpoint

Canonical main: `8b4170becbea970b0e5d8801771f90e3a333658a` (merged PRs #17-#20 from this session).

Public preview: `https://zuzuitu.github.io/subsync-web-enhanced/`.
Latest successful preview deployment: run `34662280482`, commit `6f32c78e231c0b5711d01231cde2807a3322d627`.

The public preview is intentionally behind current main. It includes the restored original-language catalog, but not the later runtime/UI changes from PR #17 (language download/cache UX) and PR #18 (stage-specific diagnostics). Do not claim those changes are live until a deliberate preview deployment is performed and verified.

Completed in this session:
- restored and validated the original sc0ty language catalog;
- fixed the deterministic MKV split-window seek gap;
- added language asset download/progress/cache management;
- added evidence-backed stage-specific synchronization diagnostics;
- added and passed >=128 MiB direct-MKV browser stress in Chromium and iPhone-like WebKit.

Still open:
- historical real-world failing MKV reproduction requires a representative failing file;
- genuine Romanian-audio speech recognition is not implemented;
- batch/multi-upload remains deferred.

Next sequence:
1. implement genuine Romanian-audio speech recognition with a pinned redistributable local/browser model;
2. add deterministic Romanian-audio regression coverage;
3. run the full release-candidate regression suite;
4. deliberately deploy the current release candidate to the preview branch;
5. repeat physical-iPhone validation;
6. consider batch/multi-upload only after single-file reliability is solid.

Production auto-deploy remains disabled.

## Product goal

Revive and modernize sc0ty/SubSync as a browser-first PWA while preserving the original synchronization algorithm where technically sound.

**Primary near-term workflow: English reference audio + Romanian subtitles.**

Romanian audio speech recognition remains a final-product requirement but is deferred until the main workflow is near completion. Multi-upload is not a near-term priority.

## Repository and governance

- Repository: `Zuzuitu/subsync-web-enhanced`
- Upstream: `sc0ty/subsync`
- Pinned baseline: `c888da7257d57bf039523c9f7015feacb4b95dc3`
- License: GNU GPL v3
- sc0ty / Michał Szymaniak attribution is mandatory.
- Material changes: branch -> PR -> CI green -> merge.
- Production auto-deploy remains disabled.

## Romanian subtitle status

Confirmed:
- `ro`, `rum`, `ron` canonicalize to internal `rum`;
- UTF-8 Romanian diacritics survive WASM subtitle decoding;
- Windows-1250 Romanian subtitles are regression-tested;
- embedded Matroska `ron` subtitle metadata is recognized;
- PR #4 merged to `main` at `a592e12cd0cab30ceacb30b85dbf10ee9598b7fe`.

Romanian audio is not a current blocker. The original sc0ty release has no Romanian PocketSphinx model.

## Architecture

Primary reference path:
`MKV ENG -> WORKERFS -> FFmpeg Demux -> AudioDec -> Resampler -> PocketSphinx ENG -> words`

Subtitle path:
`RO SRT -> SubtitleDec -> original sc0ty ENG<->RO dictionary -> translated comparison words`

Synchronization:
`reference words + subtitle comparison words -> original SubSync correlator -> timing formula`

## Pinned primary-workflow assets

Original sc0ty assets:
- `speech-eng.zip` v1.0.0 — SHA-256 `b96fa77cc3567c0351d1a1dae2cd87cb38ae815834903cc1e680e48b6cbd45a5`
- `dict-eng-rum.zip` v1.1.1 — SHA-256 `04350f06586fc06082142e7a8e9b32f961782bc08341755594a0c4be3b57cfc4`
- original `assets.json` — SHA-256 `f25ccee51728c6632fdb66a33744e33945cb054a562c4ff600afc03ced605da4`

CI-only speech fixture:
- Piper `en_US-joe-medium`, revision `v1.0.0`
- model SHA-256 `58afce0321b8d9c46d7cdf9c16500cc55a793b4220212dba6b70fb788b3baf06`
- config SHA-256 `3d6d5410b3795cb1950595247ef8f06190719e6fdbfa3a2356d8ec368e1aad33`
- source voice dataset: CC0

Piper is used only to generate deterministic CI audio. It is not shipped in the PWA and is not a production speech dependency.

## English audio + Romanian subtitle E2E

Fast browser/WASM run `34619486104`: **PASS**.

Fixture:
- direct MKV with English audio;
- Romanian external SRT;
- known subtitle shift: +8.0 s;
- full original English speech model;
- full original ENG<->RO dictionary;
- unchanged product thresholds: minPoints=20, minCorrelation=0.9999, maxPointDist=2 s, minWordProb=0.3, minWordLen=5, minWordsSim=0.6.

Measured:
- 77 English reference words;
- 31/33 intended target words recognized in their correct speech segment;
- 279 translated subtitle comparison words;
- 24 correlated subtitle buckets/points;
- correlation factor `0.999912507825241`;
- max distance `0.3305198550 s`;
- formula `y = 1.0007240772x - 7.5714645386`;
- expected truth `y = 1.0x - 8.0`;
- result: PASS without threshold weakening.

This proves the primary ENG-audio + RO-subtitle architecture end to end on a deterministic direct-MKV browser fixture.

Authoritative Legacy WebAssembly Build run `34620017397`: **PASS** on freshly compiled WASM. PR #5 merged this regression to `main` at `a2acdfca162b8fe53bc0ac792ebf7cafe1c9829e`.

## Original sc0ty language catalog restoration

The first SubSync2 PWA milestone deliberately staged only the assets required for the primary product path:
- `speech/eng`;
- `dict/eng-rum`.

Although the UI retained the broader legacy language list, asset validation therefore rejected other speech languages and language pairs. Do not describe the pre-restoration public preview as full original-language parity.

The pinned original sc0ty `assets` release contains:
- **9 speech models**: `chi`, `dut`, `eng`, `fre`, `ger`, `gre`, `ita`, `rus`, `spa`;
- **217 dictionary packages**;
- about **504 MiB** total across speech models and dictionaries.

PR #13 restored this pinned catalog to the browser build without changing the original synchronization algorithm or product thresholds. It merged to `main` at `6f32c78e231c0b5711d01231cde2807a3322d627`.

Final PR #13 validation:
- CI run `34661678278`: **PASS**;
- Mobile WebKit Compatibility run `34661678268`: **PASS**;
- authoritative Legacy WebAssembly Build run `34661678270`: **PASS**.

Security and delivery design:
- the original `assets.json` remains pinned by SHA-256 `f25ccee51728c6632fdb66a33744e33945cb054a562c4ff600afc03ced605da4`;
- sc0ty's original RSA asset-verification public key is vendored from pinned upstream commit `c888da7257d57bf039523c9f7015feacb4b95dc3` and pinned by SHA-256 `71523aa370bca38c2af77b36e6fece5f7340963df5c0fc3024c9784e6c6de436`;
- mirrored ZIP packages are verified against their original `.asc` signatures with RSA PKCS#1 v1.5 + SHA-256 before publication;
- browser asset URLs remain same-origin under `assets/data/`;
- ordinary CI/PWA artifacts remain small and still stage only the primary ENG speech + ENG↔RO dictionary;
- the **deliberate GitHub Pages preview deploy** mirrors the complete verified original catalog before upload, so the browser can fetch additional models/dictionaries on demand and IDBFS can persist those actually used.

A direct-browser attempt to fetch GitHub Release asset URLs cross-origin was tested and failed with browser `TypeError: Failed to fetch` (CORS). That approach was discarded rather than worked around with a media/backend service.

Representative browser validation, fast PWA run `34661554867`: **PASS**.
- `dict/eng-ita` v1.1.2 signature verified; 961,607 bytes;
- `speech/ita` v1.0.0 signature verified; 8,539,884 bytes;
- both were served from the same-origin staged site and fetched by the actual PWA with HTTP 200;
- no console errors;
- no page errors.

The tiny Italian fixtures intentionally did not provide enough correlation evidence and ended in `Couldn't synchronize`. This test proves catalog restoration, signature verification, browser delivery, extraction and model/dictionary loading for representative non-primary assets; it does **not** claim that every original language has already passed a full recognition/correlation E2E.

### Full original-language preview deployment

Preview run `34662280482`: **PASS** for commit `6f32c78e231c0b5711d01231cde2807a3322d627`.

Confirmed deployment evidence:
- authoritative WASM/PWA build: PASS;
- canonical MKV + Romanian SRT browser/WASM matrix: PASS;
- ENG-audio + RO-subtitle E2E: PASS;
- upstream-language smoke: PASS;
- full original sc0ty asset mirror: PASS;
- **226 signed packages** mirrored and verified: 9 speech models + 217 dictionaries;
- verified mirrored payload: **528,928,835 bytes** (~504.4 MiB);
- GitHub Pages artifact upload: PASS;
- GitHub Pages deployment: PASS;
- public preview remains `https://zuzuitu.github.io/subsync-web-enhanced/`.

This means the public preview now publishes the complete pinned original sc0ty speech/dictionary catalog. It does **not** mean every one of the 226 packages has individually passed a full synchronization E2E; representative non-primary loading is validated, while full per-language behavioral coverage remains future work.

### Public Pages representative-language validation

Live public Pages smoke run `34663120776`: **PASS** against `https://zuzuitu.github.io/subsync-web-enhanced/`.

The test first validated the deployed mirror manifest itself:
- 226 packages present;
- 528,928,835 bytes total;
- pinned asset-index SHA-256 matched;
- pinned sc0ty signing-key SHA-256 matched;
- every manifest entry reported signature verification.

The actual deployed PWA then exercised both dictionary-loading and speech-model-loading paths for three non-primary languages:
- Italian: `dict-eng-ita.zip` HTTP 200 and `speech-ita.zip` HTTP 200;
- French: `dict-eng-fre.zip` HTTP 200 and `speech-fre.zip` HTTP 200;
- Spanish: `dict-eng-spa.zip` HTTP 200 and `speech-spa.zip` HTTP 200.

Across all six live asset-loading paths:
- zero console errors;
- zero page errors;
- same-origin public Pages asset delivery succeeded.

The test fixtures are intentionally tiny and the audio fixtures are silence, so their final UI state is `Couldn't synchronize`. This is expected and is **not** evidence of a language failure. This live smoke proves public deployment, lookup, download, extraction/model initialization paths for representative non-primary languages; it does not claim full recognition/correlation E2E for those languages.

## Original historical MKV issue

Historical observation: some direct MKV + SRT files failed while extracted audio + the same SRT succeeded.

The exact historical root cause is still unconfirmed.

Current negative evidence:
- AAC, AC3, E-AC3, multiple audio tracks, and embedded subtitles pass the deterministic browser/WASM matrix;
- generated direct MKV with English audio + Romanian SRT passes end to end;
- H.264 + stereo AAC passes;
- HEVC/H.265 + E-AC3 5.1 passes;
- reversed audio-track order with the desired English 5.1 track second passes;
- a 125.064 s direct-MKV time-window seek fixture passes after the seek-gap fix below.

### Confirmed split-window seek reliability bug and fix

While expanding realistic MKV coverage, a separate deterministic reliability bug was reproduced in the parallel reference-window path used for longer media.

Baseline diagnostic run `34666168345` used the previous known-good WASM binary. On a 125.064 s H.264/AAC MKV with 10 s video keyframes:
- requested seek: `62.5 s`;
- `Demux.getPosition()` immediately reported `62.5 s`;
- first/minimum packet position actually observed after reading: **`70.0 s`**.

Because `Synchronizer` splits longer references into adjacent worker time windows, a forward seek to the next video keyframe can skip reference audio at the beginning of a worker window and create an uncovered gap between workers.

PR #16 changes only `Demux::seek()` from the default FFmpeg seek flags to `AVSEEK_FLAG_BACKWARD`, preventing a worker from jumping forward beyond its requested start.

Authoritative freshly compiled WASM run `34666292346`: **PASS** with strict seek regression enabled.
Measured on the same fixture:
- requested seek: `62.5 s`;
- minimum observed packet position: **`60.0 s`**;
- maximum observed position in the test window: `68.0 s`;
- processed packets in the seek window: `134`;
- no forward gap past the requested start.

The same authoritative run also passed:
- H.264 video + stereo AAC;
- HEVC/H.265 video + E-AC3 5.1;
- reversed multitrack selection where the English 5.1 stream is second;
- the existing AAC / AC3 / E-AC3 / embedded-subtitle / Romanian subtitle regressions;
- the primary ENG-audio + RO-subtitle E2E and PWA regressions.

This is a **confirmed MKV reliability bug** fixed by PR #16. It is a plausible contributor to some long-media failures, but it is **not** claimed as the confirmed root cause of the historical real-world MKV report until a representative historical failing file is reproduced.

The 125 s fixture is intentionally only ~519 KiB, so it validates duration and seek-window behavior but **does not** prove large-file browser memory-pressure reliability.

Do not claim MKV itself is generally broken. Remaining reproduction work should focus on large real files, browser memory behavior, unusual container metadata, and a representative historical failing MKV.

## Build

Legacy WebAssembly is reproducible in GitHub Actions:
- Emscripten `1.39.11-fastcomp`
- FFmpeg `n4.2`
- SphinxBase `4ffc4b79515fd18f7adfbf80c20f3c0ecb9edccd`
- PocketSphinx `ab6d6471800966990e12fdb6ed27ae36323cf2c4`

Outputs:
- `extractor.js/.wasm`
- `correlator.js/.wasm`

Compatibility note: Emscripten 1.39.11 MODULARIZE returns a legacy thenable. Keep the instance wrapped as `{ instance }` across Promise/async boundaries.

## Browser application / PWA status

PR #6 merged to `main` at `9560b05a832b6a060e8eabacb6744fa9868f4f3c`.

The merged PWA contains:
- responsive installable browser shell;
- web manifest and service worker;
- visible sc0ty/Michał Szymaniak attribution and GPL v3 notice;
- local-processing/privacy messaging;
- reproducible generation of `web/src/data/assets.json` and `web/version.json`;
- pinned `web/package-lock.json` with `npm ci` in CI;
- staging of pinned `speech-eng.zip` and `dict-eng-rum.zip` with SHA-256 verification;
- no ~40 MB speech model committed to git;
- service-worker cache cleanup restricted to SubSync2 cache names;
- browser shell smoke coverage;
- full primary workflow exercised through the real PWA UI.

Fast PWA and governance checks on PR #6: **PASS**.

Authoritative Legacy WebAssembly Build run `34633224194`: **PASS** on freshly compiled WASM and the staged PWA.

Confirmed through the actual PWA UI:
`select RO SRT + select ENG MKV -> select rum/eng -> Start -> synchronize -> Save subtitles -> download corrected SRT`.

Measured UI-flow result:
- synchronization points shown: `23`;
- correlation shown: `99.99 %`;
- formula shown: `1.0003x-7.568`;
- max change shown: `0:07:564`;
- downloaded file: `reference-english.srt`;
- saved first-timestamp correction: `-7.565 s`;
- Romanian fixture tokens and diacritics preserved;
- service worker ready;
- zero console errors;
- zero page errors;
- zero HTTP failures.

The generated truth was a +8.0 s subtitle offset, so the downloaded SRT correction is within the expected range without weakening synchronization thresholds.

CI improvements merged with the PWA:
- native Emscripten dependency workspace is cleared before `npm ci`, avoiding root-owned `node_modules` conflicts;
- obsolete Legacy WebAssembly runs cancel automatically through workflow concurrency;
- documentation-only checkpoint changes no longer trigger the expensive legacy WASM build.

## Testing status

Completed:
1. governance and build pins;
2. reproducible legacy WASM build;
3. initial MKV codec/track matrix;
4. full demux/decode/resample/legacy speech path;
5. Romanian UTF-8 subtitles;
6. Romanian Windows-1250 subtitles;
7. `ro/rum/ron` canonicalization;
8. fast browser E2E for ENG audio + RO subtitles;
9. authoritative freshly compiled WASM E2E;
10. merge of the primary ENG->RO regression through PR #5;
11. reproducible primary asset-index/version generation;
12. PWA shell build and browser smoke;
13. deterministic JavaScript dependency locking with `package-lock.json` + `npm ci`;
14. authoritative full PWA user-flow E2E including downloaded corrected SRT;
15. PWA shell merge through PR #6.

Completed additionally:
16. deliberate/manual GitHub Pages preview deployment path;
17. public HTTPS preview deployment;
18. physical iPhone/Safari validation reported successful by the user.

Next:
19. expand realistic MKV coverage;
20. reproduce/isolate the historical real-world direct-MKV failure class if a representative file is available;
21. return to Romanian-audio support near completion.

## Mobile WebKit / iPhone-like compatibility

CI run `34646549007`: **PASS** using Playwright WebKit with the iPhone 14 device profile and the staged PWA under the same repository subpath shape used by GitHub Pages.

Confirmed in that WebKit run:
- PWA loaded without the unsupported-browser screen;
- service worker reached ready state;
- Romanian SRT and English MKV loaded through the real file inputs;
- synchronization completed successfully;
- 25 synchronization points;
- correlation shown: `99.99 %`;
- formula shown: `1.0037x-7.686`;
- max change shown: `0:07:653`;
- downloaded `reference-english.srt`;
- saved first-timestamp correction: `-7.654 s`;
- Romanian text/diacritics preserved;
- zero console errors;
- zero page errors;
- zero HTTP failures.

This is strong WebKit compatibility evidence, but it is **not** a physical-iPhone Safari test. Playwright's iPhone profile provides Safari/WebKit user-agent/device emulation, while the Linux WebKit runtime is not identical to iOS and reported `maxTouchPoints=0`.

## Preview deployment

PR #8 merged the manual GitHub Pages preview workflow and subpath-safe PWA support.

GitHub Pages was enabled at repository settings level with **GitHub Actions** as the source.

After Pages enablement, the first retry reached the deploy job but was rejected before runner steps executed when targeting the default `github-pages` environment from the dedicated `deploy/pages-preview` branch.

PR #11 changed only the preview deployment environment to the dedicated `subsync2-pages-preview` environment. CI passed and PR #11 merged at `c8b4f7d6feba3d2fe32143b3fe1e83c5524506c4`.

Authoritative preview run `34650472508`: **PASS**.
- authoritative WASM/PWA build: PASS;
- primary ENG audio + RO subtitles UI flow: PASS;
- `actions/configure-pages@v5`: PASS;
- Pages artifact upload: PASS;
- `actions/deploy-pages@v4`: PASS;
- deployed commit: `c8b4f7d6feba3d2fe32143b3fe1e83c5524506c4`;
- public HTTPS preview: `https://zuzuitu.github.io/subsync-web-enhanced/`.

Production auto-deploy remains disabled. This URL is the deliberate preview target.

### Hosting decision from this session

For the current preview milestone, **GitHub Pages remains the selected host**.

Rationale:
- the repository already has a deliberate/manual GitHub Pages workflow and subpath-safe PWA support;
- the staged PWA bundles the pinned original sc0ty `speech-eng.zip` asset, whose release asset size is `39,638,792` bytes (~37.8 MiB);
- Cloudflare Pages currently limits an individual static site asset to **25 MiB**, so the current artifact cannot be deployed there unchanged;
- moving that asset to R2/origin storage or changing asset delivery would be a separate architecture/deployment decision and is not needed for the current iPhone-validation milestone.

GitHub Pages repository configuration used:
- Pages source: **GitHub Actions**;
- HTTPS: enabled;
- no custom domain configured yet;
- no Jekyll/Static HTML starter workflow is used;
- dedicated deployment environment: `subsync2-pages-preview`.

Cloudflare Pages is therefore deferred, not rejected permanently.

## Physical iPhone / Safari validation

On 2026-09-12, after the successful public Pages deployment, the user tested the preview on a physical iPhone and reported **success**.

Confirmed evidence is limited to the user's successful real-device result. No additional per-step metrics, memory figures, console logs, timing values, or codec/container characteristics were reported in this session, so do not invent them.

This closes the immediate "physical iPhone/Safari not yet measured" blocker for the primary workflow at a high level. It does **not** replace future stress coverage for long files, memory pressure, unusual MKV metadata, seeking, H.264/H.265 combinations, channel layouts, or additional codecs.

## Testing status

Completed additionally:
16. WebKit/iPhone-like full primary-flow E2E, including downloaded corrected SRT;
17. manual GitHub Pages preview deployment;
18. successful public HTTPS deployment;
19. physical iPhone/Safari validation reported successful by the user.

Completed additionally:
20. representative non-primary language validation against the live public Pages preview (Italian, French, Spanish dictionary + speech asset paths).

Completed additionally:
21. realistic MKV coverage expansion and deterministic split-window seek-gap fix: H.264/AAC stereo, HEVC/E-AC3 5.1, reversed multitrack, 125 s seek-window coverage;
22. language-asset download/cache UX with progress, IDBFS reuse and deliberate cache cleanup;
23. stage-specific synchronization diagnostics with evidence-backed failure explanations.

Completed additionally:
24. historical real-world direct-MKV failure remains reproduction-dependent on a representative failing file;
25. explicit >=128 MiB direct-MKV browser stress coverage in Chromium and iPhone-like WebKit, with process-RSS baselines.

Next:
26. implement genuine Romanian-audio speech recognition with a pinned, redistributable local/browser model;
27. perform final release-candidate regression + deliberate preview deployment and physical-iPhone validation;
28. consider batch/multi-upload only after single-file reliability is solid.

## Language asset UX and cache management

PR #17 merged to `main` at `2cf6d5c9178ecacc4c72fcf4aef73262fac5a9ce`.

Implemented:
- language ZIP downloads are asynchronous in the extractor worker;
- the synchronization UI reports `Downloading -> Extracting -> Ready`;
- later runs report `Cached` and reuse IDBFS without re-downloading the ZIP;
- per-package cache metadata records version, byte size and cache timestamp;
- Advanced Options lists downloaded speech/dictionary packages;
- users can deliberately clear downloaded language data and the deletion persists across reloads.

Regression evidence on the final PR head:
- CI run `34669111365`: **PASS**;
- Mobile WebKit Compatibility run `34669111331`: **PASS**;
- Legacy WebAssembly Build run `34669111359`: **PASS**;
- PWA Shell Fast Build run `34669108885`: **PASS**.

The browser regression proves first-run download/extraction, second-run IDBFS reuse with no language-ZIP refetch, and persistent cache deletion after reload.

## Stage-specific synchronization diagnostics

PR #18 merged to `main` at `b9d6ea535f6992d81b9e9008912b3ea06af9fe0c`.

The PWA no longer relies only on a generic `Couldn't synchronize` result. It now tracks and surfaces evidence for:
- initialization;
- language-data loading;
- media pipeline open;
- demux/container read;
- audio decoding;
- audio resampling;
- speech recognition;
- subtitle decoding;
- dictionary/translation;
- processing;
- correlation.

The UI also reports counts for decoded subtitle cues, subtitle words and reference words. For no-result cases it can explain evidence-backed outcomes such as:
- no subtitle cues decoded;
- no usable subtitle words;
- no usable reference words;
- too few synchronization points;
- correlation below threshold;
- synchronization points too far apart.

Native exception `module` fields remain the authoritative stage evidence where available; fallback diagnoses are explicitly based on observed counts/status and are not presented as unproven root causes.

Regression evidence on the final PR head:
- CI run `34685301209`: **PASS**;
- PWA Shell Fast Build run `34685258696`: **PASS**;
- Mobile WebKit Compatibility run `34685301225`: **PASS**;
- Legacy WebAssembly Build run `34685301223`: **PASS**.

The non-primary silence fixture specifically verifies that the PWA identifies the speech-recognition stage and explains that no usable reference words were produced.

## Large-file browser / memory stress coverage

Large-file browser stress run `34688234561`: **PASS**.

The canonical stress fixture is generated locally in CI and is not committed:
- direct Matroska file;
- H.264 1280x720 high-byte-rate video;
- English AAC reference audio;
- duration: `90.064 s`;
- file size: **143,952,449 bytes (137.28 MiB)**.

The real staged PWA selects the MKV through the browser file input, reads stream metadata through WORKERFS, selects the intended English audio stream, loads the normal pinned ENG↔RO dictionary and English speech model, and processes the direct MKV to a normal terminal state.

Chromium result:
- stream metadata load: `0.093 s`;
- terminal state reached in `5.351 s`;
- descendant-process peak RSS observed: **1160.16 MiB**;
- zero console errors;
- zero page errors;
- zero HTTP failures.

iPhone-like WebKit result:
- stream metadata load: `0.834 s`;
- terminal state reached in `13.620 s`;
- descendant-process peak RSS observed: **1807.29 MiB**;
- zero console errors;
- zero page errors;
- zero HTTP failures.

The synthetic sine reference intentionally produces zero usable recognized words, so the expected user-visible outcome is `Couldn't synchronize` with the evidence-backed speech-recognition diagnosis. The test is a file-size / WORKERFS / browser-survival regression, not a speech-accuracy test.

Memory numbers are **process-tree RSS measurements on Linux CI**, not exact tab memory and not physical-iPhone measurements. They are recorded as a baseline for regression comparison; no arbitrary hard RSS cap is claimed yet. In particular, the higher WebKit baseline is a watch item for future physical-device stress validation, not proof of an iOS crash.

## Product direction decided in this session

SubSync2 is **not** intended to be only the old SubSync wrapped in a browser. The product direction is to preserve the useful behavior and language coverage of sc0ty/SubSync, then add meaningful modern capabilities around it.

Already differentiating SubSync2 from the historical version:
- installable browser-first PWA;
- local media processing in the browser without server media upload;
- physical iPhone/Safari operation;
- reproducible/pinned WASM toolchain and browser builds;
- automated MKV, Romanian subtitle, WebKit and full-PWA regressions;
- Romanian alias/encoding/diacritics hardening;
- signed/pinned original-language asset publication;
- controlled HTTPS preview deployment;
- explicit privacy and upstream attribution.

Improvement order agreed:
1. preserve and validate original sc0ty language compatibility;
2. expand realistic MKV reliability coverage: H.264/H.265 container combinations, stereo/5.1, AAC/AC3/E-AC3, multiple tracks, seeking, long files, memory pressure and unusual metadata;
3. improve model/dictionary UX: required asset, download size/progress, locally cached state and cache cleanup;
4. improve diagnostics so failures identify the actual stage (demux, decode, audio, speech model, dictionary, correlation) instead of only generic errors;
5. add genuine Romanian-audio speech recognition near completion rather than pretending another model is Romanian;
6. consider multi-upload/batch only after the single-file path is demonstrably reliable.

Original-language compatibility is now a project guardrail: future work must not silently drop the original pinned speech/dictionary catalog while improving SubSync2.

## Open blockers

- historical real-world MKV failure class is not yet reproduced;
- not every original language/model pair has a dedicated full synchronization E2E, despite the complete signed catalog now being deployed;
- Romanian audio speech recognition remains deferred until the main workflow is near completion.
