# SubSync2

A maintained modernization of the archived **SubSync / Subtitle Speech Synchronizer** created by **Michał Szymaniak (sc0ty)**.

SubSync2 is focused first on making the browser workflow reliable again — especially direct **MKV + SRT** synchronization — and then modernizing the web experience into a robust PWA without discarding proven synchronization logic unnecessarily.

## Status

SubSync2 has a reproducible browser/PWA build with the original sc0ty
PocketSphinx language catalog preserved, deterministic MKV regressions, and
local Romanian speech recognition through an isolated single-thread
`whisper.cpp` WebAssembly SIMD module.

The primary **English audio + Romanian subtitles** workflow and the genuine
**Romanian audio + Romanian subtitles** workflow are both exercised end to end
in cloud CI. The Romanian path keeps media processing local in the browser and
does not require shared WebAssembly memory or a media-upload backend.

See:
- `docs/PROJECT_STATE.md` — canonical human-readable checkpoint
- `config/project-invariants.json` — machine-readable project rules
- `config/legacy-build-pins.json` — reproducible legacy toolchain/dependency pins
- `AGENTS.md` — contribution / coding-agent rules
- `UPSTREAM_COMMIT` — pinned upstream baseline
- `THIRD_PARTY_NOTICES.md` — notices for the Romanian Whisper path

## Workflow

Material changes follow:

`branch -> PR -> CI green -> merge`

Repository truth overrides chat memory.

## Upstream credit

SubSync2 is derived from [sc0ty/SubSync](https://github.com/sc0ty/subsync), originally developed by Michał Szymaniak.

Initial imported upstream baseline:

`c888da7257d57bf039523c9f7015feacb4b95dc3`

The upstream project was archived in October 2024. SubSync2 is an independent continuation/modernization and must not be presented as an official release by sc0ty.

## License

GNU General Public License v3. See `LICENSE`.

Derived code remains under the applicable GPL terms and upstream attribution must be preserved.
