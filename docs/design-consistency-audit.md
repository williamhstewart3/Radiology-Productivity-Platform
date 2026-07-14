# Theme and UI consistency audit

Updated: 2026-07-13

The semantic token layer and shared surface/control adapters apply to every route. The active shell and History workflow were manually migrated to the new primitives in this pass. The visual suite covers both themes with reduced motion and fixed locale/timezone settings.

| Screen | Light | Dark | Desktop | Mobile | Focus | States / exceptions |
| --- | --- | --- | --- | --- | --- | --- |
| Dashboard / Today | Covered | Covered | Covered | Covered | Global ring | Existing empty/loading states |
| Daily Pace | Covered via Today | Covered via Today | Covered | Covered | Global ring | Embedded in Today |
| Inbox | Covered | Covered | Covered | Shell coverage | Global ring | Empty queue covered |
| Import / Capture | Covered | Covered | Covered | Covered | Global ring | Picker/duplicate baselines require fixture expansion |
| History | Covered | Covered | Covered | Covered | Global ring | Migrated to dense day-group rows |
| Automation | Token audit | Token audit | Manual | Manual | Global ring | Secondary Settings route; screenshot pending |
| CPT Explorer | Covered | Covered | Covered | Shell coverage | Global ring | Search-empty baseline covered |
| Watcher | Token audit | Token audit | Manual | N/A | Global ring | Embedded Automation state |
| Profiles | Token audit | Token audit | Manual | Manual | Global ring | Secondary Settings route; screenshot pending |
| Locations | Token audit | Token audit | Manual | Manual | Global ring | Secondary Settings route; screenshot pending |
| Settings | Covered | Covered | Covered | Shell coverage | Global ring | Inputs and segmented controls covered |
| Mini window | Covered | Covered | Covered | N/A | Global ring | Floating-surface blur remains intentional |
| Mobile camera | Token audit | Token audit | N/A | Capture covered | Global ring | Native camera permission state remains manual |
| Modals / pickers | Covered by shell baseline | Covered by shell baseline | Covered | Manual | Global ring | Interactive fixture expansion pending |
| Receipts / recent batches | Route covered | Route covered | Covered | Manual | Global ring | Populated receipt fixtures pending |

## Remaining exceptions

- `CameraUploadPage.tsx` contains intentional black image-crop masks and white text over captured imagery. Those are media overlays, not application surfaces.
- Older secondary routes still contain raw translucent utility colors. The compatibility adapters now make their standard cards, tables, inputs, and text theme-safe; they should be migrated component-by-component when those workflows are next edited.
- The visual suite now uses a development-only deterministic IndexedDB fixture with 18 studies, review and import states, and a compact CPT reference set. Interactive duplicate confirmation and populated receipt variants remain candidates for a second fixture scenario.
