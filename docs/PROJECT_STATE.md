# SubSync2 — Project State

LAST_UPDATED: 2026-09-11 Europe/Rome

## Canonical status

This file is the human-readable technical checkpoint for SubSync2.
Repository truth overrides chat memory. Before material changes, read:
1. `docs/PROJECT_STATE.md`
2. `config/project-invariants.json`
3. `AGENTS.md`
4. relevant current implementation

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

## Original historical MKV issue

Historical observation: some direct MKV + SRT files failed while extracted audio + the same SRT succeeded.

The exact historical root cause is still unconfirmed.

Current negative evidence:
- AAC, AC3, E-AC3, multiple audio tracks, and embedded subtitles pass the deterministic browser/WASM matrix;
- generated direct MKV with English audio + Romanian SRT passes end to end.

Do not claim MKV itself is generally broken. Future reproduction should focus on properties absent from current fixtures: channel layouts, codecs, seeking, long duration/file size, browser memory behavior, and unusual container metadata.

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

Next:
16. add a deliberate preview/manual deployment path;
17. test mobile Safari/iPhone;
18. expand realistic MKV coverage;
19. return to Romanian-audio support near completion.

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

Production auto-deploy remains disabled. This URL is the deliberate preview target for physical-iPhone validation.

## Testing status

Completed additionally:
16. WebKit/iPhone-like full primary-flow E2E, including downloaded corrected SRT.

Next:
17. test the public HTTPS preview on a physical iPhone/Safari;
18. expand realistic MKV coverage;
19. return to Romanian-audio support near completion.

## Open blockers

- physical iPhone/Safari behavior is not yet measured;
- historical real-world MKV failure class is not yet reproduced.
