# Radiology Productivity Platform

Radiology Productivity Platform is a local-first productivity tool for radiologists to track studies, CPT work RVUs, daily pace, annual progress, and import workflows without turning the app into a billing system.

## Current Major Features

- Manual study logging with CPT and wRVU tracking.
- OCR screenshot import and review workflow.
- Screenshot watcher support through the desktop shell.
- Learned exam aliases for faster future matching.
- Duplicate detection across manual, OCR, CSV, and watcher-style imports.
- Date/time extraction for imported studies.
- Multi-profile and multi-location context.
- Daily Pace dashboard, Annual Dashboard, and Mini Pace Window.
- CPT Explorer for professional-component CPT lookup and logging.
- Mobile camera workflow foundation.

## Tech Stack

- Bun workspaces and Turborepo.
- React 19, Vite, Wouter, Tailwind CSS, and Dexie/IndexedDB in `packages/web`.
- Hono API surface and Drizzle/Turso scaffolding in the web package.
- Electron shell in `packages/desktop`.
- Expo/React Native mobile shell in `packages/mobile`.

## Local Setup

Install Bun, then run commands from the repository root.

```sh
bun install
bun run dev
```

The default dev command starts the web app from `packages/web`. Environment variables live in `.env` at the repository root; use `.env.template` as the starting point.

## Dev Commands

```sh
bun install
bun run dev
bun run typecheck
bun run build
```

Other useful commands:

```sh
bun run dev:desktop
bun run dev:mobile
bun run lint
```

## Deployment

The web app is intended to deploy from the repository root using the root package scripts. For Vercel, configure the project to install with Bun and run `bun run build`; the web package build output is produced by the Turborepo build task.

## Branch Workflow

- `main` is production.
- `development` is integration/staging.
- `feature/*` branches are active work.
- Create feature branches from latest `development`.
- Open pull requests into `development`.
- Merge `development` into `main` only after validation.

## Project Structure

```text
packages/
  web/       Primary React/Vite app, local database, import pipeline, OCR, dashboards
  desktop/   Electron shell for native desktop capabilities
  mobile/    Expo mobile shell and camera workflow foundation
```
