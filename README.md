# SubSync2

A maintained modernization of the archived **SubSync / Subtitle Speech Synchronizer** created by **Michał Szymaniak (sc0ty)**.

SubSync2 is focused first on making the browser workflow reliable again — especially direct **MKV + SRT** synchronization — and then modernizing the web experience into a robust PWA without discarding proven synchronization logic unnecessarily.

## Status

Legacy C++/FFmpeg/PocketSphinx/Emscripten WebAssembly build reproduced successfully in GitHub Actions.

Current phase: deterministic **MKV + SRT regression reproduction**. The engine can now be built and verified entirely in cloud CI; local laptop compilation is not required for normal development.

See:
- `docs/PROJECT_STATE.md` — canonical human-readable checkpoint
- `config/project-invariants.json` — machine-readable project rules
- `config/legacy-build-pins.json` — reproducible legacy toolchain/dependency pins
- `AGENTS.md` — contribution / coding-agent rules
- `UPSTREAM_COMMIT` — pinned upstream baseline

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
