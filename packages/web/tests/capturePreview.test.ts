import { describe, expect, test } from 'bun:test';
import { isLikelyPowerScribeWindow, POWERSCRIBE_ANCHOR_CONFIDENCE_FLOOR } from '../src/web/utils/capturePreview';

describe('isLikelyPowerScribeWindow', () => {
  test('a detected crop at or above the confidence floor looks like PowerScribe', () => {
    expect(isLikelyPowerScribeWindow({ method: 'detected', confidence: POWERSCRIBE_ANCHOR_CONFIDENCE_FLOOR })).toBe(true);
    expect(isLikelyPowerScribeWindow({ method: 'detected', confidence: 0.9 })).toBe(true);
  });

  test('a detected crop below the confidence floor does not look like PowerScribe', () => {
    expect(isLikelyPowerScribeWindow({ method: 'detected', confidence: 0.1 })).toBe(false);
  });

  test('a fallback crop never looks like PowerScribe, regardless of confidence', () => {
    expect(isLikelyPowerScribeWindow({ method: 'fallback', confidence: 0.9 })).toBe(false);
  });
});
