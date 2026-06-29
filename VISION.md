# wRVU Tracker Vision

## Product North Star

wRVU Tracker is a local-first productivity companion for radiologists. It should make daily and annual wRVU tracking fast, accurate, and low-friction without becoming a billing system, compliance system, or hospital integration project too early.

The ideal experience is simple: a radiologist finishes studies, imports or captures the list, reviews anything uncertain, and immediately sees trustworthy daily pace and year-to-date progress.

## Core Principles

- Local-first by default. Study data, screenshots, OCR, aliases, and logs should stay on-device unless the user explicitly enables a future sync feature.
- One import pipeline. Manual entry, paste/CSV, OCR screenshots, camera capture, folder watcher, and future PowerScribe API sync should all produce `ImportedStudy[]` and flow through the same normalization, matching, duplicate detection, review, commit, and alias-learning path.
- Physician work RVU only. Matching should exclude technical-only rows and prefer professional-component rows when available.
- Review uncertainty, automate confidence. High-confidence learned mappings should disappear into the background; low-confidence OCR/matching/duplicate cases should be visible and easy to correct.
- Profiles and locations matter. Aliases, logs, goals, and dashboards should respect the active radiologist/location context while preserving a migration path for legacy unscoped rows.
- Privacy is a feature. Camera and watcher workflows must keep PHI warnings clear, avoid external transmission, and minimize retained screenshots.

## Architecture Direction

The current app is a Bun/Turbo monorepo:

- `packages/web`: primary React/Vite app, Dexie local database, import pipeline, OCR, matching, dashboards.
- `packages/desktop`: Electron shell for native filesystem access and folder watching.
- `packages/mobile`: Expo shell for future mobile surfaces.

The durable data model is currently Dexie/IndexedDB. The Hono API and Drizzle schema are intentionally minimal and should not become a second source of truth until cloud sync is deliberately designed.

## Matching Direction

CPT matching should continue to combine:

- Direct CPT lookup.
- Profile-scoped learned aliases.
- Fuzzy alias matching.
- Radiology-aware scoring using modality, anatomy, contrast, and normalized text.

The matcher should become more explainable over time: when it suggests a CPT, the UI should make clear whether the confidence came from a learned alias, direct CPT, protocol normalization, or fuzzy CMS description match.

## OCR and Watcher Direction

OCR should remain provider-based. Tesseract.js is the default local provider; a future higher-accuracy provider can be added behind the same interface only if privacy and deployment constraints are explicit.

The watcher should be a calm background assistant:

- Detect screenshot files.
- OCR locally.
- Auto-commit only safe/high-confidence rows.
- Persist anything requiring review.
- Route processed/failed files predictably.

No watcher output should be stranded in transient component state.

## Near-Term Priorities

1. Finish consolidating manual entry onto the shared import pipeline.
2. Persist watcher review batches in IndexedDB instead of session storage.
3. Complete multi-CPT alias support from matching through commit and history display.
4. Reduce the existing lint/a11y backlog so lint can become a reliable CI gate.
5. Add focused tests for date parsing, duplicate detection, alias scoping, and CSV parsing.
6. Clarify legacy `profileId: null` behavior and provide a migration or explicit shared-default policy.

## Non-Goals

- Do not treat the app as an official billing/coding source.
- Do not silently change historical work RVU snapshots when CPT tables update.
- Do not introduce cloud sync, authentication, or PowerScribe live API integration without a separate privacy/security design.
- Do not let provider-specific logic leak into the shared matching/commit path.

## Success Criteria

The app succeeds when a radiologist can trust it during a busy shift:

- Importing studies takes seconds, not minutes.
- Duplicate protection catches real repeats without hiding legitimate work.
- Learned mappings improve future imports.
- Daily pace is clear enough to guide behavior.
- Annual progress is accurate enough for planning.
- The privacy model is understandable at a glance.
