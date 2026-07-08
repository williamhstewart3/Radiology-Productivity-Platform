import { describe, expect, test } from 'bun:test';
import { getImportReviewState } from '../src/web/utils/importReviewState';

describe('import review state labels', () => {
  test('shows no-studies state when OCR extracted nothing and no duplicates were skipped', () => {
    const state = getImportReviewState({
      extractedCount: 0,
      reviewRowCount: 0,
      skippedRowCount: 0,
      matchedCount: 0,
      selectedCodeCount: 0,
      importing: false,
    });

    expect(state.isEmptyExtraction).toBe(true);
    expect(state.isAllDuplicates).toBe(false);
    expect(state.commitDisabled).toBe(true);
    expect(state.commitLabel).toBe('No Studies Found');
  });

  test('shows all-duplicates only when extracted rows were actually skipped', () => {
    const state = getImportReviewState({
      extractedCount: 4,
      reviewRowCount: 0,
      skippedRowCount: 4,
      matchedCount: 0,
      selectedCodeCount: 0,
      importing: false,
    });

    expect(state.isEmptyExtraction).toBe(false);
    expect(state.isAllDuplicates).toBe(true);
    expect(state.commitDisabled).toBe(true);
    expect(state.commitLabel).toBe('All Duplicates - Nothing to Import');
  });
});
