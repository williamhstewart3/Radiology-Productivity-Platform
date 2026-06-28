# Duplicate Detection — Implementation Plan

## Architecture
New file: `utils/duplicateDetection.ts`
- `buildFingerprint(study)` → deterministic hash string  
- `checkDuplicates(candidates[], logDate)` → DuplicateCheckResult[]
- `DuplicateCheckResult`: { row, existingMatch, confidence: 'exact'|'very_likely'|'possible', existingLog }

## Fingerprint fields (priority order)
1. accessionNumber (if present → exact match wins immediately)  
2. cptCode + logDate + studyDateTime window (±2min = very_likely, ±15min = possible)
3. normalizedExamName + cptCode + logDate → exact fingerprint
4. modality + logDate + studyDateTime window

## DB Schema changes
- Add `studyFingerprint` field to `StudyLog` type
- Bump Dexie version (2) to add index on `studyFingerprint`
- No migration needed — old rows get no fingerprint, new rows do

## OcrReviewRow type addition
- Add `duplicateStatus: 'exact'|'very_likely'|'possible'|null`
- Add `existingLogId: string | null` (for "replace" action)

## Import.tsx changes
- After matching, before review: run duplicate check on all rows
- Auto-skip exact + very_likely → show in skipped list
- Flag possible → show inline warning in review UI
- Summary: "Imported: N  Skipped duplicates: M  Needs review: K"
- Skipped panel: expandable, each row has [Import anyway] [Skip] buttons

## LogStudy.tsx changes
- Before saving: quick dupe check against today's logs
- Warn if very_likely or possible duplicate → let user proceed

## Execution order
1. types/index.ts — add studyFingerprint to StudyLog, DuplicateCheckResult, OcrReviewRow additions
2. utils/duplicateDetection.ts — new file
3. db/database.ts — version bump, add fingerprint index
4. pages/Import.tsx — integrate dupe check + skipped UI
5. pages/LogStudy.tsx — inline dupe warning
6. Build + push
