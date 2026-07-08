import { describe, expect, test } from 'bun:test';
import {
  __testBatchDuplicateKey,
  checkOneDuplicate,
  isStrongDuplicateFingerprint,
  type StudyCandidate,
} from '../src/web/utils/duplicateDetection';
import type { StudyLog } from '../src/web/types';

function candidate(patch: Partial<StudyCandidate> = {}): StudyCandidate {
  return {
    examNameRaw: 'XR CHEST PORTABLE',
    cptCode: '71045',
    modifier: '26',
    logDate: '2026-07-07',
    studyDateTime: '2026-07-07T08:19:00',
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
      candidate({ studyDateTime: '2026-07-07T14:15:00' }),
      [log({ studyDateTime: '2026-07-07T08:19:00' })],
    );

    expect(match).toBeNull();
  });

  test('same CPT/title and same date with missing time is not exact', async () => {
    const match = await checkOneDuplicate(
      candidate({ studyDateTime: null }),
      [log({ studyDateTime: null, dateTimeConfidence: 0.85 })],
    );

    expect(match?.confidence).toBe('possible');
    expect(__testBatchDuplicateKey(candidate({ studyDateTime: null }))).toBeNull();
  });

  test('same accession is exact duplicate', async () => {
    const match = await checkOneDuplicate(
      candidate({ accessionNumber: 'ABC12345', studyDateTime: null }),
      [log({ accessionNumber: 'ABC12345', studyDateTime: null })],
    );

    expect(match?.confidence).toBe('exact');
  });

  test('same CPT/title/full datetime is exact and strong enough for batch duplicate detection', async () => {
    const match = await checkOneDuplicate(candidate(), [log()]);
    const key = __testBatchDuplicateKey(candidate());

    expect(match?.confidence).toBe('exact');
    expect(key).not.toBeNull();
    expect(isStrongDuplicateFingerprint(key)).toBe(true);
  });
});
