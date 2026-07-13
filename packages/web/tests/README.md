# Web test fixtures

`fixtures/powerScribeImportRows.ts` records the current PowerScribe import contract with synthetic, non-patient rows. It includes separate exam and modified timestamps, repeated CPTs, an identical recapture, an addendum-style later modification, midnight values, and the `OBLIGUE` OCR spelling.

`powerScribeImportContract.test.ts` intentionally tests public import/parser behavior without changing production code. The duplicate helper accepts an already-selected list of logs and does not receive a profile ID. Its database-backed batch lookup currently selects by `logDate` without profile filtering, so the desired cross-profile isolation assertion is a named `test.todo` until production behavior is changed in separately scoped work.

Run the focused contract suite from the repository root:

```sh
bun test packages/web/tests/powerScribeImportContract.test.ts
```
