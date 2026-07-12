import { describe, expect, test } from 'bun:test';
import { combinedSimilarity, spacelessKey } from '../src/web/utils/textMatching';

describe('space-insensitive OCR text matching', () => {
  test('matches OCR text that drops spaces', () => {
    expect(combinedSimilarity('CTCHEST WCONTRAST', 'CT CHEST W CONTRAST')).toBeGreaterThanOrEqual(0.85);
    expect(spacelessKey('CT CHEST W CONTRAST')).toBe(spacelessKey('CTCHEST WCONTRAST'));
  });

  test('keeps contrast contradictions low even when spacing is noisy', () => {
    expect(combinedSimilarity('CTCHEST WCONTRAST', 'CT CHEST WO CONTRAST')).toBeLessThan(0.5);
  });
});
