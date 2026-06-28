# OCR Exam Matching — Radiology-Aware Pipeline

## What's changing
1. `textMatching.ts` — expand ABBREVIATION_MAP + radiology protocol rules (CODE STROKE → CTA Head Neck, PE → Pulmonary Embolism, etc.)
2. NEW `examNormalizer.ts` — Step 1+2: normalizeForRadiology() returns {normalizedTitle, detectedModality, contrastStatus, bodyParts[]}
3. `matching.ts` — Steps 3-5: alias-first, then radiology-aware scoring (modality+body+contrast weighted), low confidence → no suggestion instead of bad one
4. NEW `examLibrary.ts` — canonical exam registry (modality, body part, contrast) + radiology match scorer
5. `Import.tsx` (review UI) — "Can't find it?" manual search, confidence gating, alias-saves on manual select

## Files to create/modify
- `packages/web/src/web/utils/examNormalizer.ts` — NEW
- `packages/web/src/web/utils/examLibrary.ts` — NEW  
- `packages/web/src/web/utils/textMatching.ts` — expand maps
- `packages/web/src/web/utils/matching.ts` — radiology-aware scorer, confidence gate
- `packages/web/src/web/pages/Import.tsx` — "Can't find it?" search + low-confidence gate

## Confidence thresholds
- ≥0.95 alias exact → auto-accept, no review
- ≥0.75 → show candidates normally
- <0.50 → show "Search entire exam library" instead of candidates
- Manual search → saves alias → never shown again
