# SubSync2 — Project State

LAST_UPDATED: 2026-09-11 Europe/Rome

## Canonical status

This file is the human-readable technical checkpoint for SubSync2.
Repository truth overrides chat memory. Before material changes, read in this order:

1. `docs/PROJECT_STATE.md`
2. `config/project-invariants.json`
3. `AGENTS.md`
4. the current implementation relevant to the task

## Product goal

Revive and modernize the archived sc0ty/SubSync web application as a browser-first PWA that can synchronize subtitle timing against a media reference while preserving the original synchronization approach where it remains technically sound.

Primary near-term goals:
- make direct MKV + SRT synchronization reliable;
- make Romanian a first-class supported language for subtitles and audio;
- preserve local/browser-first media processing.

Multi-file / batch upload is not a near-term priority.

## Romanian support — project requirement

Romanian is the primary language priority.

Required language identifiers:
- `ro`
- `rum`
- `ron`

Required behavior:
- preserve Romanian UTF-8 diacritics `ă â î ș ț Ă Â Î Ș Ț`;
- support Romanian external and embedded subtitles;
- support Romanian audio speech recognition locally in the browser whenever technically feasible.

Confirmed:
- The legacy language table contains Romanian as `rum` / `ro`.
- The current legacy table does not yet declare `ron` as an alias.
- FFmpeg can surface Matroska language metadata as `ron`; the regression fixture already demonstrates an embedded subtitle stream tagged `ron`.
- Browser/WASM subtitle regression run `34602860832` preserved all required Romanian UTF-8 diacritics and emitted 17 subtitle words with `romanianUtf8: true`.

Open:
- The original sc0ty speech release assets do not include a Romanian PocketSphinx model.
- Romanian audio speech recognition therefore needs a separate compatible backend/model.
- A multilingual local WebAssembly speech backend is being evaluated; no replacement has been adopted yet.

## Repository

- Canonical repository: `Zuzuitu/subsync-web-enhanced`
- Default branch: `main`
- Upstream: `sc0ty/subsync`
- Pinned initial upstream baseline: `c888da7257d57bf039523c9f7015feacb4b95dc3`
- Upstream state: archived / no longer actively maintained since 2024-10-01
- License: GNU GPL v3
- Original author attribution to Michał Szymaniak / sc0ty is mandatory.

The file `UPSTREAM_COMMIT` records the upstream baseline imported into this repository.

## Current architecture — confirmed from source

The imported web application is a hybrid JavaScript + C++/WebAssembly application.

Browser layer:
- JavaScript bundled with Browserify.
- REDOM-based UI.
- Web Workers created through `webworkify`.
- Worker RPC through `comlink`.
- Browser files mounted into Emscripten with `WORKERFS`.
- Downloaded/runtime assets persisted with `IDBFS`.

Native/WASM layer:
- C++14 sources under `gizmo/`.
- Emscripten builds two principal modules:
  - `extractor.js/.wasm`
  - `correlator.js/.wasm`
- FFmpeg n4.2 is the pinned media stack in the legacy web build.
- SphinxBase + PocketSphinx provide the legacy speech-recognition backend.

Reference audio pipeline:
`File -> WORKERFS -> Demux -> AudioDec -> Resampler -> SpeechRecognition -> optional n-gram/translation -> correlator`

Subtitle pipeline:
`File -> WORKERFS -> Demux -> SubtitleDec -> optional n-gram/translation -> correlator`

The synchronizer runs subtitle extraction and one or more reference extractors, sends recognized/reference words and subtitle words to the correlator, then applies the resulting timing formula to the subtitle output.

## Original MKV issue / reproduction status

User-observed historical behavior:
- Direct MKV + SRT processing can fail.
- Extracting audio from the same media first and then using audio + SRT can succeed.

The exact root cause is still NOT confirmed.

Important negative evidence:
- The failure does NOT reproduce on the current deterministic synthetic matrix.
- Therefore do not claim that MKV itself, FFmpeg demux, AAC, AC3, E-AC3, multiple audio tracks, embedded text subtitles, WORKERFS, AudioDec, Resampler, or PocketSphinx is generally broken.

Confirmed browser/WASM coverage:
- `File -> WORKERFS -> Demux -> AudioDec`: PASS.
- `AudioDec -> Resampler -> PocketSphinx`: PASS with the pinned original sc0ty Italian model.
- external SRT -> `SubtitleDec`: PASS.
- Romanian UTF-8 subtitle text: PASS.

Canonical matrix run `34600827268`:
- MKV + AAC 16 kHz: PASS.
- MKV + AC3 48 kHz: PASS.
- MKV + E-AC3 48 kHz: PASS.
- MKV with two audio tracks (ENG AAC + ITA AC3), explicitly selecting ITA: PASS.
- MKV with embedded text subtitle stream tagged `ron`: PASS through media/speech path.
- extracted WAV baseline: PASS.
- external SRT: PASS.

Full speech-pipeline run `34600505290`:
- original sc0ty Italian PocketSphinx asset loaded successfully;
- 12 model files / 12,161,077 bytes;
- model format S16 / 16 kHz;
- both MKV+AAC and extracted WAV completed the full legacy speech pipeline.

The synthetic audio is a deterministic sine signal, so zero recognized words is expected and is not treated as speech-accuracy evidence. These tests prove pipeline execution and failure isolation, not recognition quality.

## Build system status

The legacy WebAssembly engine is reproducible in GitHub Actions without a local laptop.

Confirmed on 2026-09-11:
- Successful baseline workflow run: `34562875819`
- Workflow: `.github/workflows/legacy-web-build.yml`
- Emscripten: `1.39.11-fastcomp`
- Docker image digest: `sha256:7e32f961a0b5280151f7f5e4d8de3e655ac054b5564ee707a81ea1512e8b9911`
- FFmpeg: `n4.2`
- SphinxBase: `4ffc4b79515fd18f7adfbf80c20f3c0ecb9edccd`
- PocketSphinx: `ab6d6471800966990e12fdb6ed27ae36323cf2c4`
- Produced and verified: `extractor.js/.wasm` and `correlator.js/.wasm`
- First successful artifact name: `legacy-wasm`
- First successful artifact archive digest: `sha256:6411d9cb71f62f885e342d0292b723874dd117cd901af9e817bc265326c16816`

Regression fixture inputs are pinned separately in `config/test-fixture-pins.json`.
The original sc0ty Italian speech fixture is verified by SHA-256 before extraction.

Reconstruction notes:
- The original web build files were introduced on 2020-03-29.
- Emscripten 1.39.11 was the latest release before that date and successfully builds the imported baseline.
- SphinxBase and PocketSphinx are pinned to their latest commits on or before 2020-03-29.
- Debian Buster package mirrors are EOL; the historical image is kept intact but its apt sources are redirected to `archive.debian.org`.
- CI caches only the built native dependencies; application C++/WASM output is rebuilt and verified.
- A fast diagnostic workflow can reuse a known-good WASM artifact while iterating on browser-only regression instrumentation.

The old stack remains a compatibility baseline, not a commitment to preserve these dependency versions forever.

## Development workflow

Normal material changes:
`branch -> PR -> CI green -> merge`

Rules:
- No direct material commits to `main`.
- The initial commit `96371770728e930fb1e5709cb4036f394b81e294` was a one-time empty-repository bootstrap exception because no branch/PR could exist before the first commit.
- Do not weaken invariants to make CI pass.
- Do not silently change the synchronization algorithm while fixing container/decoder failures.
- Prefer a minimal reproducible test before a behavioral fix.
- Any upstream refresh must be pinned to an explicit commit and reviewed by PR.

## Testing strategy

Build confidence in layers:

1. Governance/static checks — repository state, invariants, attribution, pinned upstream. **DONE**
2. Legacy web/WASM build reproduction in Linux CI. **DONE**
3. Deterministic browser/WASM media matrix. **DONE for initial matrix**
4. Extractor execution through demux/decode/resample/legacy speech. **DONE for initial matrix**
5. Romanian subtitle UTF-8 regression. **DONE**
6. Romanian language-code canonicalization (`ro/rum/ron`). **NEXT**
7. Romanian local speech-recognition PoC and browser performance measurement. **NEXT**
8. End-to-end synchronization tests with spoken-language fixtures and known expected timing correction.
9. Browser/device tests, including mobile Safari.

Media fixtures must be small and legally redistributable or generated deterministically.

## Romanian speech direction

The legacy PocketSphinx backend is retained as the compatibility baseline for languages where its original model assets exist.

For Romanian audio:
- do not fake support by mapping Romanian to another language model;
- do not upload user media to a server as a shortcut;
- evaluate a multilingual browser-local speech backend with usable timing output;
- preserve the existing downstream word/correlator semantics where practical;
- pin any imported engine/model version and license before adoption;
- benchmark memory and speed before declaring iPhone support.

## Deployment

No production deployment is configured yet.

Until explicitly changed:
- production deployment must be manual / deliberate;
- CI must not auto-deploy production;
- preview deployments may be added later through a reviewed PR.

## Privacy and data handling

The intended product is browser-first. Media and subtitle processing should stay local in the browser whenever technically feasible.
Do not introduce server-side upload of user media as a shortcut without an explicit architectural decision recorded here and in the invariants.

## Cost constraints

Prefer GitHub Actions and free/low-cost infrastructure. Do not introduce paid services or consumption-based APIs without explicit approval.

## Immediate next milestones

Completed:
1. Establish repository governance and baseline CI.
2. Reproduce the legacy web/WASM build in GitHub Actions.
3. Capture successful legacy build artifacts.
4. Build deterministic MKV/SRT browser regression harness.
5. Validate initial MKV codec/track matrix through full legacy speech pipeline.
6. Validate Romanian UTF-8 subtitle decoding.

Next:
7. Merge regression harness after PR CI is green.
8. Canonicalize Romanian metadata aliases `ro/rum/ron`.
9. Build a Romanian local-speech PoC behind the existing word-output boundary.
10. Add real spoken Romanian fixtures and end-to-end timing/correlation regression.
11. Continue isolating the historical real-world MKV failure with more realistic channel layouts, codecs, file sizes/seeking, browser/device behavior, or a legal minimal reproduction derived from an affected file.

## Open blockers

- The historical direct-MKV failure has not been reproduced by the synthetic matrix.
- Romanian audio has no original sc0ty PocketSphinx model.
- Mobile Safari performance/memory for a Romanian-capable local speech backend is not yet measured.
