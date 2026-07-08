import { describe, expect, test } from 'bun:test';
import { parseOcrLines } from '../src/web/utils/powerScribeParser';

describe('PowerScribe OCR parser date-time preservation', () => {
  test('preserves full exam and modified date-times when OCR includes times', () => {
    const [row] = parseOcrLines([
      'CT CHEST ABDOMEN PELVIS W CONTRAST 7/7/26 8:14 AM 7/7/26 9:24 AM',
    ]);

    expect(row.procedureName).toBe('CT CHEST ABDOMEN PELVIS W CONTRAST');
    expect(row.examDate).toBe('2026-07-07');
    expect(row.examTime).toBe('08:14');
    expect(row.examDateTime).toBe('2026-07-07T08:14:00');
    expect(row.modifiedDate).toBe('2026-07-07');
    expect(row.modifiedTime).toBe('09:24');
    expect(row.modifiedDateTime).toBe('2026-07-07T09:24:00');
    expect(row.dateTimeConfidence).toBe(1);
  });

  test('keeps date-only rows valid without inventing a time', () => {
    const [row] = parseOcrLines([
      'XR CHEST PORTABLE 7/7/26 7/8/26',
    ]);

    expect(row.procedureName).toBe('XR CHEST PORTABLE');
    expect(row.examDate).toBe('2026-07-07');
    expect(row.examTime).toBeNull();
    expect(row.examDateTime).toBeNull();
    expect(row.modifiedDate).toBe('2026-07-08');
    expect(row.modifiedTime).toBeNull();
    expect(row.modifiedDateTime).toBeNull();
  });
});
