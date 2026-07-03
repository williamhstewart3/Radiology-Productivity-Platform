# Radiology Productivity Platform – Next Steps

## ✅ Completed

- [x] Seed curated Radiology Exam Dictionary
- [x] Extract OCR workflow service
- [x] Extract review session service
- [x] Extract memory learning service
- [x] Improve PowerScribe OCR line filtering
- [x] Auto-crop PowerScribe screenshots before OCR
- [x] Use Modified Date/Time as OCR productivity timestamp while preserving Exam Date
- [x] Replace obsolete folder-watcher workflow with PowerScribe clipboard/window capture intake
- [x] Tighten PowerScribe table crop bounds to avoid toolbar/navigation/status chrome before OCR
- [x] Strip visible row numbers and mixed PowerScribe UI labels before OCR matching
- [x] Add Orbit CME seed mappings as supplemental OCR CPT/wRVU lookup source
- [x] Split OCR procedure, exam date/time, and read date/time into separate structured fields
- [x] Use modality-first PowerScribe OCR matching with deterministic protocol mappings before fuzzy fallback
- [x] Add Windows clipboard OCR helper path that returns structured PowerScribe rows
- [x] Add ACR CY2026 radiology-active CPT set for default OCR auto-matching
- [x] Add hard modality filters and XR view normalization before fuzzy CPT matching

---

# OCR & Import

## High Priority

- [x] Auto-crop PowerScribe screenshots before OCR
- [x] Restrict OCR to the PowerScribe study list region
- [x] Ignore dates, timestamps, and UI text before parsing
- [x] Auto-detect the completed-studies table before OCR with relative-crop fallback
- [x] Capture visible PowerScribe row/index metadata when OCR provides it
- [x] Treat Modified Date/Time as productivity date while preserving Exam Date
- [x] Use existing exam dictionary first, then Orbit CME seed mappings, before CMS/fuzzy OCR matching
- [x] Save OCR confidence per study
- [x] Keep OCR dates out of procedure normalization and fuzzy CPT matching
- [x] Strip leading PowerScribe row/status junk before procedure parsing and matching
- [x] Preserve Exam and Read times in OCR review cards
- [x] Prefer Windows structured PowerScribe clipboard OCR in Electron with browser OCR fallback
- [ ] Bulk approve high-confidence studies
- [ ] Unknowns-only review mode
- [ ] Review later workflow
- [ ] Multi-screenshot merge
- [ ] Clipboard auto-import option
- [ ] Auto-detect PowerScribe screenshots

---

# Matching

- [ ] Learn aliases from user corrections
- [ ] Thorax → Chest normalization
- [ ] Abd/Pel abbreviation normalization
- [ ] Hospital-specific aliases
- [ ] PowerScribe-specific aliases
- [ ] Improve fuzzy matching confidence
- [ ] Prioritize modifier 26 CPTs only
- [ ] Ignore 0.0 RVU CPT codes
- [x] Support deterministic multiple-CPT OCR matches for common combined studies
- [x] Combined-study matching for common CT/CTA protocol pairs
- [x] Restrict automatic fuzzy CPT matching to ACR radiology-active CPTs by default
- [x] Strip junk before the first modality token before CPT matching
- [x] Add deterministic aliases for common PowerScribe OCR study names

---

# Productivity

- [ ] Running projected wRVUs throughout the day
- [ ] Finalize Day workflow
- [ ] Temporary session until finalized
- [ ] Daily timeline
- [ ] Productivity dashboard
- [ ] OCR accuracy dashboard
- [ ] Time saved statistics

---

# Database

- [ ] Persist OCR learning in Supabase
- [ ] Store learned aliases
- [ ] Store confidence history
- [ ] Store review sessions
- [ ] Store temporary daily sessions

---

# Future

- [ ] Hospital billing reconciliation
- [ ] CPT audit reports
- [ ] Modifier audit
- [ ] Revenue integrity dashboard
- [ ] Compare OCR CPTs vs billed CPTs
- [ ] Missing CPT detection

---

# UI

- [ ] Mini window always on top
- [ ] Better OCR review layout
- [ ] "+" separator between combined CPTs
- [ ] Multi-select delete
- [ ] Faster keyboard navigation
- [ ] Persistent profile selection

---

## Ideas

(Add ideas here as they come up.)
