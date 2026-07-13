import { describe, expect, test } from 'bun:test';
import { isAddendumTouch, recommendedDuplicateAction } from '../src/web/utils/duplicateActions';
import type { ImportedStudy } from '../src/web/types/importProvider';
import type { StudyLog } from '../src/web/types';

function source(overrides: Partial<ImportedStudy>): ImportedStudy {
  return {
    examTitle: 'CT Abdomen Pelvis with Contrast',
    procedureName: 'CT Abdomen Pelvis with Contrast',
    examDateTime: '2026-07-13T14:00:00.000Z',
    studyTime: '2026-07-13T14:00:00.000Z',
    modifiedDateTime: '2026-07-13T18:30:00.000Z',
    source: 'powerscribe',
    ...overrides,
  } as ImportedStudy;
}

function existingLog(overrides: Partial<StudyLog>): StudyLog {
  return {
    id: 'existing_1',
    profileId: null,
    logDate: '2026-07-13',
    studyDateTime: '2026-07-13T14:05:00.000Z',
    examDateTime: '2026-07-13T14:00:00.000Z',
    studyDate: '2026-07-13',
    dateTimeConfidence: 1,
    dateTimeSource: 'ocr',
    examNameRaw: 'CT ABDOMEN PELVIS WITH CONTRAST',
    examTitleDisplay: 'CT Abdomen Pelvis with Contrast',
    cptCode: '74177',
    modifier: '26',
    workRvu: 3.15,
    modality: 'CT',
    matchMethod: 'manual_cpt',
    matchConfidence: 1,
    needsReview: false,
    sessionId: null,
    sourceImportId: null,
    notes: null,
    studyFingerprint: 'weak:x',
    createdAt: '2026-07-13T14:10:00.000Z',
    updatedAt: '2026-07-13T14:10:00.000Z',
    ...overrides,
  } as StudyLog;
}

describe('isAddendumTouch', () => {
  test('same procedure + same exam datetime + later Modified time -> true', () => {
    const s = source({ modifiedDateTime: '2026-07-13T18:30:00.000Z' });
    const log = existingLog({ studyDateTime: '2026-07-13T14:05:00.000Z' });
    expect(isAddendumTouch(s, log)).toBe(true);
  });

  test('different exam datetimes -> false, even with a later Modified time', () => {
    const s = source({ examDateTime: '2026-07-13T09:00:00.000Z' });
    const log = existingLog({ examDateTime: '2026-07-13T14:00:00.000Z' });
    expect(isAddendumTouch(s, log)).toBe(false);
  });

  test('same exam datetime but the incoming Modified time is NOT later -> false', () => {
    const s = source({ modifiedDateTime: '2026-07-13T14:00:00.000Z' });
    const log = existingLog({ studyDateTime: '2026-07-13T14:05:00.000Z' });
    expect(isAddendumTouch(s, log)).toBe(false);
  });

  test('different procedure name -> false', () => {
    const s = source({ procedureName: 'CT Chest without Contrast', examTitle: 'CT Chest without Contrast' });
    expect(isAddendumTouch(s, existingLog({}))).toBe(false);
  });

  test('missing modified time on either side -> false (never guess)', () => {
    expect(isAddendumTouch(source({ modifiedDateTime: null, studyTime: null }), existingLog({}))).toBe(false);
    expect(isAddendumTouch(source({}), existingLog({ studyDateTime: null }))).toBe(false);
  });
});

describe('recommendedDuplicateAction', () => {
  test('recommends update_existing for an addendum touch', () => {
    expect(recommendedDuplicateAction(source({}), existingLog({}))).toBe('update_existing');
  });

  test('recommends nothing (today\'s default: skip stays primary) when datetimes differ', () => {
    const s = source({ examDateTime: '2026-07-13T09:00:00.000Z' });
    expect(recommendedDuplicateAction(s, existingLog({}))).toBeNull();
  });

  test('recommends nothing when there is no existing log to compare against', () => {
    expect(recommendedDuplicateAction(source({}), null)).toBeNull();
    expect(recommendedDuplicateAction(source({}), undefined)).toBeNull();
  });
});
