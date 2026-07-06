# OCR Pipeline Hardening: Calibrated Crops + Space-Insensitive Matching + Tesseract Tuning

All paths relative to `packages/web/` unless noted.

## Context

The Alt+PrintScreen → PowerScribe OCR flow already crops the screenshot into three column images before OCR (`src/web/utils/imageCrop.ts`), but two failure modes still dirty the matching input:

1. **Gutter leakage** — the heuristic table/column detection (projection analysis with hardcoded ratio fallbacks) includes the row-number/checkmark gutter in the procedure column, producing reads like `v10 CTCHEST WCONTRAST`. The source window is always laid out the same, so heuristics add fragility with no benefit.
2. **Merged tokens** — Tesseract drops spaces in the tight table font (`CTCHEST`, `WCONTRAST`), and the token-level Jaccard component of `combinedSimilarity()` breaks on merged tokens, so the matcher suggests wrong exams.

Key discoveries that shape the plan:
- **Half the calibration plumbing exists**: `UserSettings.savedPowerScribeCropRegions` (src/web/types/index.ts:375) is already read in `processOcrImport()` (src/web/services/ocrWorkflowService.ts:108) and used as the table rect — but **no UI ever writes it**, and there are no column rects.
- **A drag/resize crop UI already exists**: `CropTool` in src/web/pages/CameraUploadPage.tsx (~lines 107–345), file-local, 0–1 relative coords with corner handles. Extract and reuse, don't rewrite.
- **Concurrency gotcha**: `OCRImportProvider.importStudies()` OCRs the three columns via `Promise.all` (src/web/providers/OCRImportProvider.ts:159) against a single module-level Tesseract worker. `setParameters` is worker-global, so per-column params require serializing column OCR.

**Order: B → C → A** (matching fix and Tesseract tuning are small and independently testable; calibration UI builds on the crop plumbing last).

## Workstream B — Space-insensitive matching

### B1. `src/web/utils/textMatching.ts`
- Add exported `spacelessKey(raw: string): string` = `normalizeExamText(raw).replace(/\s+/g, '')`.
- In `combinedSimilarity()` (~line 253): compute `spacelessScore = stringSimilarity(normA without spaces, normB without spaces)`; `baseScore = Math.max(tokenScore * 0.8 + stringScore * 0.2, spacelessScore * 0.95)`.
- **Mandatory**: extend `contrastConsistencyPenalty` (~line 237) with a spaceless contrast signature — detect `without|wo(?=contrast)` vs `w(?:ith)?(?=contrast)` on the spaceless strings and apply the existing 0.3 multiplier on contradiction. Without this, spaceless edit distance scores `ctchestwcontrast` vs `ctchestwithoutcontrast` ~0.8 and matches the wrong contrast status.

### B2. `src/web/utils/matching.ts` — spaceless exact keys, preserving stage priority
- `aliasNormalizedKeys()` (~line 545): append spaceless variants of each key.
- `findMatchCandidates()` (~line 590): add spaceless variants of `normalizedInput`, `radiologyNormalizedKey`, `radiologyDescriptionKey` to `exactKeys` — spaceless equality stays inside the existing stage-1 exact check; priority ordering untouched.
- `candidatesForDictionary()` (~line 295): also compare spaceless `normalizeRadiologyDescription(name)` against the spaceless input key (on-the-fly; ~100 entries — no schema change, no precomputation).
- `candidatesForOcrLearning()` (~line 323): keep the indexed `normalizedOcrText` query as fast path; on miss, fall back to `toArray()` + spaceless comparison.
- `src/web/data/orbitCmeSeedMappings.ts` `findOrbitCmeSeedMapping()` (~line 85): lazily build a module-level `Map<spacelessKey, mapping>` (~200 entries), checked when the spaced key misses.

### B3. Tests
- New `tests/textMatching.test.ts`:
  - `combinedSimilarity('CTCHEST WCONTRAST', 'CT CHEST W CONTRAST')` ≥ 0.85
  - `combinedSimilarity('CTCHEST WCONTRAST', 'CT CHEST WO CONTRAST')` below the 0.5 alias-fuzzy threshold (contrast penalty)
  - `spacelessKey('CT CHEST W CONTRAST') === spacelessKey('CTCHEST WCONTRAST')`
- Extend `tests/matching.test.ts`: `__testParseModalityFirst('v10 CTCHEST WCONTRAST')` → cleaned procedure starts with `CT CHEST`.

## Workstream C — Tesseract tuning (structured PowerScribe path only)

### C1. `src/web/utils/ocrProvider.ts`
- Import `PSM` from `tesseract.js` (v7 typings confirm `SINGLE_BLOCK = '6'`, `AUTO = '3'`; params go through `worker.setParameters`, NOT recognize options).
- `extractText(image, params?: { pageSegMode?: PSM; charWhitelist?: string })`.
- In `TesseractProvider.extractText()` (~line 45): before `recognize`, always `setParameters` with explicit values (`pageSegMode ?? PSM.AUTO`, `charWhitelist ?? ''`), tracked against a module-level `lastAppliedParams` to skip redundant calls. Explicit reset protects the generic whole-image path from parameter leakage on the shared persistent worker.
- Update `VisionApiProvider` signature to match (params ignored).

### C2. `src/web/providers/OCRImportProvider.ts`
- Replace the `Promise.all` column map (line 159) with a sequential `for...of` loop — required because `setParameters` is worker-global.
- Per-column params:
  - `procedure`: `PSM.SINGLE_BLOCK`, whitelist `'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 /&-.'`
  - `examDate` / `modifiedDate`: `PSM.SINGLE_BLOCK`, whitelist `'0123456789/: APM'`
- Whole-image fallback path passes no params → resets to defaults; CameraUploadPage's cropped-photo path is unaffected.
- Keep PSM and whitelist as independent knobs — LSTM whitelisting occasionally hurts accuracy and may need to be backed out alone.

### C3. Verification (manual — no unit seam without a real worker)
- Run app, paste a real capture, check `OcrDebugPanel` (src/web/pages/Import.tsx:133) column text: spaces restored, no `v10` prefixes, dates intact, row counts unchanged (PSM change can alter line segmentation feeding `reassembleColumnRows()` ±22px matching).

## Workstream A — One-time crop calibration

### A1. Data model — `src/web/types/index.ts` + `src/web/db/database.ts`
- New `PowerScribeOcrCalibration` type: `{ table: RelativeCropRect; columns: Record<PowerScribeColumnName, RelativeCropRect>; sourceWidth; sourceHeight; createdAt }`. Column rects stored **full-image relative** (bypasses `childRect()` math).
- `UserSettings.powerScribeOcrCalibrations: Record<string, PowerScribeOcrCalibration>`, keyed `"${w}x${h}"`.
- Dexie **v18**: copy the v17 stores block verbatim (all 14 tables — omitting one deletes it), `.upgrade()` backfills `{}`; add default in `ensureUserSettings()` (database.ts:~378).

### A2. Consume calibration
- `src/web/utils/imageCrop.ts`: add `'calibrated'` to `DetectedCrop.method` union. `preprocessPowerScribeColumnsForOcr()` takes optional calibrated column rects — when present, skip `detectPowerScribeColumnLayoutFromBitmap()`; run rects through `normalizeCrop` only, **not** `boundToStudyListArea` (its x≥0.18/y≥0.2 clamps would corrupt user rects).
- New exported pure helper `resolveOcrCalibration(calibrations, width, height)`: exact `WxH` key first, else aspect-ratio match within ~1%, else null → existing auto-detect. This is both the invalidation policy and the unit-test seam.
- `processOcrImport()` (ocrWorkflowService.ts:~102): load calibrations, pass through new `OCRImportOptions.calibrations`; resolved inside `preprocessPowerScribeColumnsForOcr` once bitmap size is known. Fallback chain: calibration → `savedPowerScribeCropRegions.default` → auto-detect → hardcoded default.
- `OcrDebugPanel` already prints `debug.crop.method`, so `'calibrated'` is visible for free.

### A3. UI
- Extract `CropTool` from CameraUploadPage.tsx into `src/web/components/CropTool.tsx` (mechanical move; add optional `initialRect`/`label` props; CameraUploadPage re-imports — no behavior change).
- New `src/web/components/OcrCalibrationModal.tsx`: 4-step wizard over the pasted screenshot (table → procedure → examDate → modifiedDate), each step one `CropTool` pre-filled from auto-detect/fallback rects; on save, write `powerScribeOcrCalibrations["WxH"]` via `db.userSettings.put`.
- Hook: "Calibrate crop" button in the Import.tsx OCR upload zone (~lines 1633–1725), enabled when a file exists; after save, offer re-run via `processOcrFile()` (~line 622).
- Settings.tsx OCR section (near `requireCropBeforeOcr`, ~line 652): calibration status + "Clear calibration".

### A4. Tests
- Extend `tests/imageCrop.test.ts`: `resolveOcrCalibration` exact hit / aspect-ratio hit / mismatch→null; calibrated rects bypass detection via the pure seams (canvas-dependent paths stay manual).

## Verification

1. `bun test` in packages/web — all existing tests plus the new B3/A4 cases.
2. Manual end-to-end: `bun run dev`, paste a real PowerScribe Alt+PrintScreen capture → debug panel shows `Crop: calibrated`, column text has spaces and no `v10` prefixes, `CT CHEST W CONTRAST` matches the right CPT without review. Re-paste at a different window size → graceful fallback to `detected`/`fallback` (worst case = today's behavior).

## Risks

- Worker-global `setParameters` + shared worker → column OCR must be sequential with explicit param reset (C1/C2).
- Whitelist can degrade LSTM accuracy → keep removable independently of PSM.
- PSM change may alter line segmentation → verify row reassembly counts on a real capture.
- Spaceless similarity erases with/without-contrast distinction → B1 penalty is mandatory, with an explicit test.
- Dexie v18 must repeat all 14 tables; omission silently drops a table.

## Critical files

- `packages/web/src/web/utils/textMatching.ts`
- `packages/web/src/web/utils/matching.ts`
- `packages/web/src/web/utils/ocrProvider.ts`
- `packages/web/src/web/providers/OCRImportProvider.ts`
- `packages/web/src/web/utils/imageCrop.ts`
- `packages/web/src/web/db/database.ts`, `packages/web/src/web/types/index.ts`
- `packages/web/src/web/services/ocrWorkflowService.ts`
- `packages/web/src/web/pages/CameraUploadPage.tsx` (extract CropTool), `Import.tsx`, `Settings.tsx`
