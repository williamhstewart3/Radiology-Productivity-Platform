import { describe, expect, test } from 'bun:test';
import { formatOcrDateTime, shouldShowAccession } from '../src/web/pages/Import';

describe('import review date-time formatting', () => {
  test('displays fallback datetime time when separate date is present', () => {
    expect(formatOcrDateTime('2026-07-08', null, '2026-07-08T21:05:00')).toBe('7/8/26 9:05 PM');
  });

  test('displays explicit OCR time when available', () => {
    expect(formatOcrDateTime('2026-07-08', '08:19', '2026-07-08T21:05:00')).toBe('7/8/26 8:19 AM');
  });

  test('hides accession line when PowerScribe OCR has no real accession', () => {
    expect(shouldShowAccession(null)).toBe(false);
    expect(shouldShowAccession('')).toBe(false);
    expect(shouldShowAccession('ACC12345')).toBe(true);
  });
});
