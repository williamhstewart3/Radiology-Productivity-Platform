# AGENTS.md

Instructions for Codex and other AI coding agents working in this repository.

## Before Coding

- Read `README.md`, `ROADMAP.md` if present, and this `AGENTS.md`.
- Confirm the current branch and working tree state.
- Work from feature branches. Never work directly on `main`.
- Pull latest `development` before creating a new feature branch.

## Working Style

- Prefer small, scoped changes.
- Explain the plan before editing.
- List files you intend to modify before editing.
- Preserve existing behavior unless a requested change explicitly says otherwise.
- Do not change database schema, migrations, or persistent data contracts without explicit approval.
- Do not add dependencies without explaining why they are needed and why existing tools are insufficient.
- Keep app behavior, privacy assumptions, and local-first data flow intact unless explicitly asked.

## Validation

- Run `bun run typecheck` before finishing.
- Run `bun run build` before finishing.
- Report any warnings or failures clearly.

## Git Safety

- Do not commit, push, merge, or retarget branches without explicit approval.
- Do not commit or merge to `main` without explicit approval.
- Do not force push unless explicitly approved for a specific branch and reason.
- Do not overwrite user changes. If the working tree is dirty before you start, stop and summarize it.
