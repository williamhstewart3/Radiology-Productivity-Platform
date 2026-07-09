import { describe, expect, test } from 'bun:test';
import {
  CAPTURE_PRIVACY_COPY,
  CAPTURE_PROCESSING_LABEL,
  CAPTURE_PROMPT_TITLE,
  formatOcrDateTime,
  shouldShowAccession,
  shouldAutoProcessPowerScribeCaptures,
} from '../src/web/pages/Import';

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

  test('uses broad capture processing language instead of OCR-only language', () => {
    expect(CAPTURE_PROCESSING_LABEL).toBe('Processing...');
    expect(CAPTURE_PROCESSING_LABEL).not.toMatch(/Running OCR/i);
  });

  test('PowerScribe capture prompt explains memory processing and stored data scope', () => {
    expect(CAPTURE_PROMPT_TITLE).toBe('PowerScribe capture detected');
    expect(CAPTURE_PRIVACY_COPY).toContain('processed in memory');
    expect(CAPTURE_PRIVACY_COPY).toContain('discarded after parsing');
    expect(CAPTURE_PRIVACY_COPY).toContain('Only extracted productivity data is stored');
  });

  test('always-process setting controls future capture confirmation bypass', () => {
    expect(shouldAutoProcessPowerScribeCaptures({ alwaysProcessPowerScribeClipboard: true })).toBe(true);
    expect(shouldAutoProcessPowerScribeCaptures({ alwaysProcessPowerScribeClipboard: false })).toBe(false);
    expect(shouldAutoProcessPowerScribeCaptures(null)).toBe(false);
  });
});
