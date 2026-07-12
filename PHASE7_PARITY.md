# Phase 7 review parity

The Inbox is now the sole review surface. The legacy Import renderer was removed only after the following capabilities were verified:

- [x] Confidence tiers use the five human-readable phrases; technical method and candidate scores remain in the expansion.
- [x] Possible duplicates show the differing source/time fields, recommend skipping, and keep Count both visible.
- [x] Multi-CPT imported rows remain represented by the persisted review-session contract and existing import tests.
- [x] Per-row detail includes raw OCR text, match method, candidates, and scores on demand.
- [x] Batch work supports keyboard accept, edit, skip, undo, navigation, and accept-all-high-tier.
- [x] Review sessions persist in IndexedDB and survive reload.
- [x] Capture routes completed review batches directly to Inbox; no legacy review route remains in primary navigation.

Evidence is provided by the Inbox and review-session unit tests plus the Phase 4 keyboard-only browser sweep.
