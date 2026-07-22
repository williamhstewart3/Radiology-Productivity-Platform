# wRVU Tracker Vision

## Product North Star

wRVU Tracker is a local-first productivity companion for radiologists. It should quietly run beside the radiologist throughout the day, keep productivity current, and ask for attention only when confidence is low or review is genuinely needed.

The ideal experience is nearly invisible: the radiologist reads studies, the app notices completed work, productivity updates automatically, and a small HUD confirms that tracking is current. The less the user has to operate the application, the better.

The full dashboard is not the primary workspace during the workday. The dashboard HUD is the primary interface. The full app exists to answer occasional questions such as:

- Am I on pace today?
- What changed since the last sync?
- Have I read a lot of PETs, MRI, or procedures today?
- Am I slowing down compared with earlier today or yesterday?
- Why is productivity different today?

## Core Principles

- Local-first by default. Study data, screenshots, OCR, aliases, and logs should stay on-device unless the user explicitly enables a future sync feature.
- One import pipeline. Manual entry, paste/CSV, PowerScribe clipboard/window capture, OCR screenshots, camera capture, and future PowerScribe API sync should all produce `ImportedStudy[]` and flow through the same normalization, matching, duplicate detection, review, commit, and alias-learning path.
- Physician work RVU only. Matching should exclude technical-only rows and prefer professional-component rows when available.
- Automation over interaction. High-confidence capture, OCR, matching, duplicate detection, and productivity updates should happen without user management.
- Passive awareness over active management. Use the HUD, subtle state changes, and brief toasts to confirm progress instead of requiring navigation.
- Review uncertainty, automate confidence. High-confidence learned mappings should disappear into the background; low-confidence OCR/matching/duplicate cases should be visible and easy to correct.
- Profiles and locations matter. Aliases, logs, goals, and dashboards should respect the active radiologist/location context while preserving a migration path for legacy unscoped rows.
- Privacy is a feature. Camera and PowerScribe capture workflows must keep PHI warnings clear, avoid external transmission, and minimize retained screenshots.

## Architecture Direction

The current app is a Bun/Turbo monorepo:

- `packages/web`: primary React/Vite app, Dexie local database, import pipeline, OCR, matching, dashboards.
- `packages/desktop`: Electron shell for native desktop capabilities.
- `packages/mobile`: Expo shell for future mobile surfaces.

The durable data model is currently Dexie/IndexedDB. The Hono API and Drizzle schema are intentionally minimal and should not become a second source of truth until cloud sync is deliberately designed.

## Matching Direction

CPT matching should continue to combine:

- Direct CPT lookup.
- Profile-scoped learned aliases.
- Fuzzy alias matching.
- Radiology-aware scoring using modality, anatomy, contrast, and normalized text.

The matcher should become more explainable over time: when it suggests a CPT, the UI should make clear whether the confidence came from a learned alias, direct CPT, protocol normalization, or fuzzy CMS description match.

## OCR and PowerScribe Capture Direction

OCR should remain provider-based. Tesseract.js is the default local provider; a future higher-accuracy provider can be added behind the same interface only if privacy and deployment constraints are explicit.

Folder watching has been superseded by PowerScribe clipboard/window capture. The current primary intake path is:

- Capture or paste an active PowerScribe window grab.
- Automatically crop to the completed-studies table before OCR.
- OCR locally.
- Parse procedure, exam date, modified/read date, and visible row metadata.
- Route all rows through the shared review, duplicate detection, matching, and commit pipeline.

The intended future intake path is more automatic:

- Monitor the PowerScribe worklist at short intervals.
- Detect completed-study changes automatically.
- Capture/OCR/import automatically.
- Update the HUD automatically.
- Show a brief toast confirming synchronization.
- Interrupt the user only for low-confidence rows, possible duplicates, or unresolved matches.

No capture output should be stranded in transient component state.

## Near-Term Priorities

1. Make the HUD the workday-first interface for current wRVUs, exams, pace, last sync, and review status.
2. Move PowerScribe capture toward automatic short-interval sync with quiet toast confirmation.
3. Keep review focused on exceptions: low confidence, possible duplicates, and unresolved matches.
4. Consolidate top-level navigation around workflows rather than feature pages.
5. Persist PowerScribe capture review batches in IndexedDB instead of session storage.
6. Finish consolidating manual entry onto the shared import pipeline.
7. Reduce the existing lint/a11y backlog so lint can become a reliable CI gate.

## Non-Goals

- Do not treat the app as an official billing/coding source.
- Do not turn the workday experience into a feature-heavy dashboard the radiologist has to manage.
- Do not silently change historical work RVU snapshots when CPT tables update.
- Do not introduce cloud sync, authentication, or PowerScribe live API integration without a separate privacy/security design.
- Do not let provider-specific logic leak into the shared matching/commit path.

## Success Criteria

The app succeeds when a radiologist can trust it during a busy shift:

- Routine tracking requires little or no interaction.
- The HUD stays current enough to trust at a glance.
- Automatic sync confirmation is brief and non-disruptive.
- Importing or reviewing exceptions takes seconds, not minutes.
- Duplicate protection catches real repeats without hiding legitimate work.
- Learned mappings improve future imports.
- Daily pace is clear without requiring the full app to be open.
- Annual progress is accurate enough for planning.
- The privacy model is understandable at a glance.
