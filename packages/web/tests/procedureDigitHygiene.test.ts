import { describe, expect, test } from 'bun:test';
import { __testApplyProcedureDigitHygiene } from '../src/web/providers/OCRImportProvider';

describe('procedure-column digit hygiene', () => {
  test('strips a leading row number and a trailing bled date fragment', () => {
    const result = __testApplyProcedureDigitHygiene('45 XR CHEST PORTABLE 7182026');
    expect(result.text).toBe('XR CHEST PORTABLE');
    expect(result.contaminated).toBe(false);
  });

  test('a surviving 3+ digit token in the middle flags the row for review', () => {
    const result = __testApplyProcedureDigitHygiene('XR CHEST 1234 PORTABLE');
    expect(result.contaminated).toBe(true);
  });

  test('legitimate "N VIEW(S)" patterns are preserved, not stripped', () => {
    const oneView = __testApplyProcedureDigitHygiene('XR HAND 1 VIEW');
    expect(oneView.text).toBe('XR HAND 1 VIEW');
    expect(oneView.contaminated).toBe(false);

    const twoViews = __testApplyProcedureDigitHygiene('2 VIEWS XR CHEST');
    expect(twoViews.text).toBe('2 VIEWS XR CHEST');
    expect(twoViews.contaminated).toBe(false);
  });

  test('a fused pattern like "3D" is untouched (not a standalone digit token)', () => {
    const result = __testApplyProcedureDigitHygiene('CT 3D RECON CHEST');
    expect(result.text).toBe('CT 3D RECON CHEST');
    expect(result.contaminated).toBe(false);
  });
});
