# Runable / Local dev setup for wRVUtracker-7667

This repository is a Turborepo + Bun monorepo. I added a VS Code devcontainer and Tasks so you can open the project in a reproducible environment and run the apps locally.

Quick start (VS Code):

1. Open this repository in VS Code.
2. When prompted, select "Reopen in Container" (or use the command palette: Remote-Containers: Reopen in Container).
3. Wait for the container to build. The devcontainer will attempt to install Bun and run an initial `bun install`.
4. Run the default task: Terminal → Run Task → dev:web (this runs `bun run dev` which in this repo starts the web app under packages/web).

If you prefer to run locally without the devcontainer:

- Install Bun (https://bun.sh).
- From the repo root run: `. ~/.bun/env` to load bun into your shell, then `bun install` and `bun run dev`.

Using Runable AI:

- To enable Runable's AI editing/run features you can install the Runable VS Code extension (or Runable CLI) and open the project in VS Code. See https://runable.ai for details on available integrations.
- I did not add GitHub Actions or a Runable secret by default. If you want a CI workflow that calls Runable, tell me and I can add a workflow file — you'll need to add RUNABLE_API_KEY in repository Settings → Secrets.

Files added by this change:
- .devcontainer/devcontainer.json
- .devcontainer/Dockerfile
- .vscode/settings.json
- .vscode/tasks.json
- README.RUNABLE.md (this file)

If you want I can also:
- Add a GitHub Actions workflow to run tests or call Runable in CI.
- Add a Runable-specific config/manifest if you plan to use their CLI or integration (tell me which Runable product you will use).

