# CPT Matching Improvements

## Feature 1: Professional (Modifier 26) Only
- `matching.ts` `findMatchCandidates()` — filter cptRvuTable to only professional rows
  - When querying by statusCategory: also filter pcTcIndicator = 'professional' OR (pcTcIndicator = 'na' — non-split codes like MRI brain which carry full wRVU without modifier)
  - NEVER return rows where pcTcIndicator = 'technical' or 'global' for split codes
  - `pickBestRowForModifier()` — rewrite to: prefer '26' modifier row; if no '26' row exists, allow 'na' rows; never return 'TC' or global split rows
- `seedCptData.ts` — audit seed rows: any global/technical rows need '26' modifier counterpart or removal

## Feature 2: Exam Alias Learning (ExamAlias table already exists)
### Schema additions needed:
- Add `normalizedTitle` and `mappedExamDescription` fields to ExamAlias (currently has aliasText = normalized, aliasTextRaw = raw — close enough, just use them)
- Add `lastUsed` field — already has `lastUsedAt`
- Existing schema is sufficient; no DB migration needed

### textMatching.ts — normalization improvements
- Add abbreviation expansions: 'cta' → 'ct angiogram', 'stroke' handling, 'hd' → 'head', 'neg' fix (currently maps to 'neck' — that's already correct)
- Normalize: strip 'code' keyword (institution-specific noise like "CT ANGIOGRAM CODE STROKE")

### matching.ts changes
- `findMatchCandidates()`: 
  1. Check alias table first with normalized lookup (exact match → auto-assign, skip confirmation)
  2. Fuzzy alias check  
  3. CPT description fuzzy (pro-only filtered)
- Return `method: 'alias_match'` with high confidence (≥0.95) for exact alias hits
- `learnAlias()`: already exists and works — ensure it's called on every confirmed import

### Import.tsx changes
- Auto-select alias_match candidates with confidence ≥ 0.95 WITHOUT flagging needsReview
- Show "Auto-matched (learned)" badge instead of "Review" for alias hits
- Still show the row so user can override, but don't require action

## Files to touch
1. `textMatching.ts` — add normalizations (strip institution noise like "CODE", add CTA expansion)
2. `matching.ts` — pro-only filter + alias-first logic already structured correctly, tighten it
3. `Import.tsx` — auto-accept high-confidence alias matches, show learned badge
4. `seedCptData.ts` — verify/fix pcTcIndicator values on split codes

## Execution order
1. textMatching.ts
2. matching.ts  
3. Import.tsx
4. seedCptData.ts audit
5. Build + push
