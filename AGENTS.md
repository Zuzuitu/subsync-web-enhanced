# AGENTS.md — SubSync2

These rules apply to humans and coding agents working in this repository.

## Mandatory read order

Before any material change, read:
1. `docs/PROJECT_STATE.md`
2. `config/project-invariants.json`
3. `AGENTS.md`
4. the current implementation relevant to the task

If chat context conflicts with the repository, repository truth wins.

## Change discipline

- Use branch -> PR -> CI green -> merge for material changes.
- Do not commit material changes directly to `main`.
- Do not weaken, delete, bypass, or reinterpret an invariant to make a task pass.
- Keep diffs focused. Separate infrastructure modernization from behavior changes where practical.
- Update `docs/PROJECT_STATE.md` when a change materially alters architecture, known state, deployment, build procedure, or a resolved blocker.
- Update `config/project-invariants.json` only when an actual project rule changes, not to accommodate an implementation.

## Evidence rules

- Never invent test results, browser behavior, codec support, build success, or root cause.
- A user observation is evidence of behavior, not proof of root cause.
- Label hypotheses as hypotheses until reproduced.
- For the MKV bug, determine the failing stage before changing unrelated synchronization logic.

## Upstream and license

- This project is derived from `sc0ty/subsync` and remains subject to GNU GPL v3.
- Preserve the upstream LICENSE.
- Preserve visible credit to Michał Szymaniak / sc0ty.
- Any upstream refresh must name and pin the exact commit SHA.
- Do not import code with incompatible licensing.

## Architecture guardrails

- Browser-first/local processing is the default.
- Do not add a backend upload path for media files as a convenience workaround.
- Do not replace the synchronization algorithm merely to solve a container/decoder bug without a separately reviewed architectural decision.
- Do not add a paid API/service without explicit approval.
- Multi-upload is not a priority until the single-file synchronization path is reliable.

## Testing

For bug fixes:
1. reproduce;
2. isolate;
3. add or define regression coverage;
4. implement the smallest justified fix;
5. run relevant checks;
6. record confirmed outcome.

Media fixtures must be small and legally redistributable.

## Deployment

Production deployment is not configured yet.
When introduced, it must remain manual/deliberate unless the invariant is explicitly changed.
Do not introduce automatic production deployment through an unrelated PR.
