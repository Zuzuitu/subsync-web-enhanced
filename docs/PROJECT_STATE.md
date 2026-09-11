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

Primary near-term goal: make the online workflow reliable for MKV + SRT, especially the known user-reported case where direct MKV processing fails while extracted audio + SRT succeeds.

Multi-file / batch upload is not a near-term priority.

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
- SphinxBase + PocketSphinx provide speech recognition.

Reference audio pipeline:
`File -> WORKERFS -> Demux -> AudioDec -> Resampler -> SpeechRecognition -> optional n-gram/translation -> correlator`

Subtitle pipeline:
`File -> WORKERFS -> Demux -> SubtitleDec -> optional n-gram/translation -> correlator`

The synchronizer runs subtitle extraction and one or more reference extractors, sends recognized/reference words and subtitle words to the correlator, then applies the resulting timing formula to the subtitle output.

## Known issue / reproduction target

User-observed behavior from the previous project session:
- Direct MKV + SRT processing can fail.
- Extracting audio from the same media first and then using audio + SRT can succeed.

This observation strongly narrows the investigation to the media demux / audio decode / browser-WASM path, but the exact root cause is NOT yet confirmed.

Do not state that FFmpeg, MKV parsing, codec support, memory, Safari, or any specific decoder is the cause until a reproducible fixture or trace proves it.

## Build system status

The legacy WebAssembly engine is now reproducible in GitHub Actions without a local laptop.

Confirmed on 2026-09-11:
- Successful workflow run: `34562875819`
- Workflow: `.github/workflows/legacy-web-build.yml`
- Emscripten: `1.39.11-fastcomp`
- Docker image digest: `sha256:7e32f961a0b5280151f7f5e4d8de3e655ac054b5564ee707a81ea1512e8b9911`
- FFmpeg: `n4.2`
- SphinxBase: `4ffc4b79515fd18f7adfbf80c20f3c0ecb9edccd`
- PocketSphinx: `ab6d6471800966990e12fdb6ed27ae36323cf2c4`
- Produced and verified: `extractor.js/.wasm` and `correlator.js/.wasm`
- First successful artifact name: `legacy-wasm`
- First successful artifact archive digest: `sha256:6411d9cb71f62f885e342d0292b723874dd117cd901af9e817bc265326c16816`

Reconstruction notes:
- The original web build files were introduced on 2020-03-29.
- Emscripten 1.39.11 was the latest release before that date and successfully builds the imported baseline.
- SphinxBase and PocketSphinx are pinned to their latest commits on or before 2020-03-29.
- Debian Buster package mirrors are EOL; the historical image is kept intact but its apt sources are redirected to `archive.debian.org`.
- All reproducibility pins are centralized in `config/legacy-build-pins.json`.
- CI caches only the built native dependencies; application C++/WASM output is rebuilt and verified.

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
3. Small deterministic media fixtures covering container/codec combinations. **NEXT**
4. Extractor tests: stream discovery, open, decode/resample progress, errors.
5. End-to-end synchronization tests with known expected timing correction.
6. Browser tests, including mobile Safari after the engine is reproducible in CI.

Target fixture matrix for the MKV issue, introduced incrementally:
- MKV + AAC
- MKV + AC3
- MKV + E-AC3
- MKV + multiple audio tracks
- MKV + embedded subtitles

Fixtures must be legally redistributable, tiny, and generated or sourced with explicit licensing.

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
3. Capture the first successful build artifacts.

Next:
4. Add a minimal generated MKV fixture and reproduce direct-MKV behavior.
5. Locate the failing stage: mount, probe/demux, stream selection, decode, resample, speech recognition, or orchestration.
6. Fix the smallest proven root cause.
7. Add regression coverage before modernizing UI/PWA behavior.

## Open blockers

- The direct-MKV failure has not yet been reproduced in an automated test.
- Browser/version-specific behavior is not yet characterized.
