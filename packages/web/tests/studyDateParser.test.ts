import { describe, expect, test } from 'bun:test';
import { parseDateTimeFromOcr } from '../src/web/utils/studyDateParser';

describe('parseDateTimeFromOcr — datetime matrix', () => {
  test.each([
    ['7/7/26 8:14 AM', '2026-07-07T08:14:00'],
    ['07/07/2026 08:14 AM', '2026-07-07T08:14:00'],
    ['7/7/26 14:14', '2026-07-07T14:14:00'],
    ['2026-07-07 08:14', '2026-07-07T08:14:00'],
  ])('%s preserves the full datetime', (text, expected) => {
    expect(parseDateTimeFromOcr(text)?.studyDateTime).toBe(expected);
  });
});

describe('parseDateTimeFromOcr — no fabrication', () => {
  test.each([
    'T2026 10:12 PM',
    '1112026',
    '819AM',
  ])('%s never yields a fabricated datetime', (text) => {
    const result = parseDateTimeFromOcr(text);
    expect(result?.studyDateTime ?? null).toBeNull();
  });

  test('212026 8:16 AM never yields a fabricated datetime', () => {
    const result = parseDateTimeFromOcr('212026 8:16 AM');
    expect(result?.studyDateTime ?? null).toBeNull();
  });

  test('an 8-digit compact date is not fabrication — every digit is present in the input', () => {
    const result = parseDateTimeFromOcr('07082026 8:19 AM');
    expect(result?.studyDateTime).toBe('2026-07-08T08:19:00');
  });

  test('a 6-digit compact date fragment does not guess a month from today', () => {
    const result = parseDateTimeFromOcr('722026 8:17 AM');
    expect(result?.studyDateTime ?? null).toBeNull();
  });

  test('a 7-digit compact date fragment does not guess a missing digit', () => {
    const result = parseDateTimeFromOcr('7112026 8:28 PM');
    expect(result?.studyDateTime ?? null).toBeNull();
  });
});
