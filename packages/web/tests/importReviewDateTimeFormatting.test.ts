import { describe, expect, test } from 'bun:test';
import { formatOcrDateTime } from '../src/web/pages/Import';

describe('import review date-time formatting', () => {
  test('displays fallback datetime time when separate date is present', () => {
    expect(formatOcrDateTime('2026-07-08', null, '2026-07-08T21:05:00')).toBe('7/8/26 9:05 PM');
  });

  test('displays explicit OCR time when available', () => {
    expect(formatOcrDateTime('2026-07-08', '08:19', '2026-07-08T21:05:00')).toBe('7/8/26 8:19 AM');
  });
});
