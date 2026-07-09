import { describe, expect, test } from 'bun:test';
import { parseOcrLines, parseOcrLinesWithDebug } from '../src/web/utils/powerScribeParser';

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

  test('preserves OCR-damaged compact date-times from PowerScribe columns', () => {
    const [row] = parseOcrLines([
      'XR CHEST PORTABLE 7/8/26 819 AM 7/8/26 905 PM',
    ]);

    expect(row.procedureName).toBe('XR CHEST PORTABLE');
    expect(row.examDate).toBe('2026-07-08');
    expect(row.examTime).toBe('08:19');
    expect(row.examDateTime).toBe('2026-07-08T08:19:00');
    expect(row.modifiedDate).toBe('2026-07-08');
    expect(row.modifiedTime).toBe('21:05');
    expect(row.modifiedDateTime).toBe('2026-07-08T21:05:00');
  });

  test('maps damaged PowerScribe date fragments with visible times into full datetimes', () => {
    const [row] = parseOcrLines([
      'XR CHEST PORTABLE T2026 10:12 PM 212026 8:16 AM',
    ]);

    expect(row.procedureName).toBe('XR CHEST PORTABLE');
    expect(row.examDateTime).toBe('2026-07-01T22:12:00');
    expect(row.modifiedDateTime).toBe('2026-07-02T08:16:00');
    expect(row.examTime).toBe('22:12');
    expect(row.modifiedTime).toBe('08:16');
  });

  test('removes trailing OCR date fragments from cleaned procedure names', () => {
    const rows = parseOcrLines([
      'XR ABDOMEN AP A2026 AT AM',
      'XR WRIST RIGHT PA LATERAL AND OBLIGUE T2026 212026',
      'CT HEAD WO CONTRAST T212026',
    ]);

    expect(rows.map((row) => row.procedureName)).toEqual([
      'XR ABDOMEN AP',
      'XR WRIST RIGHT PA LATERAL AND OBLIQUE',
      'CT HEAD WO CONTRAST',
    ]);
  });

  test('does not treat damaged PowerScribe date/time fragments as accessions', () => {
    const rows = parseOcrLines([
      'XR ABDOMEN AP 1112026',
      'XR CHEST PORTABLE 1212026',
      'XR CHEST PORTABLE 7182026',
      'XR CHEST PORTABLE 07082026',
      'XR CHEST PORTABLE 22026',
      'XR CHEST PORTABLE 212026',
      'XR CHEST PORTABLE 819AM',
      'XR CHEST PORTABLE 819',
      'XR CHEST PORTABLE 215PM',
    ]);

    expect(rows).toHaveLength(9);
    expect(rows.every((row) => row.accessionNumber === null)).toBe(true);
    expect(rows[0].procedureName).toBe('XR ABDOMEN AP');
  });

  test('splits joined neighboring OCR rows instead of matching merged procedure text', () => {
    const rows = parseOcrLines([
      've 51 XR CHEST PA AND LATERAL 7/2/2026 2:16 PM 7/2/2026 2:36 PM / 52 XRCHEST PORTABLE 7/2/2026 3:00 PM 7/2/2026 3:12 PM',
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0].procedureName).toBe('XR CHEST PA AND LATERAL');
    expect(rows[0].modifiedDateTime).toBe('2026-07-02T14:36:00');
    expect(rows[1].procedureName).toBe('XR CHEST PORTABLE');
    expect(rows[1].modifiedDateTime).toBe('2026-07-02T15:12:00');
  });

  test('drops gutter-heavy leading junk before the first real modality token', () => {
    const [row] = parseOcrLines([
      'AF 11 ARAL FUR IADLD AT a a aaa 1 AM / 12 XRWRIST RIGHT PA LATERAL AND OBLIQUE 7/2/2026 2:16 PM 7/2/2026 2:36 PM',
    ]);

    expect(row.procedureName).toBe('XR WRIST RIGHT PA LATERAL AND OBLIQUE');
    expect(row.needsReview).toBe(false);
  });

  test('keeps noisy rows with a recognizable radiology exam for review', () => {
    const [row] = parseOcrLines([
      'AF 11 ARAL FUR IADLD AT a a aaa 1 AM / 12 XRWRIST RIGHT PA LATERAL AND OBLIQUE T2026 212026',
    ]);

    expect(row.procedureName).toBe('XR WRIST RIGHT PA LATERAL AND OBLIQUE');
    expect(row.needsReview).toBe(true);
    expect(row.reviewReason).toContain('date');
  });

  test('discards metadata-only rows without an exam signal', () => {
    const result = parseOcrLinesWithDebug([
      'Reset Filters Browse Search Status Dashboard Signed Study',
    ]);

    expect(result.rows).toHaveLength(0);
    expect(result.debug.rejectedRowCount).toBe(1);
    expect(result.debug.rejectedRows[0].reason).toBe('Metadata or UI-only row');
  });

  test('splits multi-modality OCR rows instead of treating them as one clean match', () => {
    const rows = parseOcrLines([
      'CT CARDIAC SCORE SPECIAL 7/2/2026 T2026 CTLDCT LUNG CANCER SCREENING 7/2/2026',
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0].procedureName).toBe('CT CARDIAC SCORE SPECIAL');
    expect(rows[1].procedureName).toBe('CT LDCT LUNG CANCER SCREENING');
  });
});
