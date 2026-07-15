import { describe, expect, test } from 'bun:test';
import {
  __testBatchDuplicateKey,
  __testBatchVisibleRowKey,
  checkOneDuplicate,
  isStrongDuplicateFingerprint,
  type StudyCandidate,
} from '../src/web/utils/duplicateDetection';
import type { StudyLog } from '../src/web/types';

function candidate(patch: Partial<StudyCandidate> = {}): StudyCandidate {
  return {
    examNameRaw: 'XR CHEST PORTABLE',
    cptCode: '71045',
    cptCodes: ['71045'],
    modifier: '26',
    logDate: '2026-07-07',
    studyDateTime: '2026-07-07T09:00:00',
    performedDateTime: '2026-07-07T08:19:00',
    modifiedDateTime: '2026-07-07T09:00:00',
    studyDate: '2026-07-07',
    accessionNumber: null,
    rowIndex: null,
    modality: 'XR',
    ...patch,
  };
}

function log(patch: Partial<StudyLog> = {}): StudyLog {
  const base = candidate();
  return {
    id: 'log-1',
    profileId: null,
    logDate: base.logDate,
    studyDateTime: base.studyDateTime,
    examDateTime: base.performedDateTime ?? null,
    studyDate: base.studyDate,
    dateTimeConfidence: 1,
    dateTimeSource: 'ocr',
    examNameRaw: base.examNameRaw,
    examTitleNormalized: null,
    examTitleDisplay: base.examNameRaw,
    cmsDescription: null,
    cptCode: base.cptCode,
    modifier: base.modifier,
    workRvu: 1,
    modality: 'XR',
    matchMethod: 'radiology_match',
    matchConfidence: 1,
    needsReview: false,
    accessionNumber: null,
    rowIndex: null,
    ocrConfidence: null,
    sessionId: null,
    sourceImportId: null,
    notes: null,
    studyFingerprint: null,
    createdAt: '2026-07-07T00:00:00.000Z',
    updatedAt: '2026-07-07T00:00:00.000Z',
    ...patch,
  };
}

describe('strict duplicate detection', () => {
  test('same CPT/title and same date with different times is not a duplicate', async () => {
    const match = await checkOneDuplicate(
      candidate({ performedDateTime: '2026-07-07T14:15:00', modifiedDateTime: '2026-07-07T14:30:00', studyDateTime: '2026-07-07T14:30:00' }),
      [log({ examDateTime: '2026-07-07T08:19:00', studyDateTime: '2026-07-07T09:00:00' })],
    );

    expect(match).toBeNull();
  });

  test('same CPT/title and same date with different modified times is not exact', async () => {
    const match = await checkOneDuplicate(
      candidate({ performedDateTime: '2026-07-07T08:19:00', modifiedDateTime: '2026-07-07T14:30:00', studyDateTime: '2026-07-07T14:30:00' }),
      [log({ examDateTime: '2026-07-07T08:19:00', studyDateTime: '2026-07-07T09:00:00' })],
    );

    expect(match?.confidence).not.toBe('exact');
  });

  test('same CPT/title and same date with missing time is not exact', async () => {
    const match = await checkOneDuplicate(
      candidate({ studyDateTime: null, performedDateTime: null, modifiedDateTime: null }),
      [log({ studyDateTime: null, examDateTime: null, dateTimeConfidence: 0.85 })],
    );

    expect(match?.confidence).toBe('possible');
    expect(__testBatchDuplicateKey(candidate({ studyDateTime: null, performedDateTime: null, modifiedDateTime: null }))).toBeNull();
  });

  test('visible row number plus one matching timestamp makes a recaptured row exact', async () => {
    const match = await checkOneDuplicate(
      candidate({
        rowIndex: '17',
        performedDateTime: '2026-07-07T08:19:00',
        modifiedDateTime: null,
        studyDateTime: null,
      }),
      [log({
        rowIndex: '17',
        examDateTime: '2026-07-07T08:19:00',
        studyDateTime: '2026-07-07T09:00:00',
      })],
    );

    expect(match?.confidence).toBe('exact');
    expect(match?.reason).toContain('visible row number');
  });

  test('visible row number alone remains only a possible duplicate hint', async () => {
    const match = await checkOneDuplicate(
      candidate({ rowIndex: '17', performedDateTime: null, modifiedDateTime: null, studyDateTime: null }),
      [log({ rowIndex: '17', examDateTime: null, studyDateTime: null })],
    );

    expect(match?.confidence).toBe('possible');
  });

  test('uses visible row identity only for the same normalized title inside one batch', () => {
    const first = candidate({ rowIndex: '17', examNameRaw: 'XR CHEST  PORTABLE', studyDateTime: null });
    const repeated = candidate({ rowIndex: '17', examNameRaw: 'XR CHEST PORTABLE', studyDateTime: null });
    const neighboringRow = candidate({ rowIndex: '18', examNameRaw: 'XR CHEST PORTABLE', studyDateTime: null });

    expect(__testBatchVisibleRowKey(first)).toBe(__testBatchVisibleRowKey(repeated));
    expect(__testBatchVisibleRowKey(first)).not.toBe(__testBatchVisibleRowKey(neighboringRow));
    expect(__testBatchVisibleRowKey(candidate({ rowIndex: null }))).toBeNull();
  });

  test('same accession is exact duplicate', async () => {
    const match = await checkOneDuplicate(
      candidate({ accessionNumber: 'ABC12345', studyDateTime: null }),
      [log({ accessionNumber: 'ABC12345', studyDateTime: null })],
    );

    expect(match?.confidence).toBe('exact');
  });

  test('date-like numeric OCR fragments are not accession duplicate anchors', async () => {
    const match = await checkOneDuplicate(
      candidate({
        accessionNumber: '1112026',
        studyDateTime: null,
        performedDateTime: null,
        modifiedDateTime: null,
      }),
      [log({
        accessionNumber: '1112026',
        studyDateTime: null,
        examDateTime: null,
        dateTimeConfidence: 0.85,
      })],
    );

    expect(match?.confidence).not.toBe('exact');
    expect(__testBatchDuplicateKey(candidate({
      accessionNumber: '1112026',
      studyDateTime: null,
      performedDateTime: null,
      modifiedDateTime: null,
    }))).toBeNull();
  });

  test('same CPT/title/performed datetime/modified datetime is exact and strong enough for batch duplicate detection', async () => {
    const match = await checkOneDuplicate(candidate(), [log()]);
    const key = __testBatchDuplicateKey(candidate());

    expect(match?.confidence).toBe('exact');
    expect(key).not.toBeNull();
    expect(isStrongDuplicateFingerprint(key)).toBe(true);
  });

  test('same multi-CPT set/performed datetime/modified datetime is exact within batch', async () => {
    const first = candidate({ cptCode: '71260', cptCodes: ['71260', '74177'] });
    const second = candidate({ cptCode: '71260', cptCodes: ['74177', '71260'] });

    expect(__testBatchDuplicateKey(first)).toBe(__testBatchDuplicateKey(second));
    expect(__testBatchDuplicateKey(first)).not.toBeNull();
  });

  test('duplicate skipped count only includes true exact duplicates', async () => {
    const exact = candidate({ cptCode: '71045', cptCodes: ['71045'] });
    const differentTime = candidate({
      cptCode: '71045',
      cptCodes: ['71045'],
      performedDateTime: '2026-07-07T14:15:00',
      modifiedDateTime: '2026-07-07T14:30:00',
      studyDateTime: '2026-07-07T14:30:00',
    });
    const missingTime = candidate({
      cptCode: '71045',
      cptCodes: ['71045'],
      performedDateTime: null,
      modifiedDateTime: null,
      studyDateTime: null,
    });
    const keys = [exact, exact, differentTime, missingTime].map(__testBatchDuplicateKey);
    const seen = new Set<string>();
    const exactDuplicateKeys = keys.filter((key) => {
      if (!key) return false;
      if (seen.has(key)) return true;
      seen.add(key);
      return false;
    });

    expect(exactDuplicateKeys).toHaveLength(1);
  });

  test('initial repeated-CPT PowerScribe batch has zero exact duplicates when times differ', async () => {
    const rows = [
      candidate({
        performedDateTime: '2026-07-01T17:18:00',
        modifiedDateTime: '2026-07-02T07:59:00',
        studyDateTime: '2026-07-02T07:59:00',
      }),
      candidate({
        performedDateTime: '2026-07-01T19:06:00',
        modifiedDateTime: '2026-07-02T08:03:00',
        studyDateTime: '2026-07-02T08:03:00',
      }),
      candidate({
        performedDateTime: '2026-07-01T19:54:00',
        modifiedDateTime: '2026-07-02T08:04:00',
        studyDateTime: '2026-07-02T08:04:00',
      }),
    ];

    const keys = rows.map(__testBatchDuplicateKey);

    expect(new Set(keys).size).toBe(3);
  });

  test('repeating the same PowerScribe screenshot produces exact duplicate identities', async () => {
    const firstCapture = [
      candidate({
        performedDateTime: '2026-07-01T17:18:00',
        modifiedDateTime: '2026-07-02T07:59:00',
        studyDateTime: '2026-07-02T07:59:00',
      }),
      candidate({
        performedDateTime: '2026-07-01T19:06:00',
        modifiedDateTime: '2026-07-02T08:03:00',
        studyDateTime: '2026-07-02T08:03:00',
      }),
    ];
    const repeatedCapture = firstCapture.map((row) => ({ ...row }));

    expect(repeatedCapture.map(__testBatchDuplicateKey)).toEqual(firstCapture.map(__testBatchDuplicateKey));
    expect(repeatedCapture.every((row, index) => __testBatchDuplicateKey(row) === __testBatchDuplicateKey(firstCapture[index]))).toBe(true);
  });

  test('later portable chest capture skips only old exact identities and keeps new rows', async () => {
    const priorLogs = [
      log({
        cptCode: '71045',
        examDateTime: '2026-07-01T17:18:00',
        studyDateTime: '2026-07-02T07:59:00',
      }),
      log({
        cptCode: '71045',
        examDateTime: '2026-07-01T19:06:00',
        studyDateTime: '2026-07-02T08:03:00',
      }),
    ];
    const repeatedOldRow = candidate({
      performedDateTime: '2026-07-01T17:18:00',
      modifiedDateTime: '2026-07-02T07:59:00',
      studyDateTime: '2026-07-02T07:59:00',
    });
    const newRow = candidate({
      performedDateTime: '2026-07-01T20:28:00',
      modifiedDateTime: '2026-07-02T08:17:00',
      studyDateTime: '2026-07-02T08:17:00',
    });

    const oldMatch = await checkOneDuplicate(repeatedOldRow, priorLogs);
    const newMatch = await checkOneDuplicate(newRow, priorLogs);

    expect(oldMatch?.confidence).toBe('exact');
    expect(newMatch?.confidence).not.toBe('exact');
  });

  test('same multi-CPT set with different modified datetime is not duplicate', async () => {
    const match = await checkOneDuplicate(
      candidate({
        cptCode: '71260',
        cptCodes: ['71260', '74177'],
        performedDateTime: '2026-07-07T08:19:00',
        modifiedDateTime: '2026-07-07T14:30:00',
        studyDateTime: '2026-07-07T14:30:00',
      }),
      [log({
        cptCode: '71260',
        examDateTime: '2026-07-07T08:19:00',
        studyDateTime: '2026-07-07T09:00:00',
      })],
    );

    expect(match?.confidence).not.toBe('exact');
  });
});
