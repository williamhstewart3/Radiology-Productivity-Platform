# OCR DateTime Feature — Implementation Tracker

## Status: IN PROGRESS

## Key Findings from Code Read
- `StudyLog` already has `studyDateTime: string | null` — no new field needed there!
- `OcrReviewRow` in types/index.ts also already has `studyDateTime`
- `ImportedStudy` has `studyTime: string | null` (used for studyDateTime in DB)
- `powerScribeParser.ts` already has DATE_TIME_PATTERN regex — but it's basic; needs enhancement
- DB is at v6; need v7 for new fields: `studyDate`, `importedAt`, `sourceScreenshotId`, `dateTimeConfidence`, `dateTimeSource`
- `buildFingerprint` already uses `studyDateTime` for minute-bucket fingerprinting
- `OCRImportProvider` calls `parseOcrLines` → returns `studyDateTime` already
- History groups by `logDate` — need to show time when available

## New Fields Needed on StudyLog
- `studyDate: string | null`       — YYYY-MM-DD extracted from OCR (separate from logDate)
- `importedAt: string`             — audit timestamp (already has createdAt, so maybe skip)
- `sourceScreenshotId: string | null` — hash/path of screenshot for dedup
- `dateTimeConfidence: number | null` — 0.0–1.0
- `dateTimeSource: 'ocr' | 'import_default' | 'manual' | 'api_future' | null`

## Tasks
- [x] Read all files
- [ ] 1. Create `utils/studyDateParser.ts` — enhanced datetime extraction
- [ ] 2. Update `types/index.ts` — add new fields to StudyLog
- [ ] 3. `db/database.ts` — v7 migration with backfill
- [ ] 4. Update `utils/powerScribeParser.ts` — use studyDateParser, return confidence
- [ ] 5. Update `providers/OCRImportProvider.ts` — attach dateTimeSource/confidence
- [ ] 6. Update `types/importProvider.ts` — add dateTimeConfidence/Source to ImportedStudy
- [ ] 7. Update `pipeline/importPipeline.ts` — pass through new fields to StudyLog
- [ ] 8. Update `pages/Import.tsx` — show time badge per row, ⚠️ when not OCR
- [ ] 9. Update `pages/History.tsx` — show time in log rows, sort by studyDateTime within day
- [ ] 10. Build verify + commit + push

## Decisions
- `logDate` stays as RVU calc date; when OCR gives date, set logDate = studyDate
- `dateTimeConfidence` on ImportedStudy feeds through to StudyLog
- Skip `sourceScreenshotId` for now — sourceImportId already covers batch dedup
- History: show time chip on each log row when studyDateTime is present
- Import review: show extracted time per row with source badge (OCR ✓ vs inferred ⚠️)
