# Radiology Productivity Platform

Radiology Productivity Platform is a local-first productivity tool for radiologists to track studies, CPT work RVUs, daily pace, annual progress, and import workflows without turning the app into a billing system.

## Current Major Features

- Manual study logging with CPT and wRVU tracking.
- PowerScribe clipboard/window capture with OCR screenshot import and review workflow.
- Automatic PowerScribe screenshot preprocessing before OCR, including completed-studies table crop detection with a relative fallback.
- OCR parsing that keeps both Exam Date and Modified Date/Time, using Modified Date/Time as the productivity timestamp.
- OCR cleanup for row numbers, PowerScribe UI text, dates, timestamps, and other non-exam chrome before CPT matching.
- Curated Radiology Exam Dictionary and Orbit CME seed mappings as primary OCR matching references before CMS/fuzzy fallback.
- OCR confidence capture per imported study.
- Learned exam aliases for faster future matching.
- Duplicate detection across manual, OCR, CSV, and PowerScribe capture imports.
- Active review sessions for imported studies before final commit/finalization.
- Multi-profile and multi-location context.
- Daily Pace dashboard, Annual Dashboard, and Mini Pace Window.
- CPT Explorer for professional-component CPT lookup and logging.
- Mobile camera workflow foundation.

## OCR Import Notes

The main OCR workflow is designed around Alt+Print Screen capture of the active PowerScribe window. The app automatically crops the screenshot to the completed-studies table before OCR so the user should not need to manually crop screenshots.

The crop should include the Procedure column, Modified column, and Exam Date column when visible, while excluding navigation, toolbars, filters, buttons, bottom tabs, status bars, and empty margins.

Date handling is intentional:

- Modified Date/Time is the productivity timestamp and determines the wRVU day.
- Exam Date is preserved for duplicate detection and historical reference.
- Duplicate detection prioritizes accession number, normalized exam plus Modified Date/Time, normalized exam plus Exam Date, then fuzzy matching.

The OCR matcher should prefer user-approved aliases, site-specific aliases, curated dictionary entries, and Orbit CME seed mappings before falling back to CMS descriptions or fuzzy matching. CMS data remains the source of truth for CPT validation and modifier 26 wRVU values.

## Project Backlog

`PROJECT_BACKLOG.md` is the master backlog for active product work. Update it whenever a backlog item is completed or newly discovered.

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

Current OCR automation work is being tracked on `feature/ocr-automation`.

## Project Structure

```text
packages/
  web/       Primary React/Vite app, local database, import pipeline, OCR, dashboards
  desktop/   Electron shell for native desktop capabilities
  mobile/    Expo mobile shell and camera workflow foundation
```
