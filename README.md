# SubSync2

A maintained modernization of the archived **SubSync / Subtitle Speech Synchronizer** created by **Michał Szymaniak (sc0ty)**.

SubSync2 is focused first on making the browser workflow reliable again — especially direct **MKV + SRT** synchronization — and then modernizing the web experience into a robust PWA without discarding proven synchronization logic unnecessarily.

## Status

Foundation / reproducibility phase.

The first technical objective is not a UI rewrite. It is to reproduce the legacy C++/FFmpeg/PocketSphinx/Emscripten web build in cloud CI and create a deterministic regression test for the direct-MKV failure.

See:
- `docs/PROJECT_STATE.md` — canonical human-readable checkpoint
- `config/project-invariants.json` — machine-readable project rules
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
