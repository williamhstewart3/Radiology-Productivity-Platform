# Web test fixtures

`fixtures/powerScribeImportRows.ts` records the current PowerScribe import contract with synthetic, non-patient rows. It includes separate exam and modified timestamps, repeated CPTs, an identical recapture, an addendum-style later modification, midnight values, and the `OBLIGUE` OCR spelling.

`fixtures/powerScribePreprocessingCases.ts` records PHI-free character-level OCR confusions and source-display cases for the preprocessing benchmark. These text expectations do not replace the clean, manually verified local screenshot fixtures required to choose production pixel settings.

The permanent OCR regression entry point is:

```sh
bun run test:ocr-regression
```

It currently enforces preprocessing algorithms, combined Tesseract configuration, timestamp preservation, institutional-title handoff contracts, and duplicate stability. A real-image accuracy baseline must not be added until its deidentified source PNG and exact visible cell truth have been reviewed. Once added, the same command should invoke the stable browser fixture subset and `evaluatePowerScribeBenchmarkBaseline` should fail CI below the checked-in thresholds.

`powerScribeImportContract.test.ts` intentionally tests public import/parser behavior without changing production code. The duplicate helper accepts an already-selected list of logs and does not receive a profile ID. Its database-backed batch lookup currently selects by `logDate` without profile filtering, so the desired cross-profile isolation assertion is a named `test.todo` until production behavior is changed in separately scoped work.

Run the focused contract suite from the repository root:

```sh
bun test packages/web/tests/powerScribeImportContract.test.ts
```
