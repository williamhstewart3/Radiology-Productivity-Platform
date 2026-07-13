import { describe, expect, test } from 'bun:test';
import { CSVImportProvider } from '../src/web/providers/CSVImportProvider';
import { StructuredPowerScribeOcrImportProvider } from '../src/web/providers/StructuredPowerScribeOcrImportProvider';
import type { StudyLog } from '../src/web/types';
import {
  __testBatchDuplicateKey,
  checkOneDuplicate,
  type StudyCandidate,
} from '../src/web/utils/duplicateDetection';
import { parseOcrLines } from '../src/web/utils/powerScribeParser';
import { powerScribeImportRows, quotedCommaCsv } from './fixtures/powerScribeImportRows';

function fixture(id: string) {
  const match = powerScribeImportRows.find((row) => row.id === id);
  if (!match) throw new Error(`Missing PowerScribe fixture: ${id}`);
  return match;
}

function candidate(id: string): StudyCandidate {
  const source = fixture(id);
  return {
    examNameRaw: source.expectedProcedureName,
    cptCode: source.cptCodes[0] ?? null,
    cptCodes: [...source.cptCodes],
    modifier: '26',
    logDate: source.expectedModifiedDateTime.slice(0, 10),
    studyDateTime: source.expectedModifiedDateTime,
    performedDateTime: source.expectedExamDateTime,
    modifiedDateTime: source.expectedModifiedDateTime,
    studyDate: source.expectedExamDateTime.slice(0, 10),
    accessionNumber: null,
    rowIndex: null,
    modality: source.expectedProcedureName.split(' ')[0] ?? null,
  };
}

function existingLog(id: string, profileId: string | null): StudyLog {
  const source = candidate(id);
  return {
    id: `log-${id}`,
    profileId,
    logDate: source.logDate,
    studyDateTime: source.studyDateTime,
    examDateTime: source.performedDateTime ?? null,
    studyDate: source.studyDate,
    examNameRaw: source.examNameRaw,
    cptCode: source.cptCode,
    modifier: source.modifier,
    modality: source.modality as StudyLog['modality'],
    accessionNumber: source.accessionNumber,
    studyFingerprint: __testBatchDuplicateKey(source),
  } as StudyLog;
}

describe('PowerScribe import contract fixtures', () => {
  test('parses exam and modified timestamps independently for every OCR row', () => {
    for (const source of powerScribeImportRows) {
      const [parsed] = parseOcrLines([source.rawOcrText.replaceAll(' | ', ' ')]);

      expect(parsed.procedureName).toBe(source.expectedProcedureName);
      expect(parsed.examDateTime).toBe(source.expectedExamDateTime);
      expect(parsed.modifiedDateTime).toBe(source.expectedModifiedDateTime);
    }
  });

  test('preserves midnight as 00:00 and normalizes the OBLIGUE OCR misspelling', () => {
    const source = fixture('midnight-oblique-misspelling');
    const [parsed] = parseOcrLines([source.rawOcrText.replaceAll(' | ', ' ')]);

    expect(parsed.examTime).toBe('00:00');
    expect(parsed.modifiedTime).toBe('00:07');
    expect(parsed.procedureName).toBe('XR WRIST RIGHT PA LATERAL AND OBLIQUE');
  });

  test('structured import preserves both timestamps and uses modified time for productivity', async () => {
    const provider = new StructuredPowerScribeOcrImportProvider(
      powerScribeImportRows.map((source) => ({ ...source.structured })),
      '2026-07-13',
    );

    const studies = await provider.importStudies();
    expect(studies).toHaveLength(powerScribeImportRows.length);
    studies.forEach((study, index) => {
      const source = powerScribeImportRows[index];
      expect(study.examDateTime).toBe(source.expectedExamDateTime);
      expect(study.modifiedDateTime).toBe(source.expectedModifiedDateTime);
      expect(study.studyTime).toBe(source.expectedModifiedDateTime);
      expect(study.studyDate).toBe(source.expectedModifiedDateTime.slice(0, 10));
    });
  });

  test('repeated CPT codes at different timestamps have distinct strict fingerprints', () => {
    const morning = __testBatchDuplicateKey(candidate('portable-morning'));
    const afternoon = __testBatchDuplicateKey(candidate('portable-afternoon-same-cpt'));

    expect(morning).toStartWith('strict:71045|');
    expect(afternoon).toStartWith('strict:71045|');
    expect(afternoon).not.toBe(morning);
  });

  test('an identical recapture has the same strict fingerprint', async () => {
    const first = candidate('portable-morning');
    const recapture = candidate('portable-morning-recapture');

    expect(__testBatchDuplicateKey(recapture)).toBe(__testBatchDuplicateKey(first));
    expect((await checkOneDuplicate(recapture, [existingLog('portable-morning', 'profile-a')]))?.confidence).toBe('exact');
  });

  test('an addendum-style row with a later modified time is not an exact duplicate', async () => {
    const original = candidate('portable-morning');
    const addendum = candidate('portable-addendum');

    expect(addendum.performedDateTime).toBe(original.performedDateTime);
    expect(addendum.modifiedDateTime).not.toBe(original.modifiedDateTime);
    expect(__testBatchDuplicateKey(addendum)).not.toBe(__testBatchDuplicateKey(original));
    expect((await checkOneDuplicate(addendum, [existingLog('portable-morning', 'profile-a')]))?.confidence).not.toBe('exact');
  });

  test('the low-level duplicate helper currently assumes supplied logs are already profile-scoped', async () => {
    const match = await checkOneDuplicate(
      candidate('portable-morning-recapture'),
      [existingLog('portable-morning', 'different-profile')],
    );

    expect(match?.confidence).toBe('exact');
  });

  test.todo(
    'profile scoping: batch DB lookup should ignore another profile (known limitation: duplicate lookup currently filters only by logDate)',
  );

  test('quoted CSV exam titles retain embedded commas', async () => {
    const [study] = await new CSVImportProvider(quotedCommaCsv, '2026-07-13').importStudies();

    expect(study.examTitle).toBe('CT CHEST, ABDOMEN AND PELVIS W CONTRAST');
    expect(study.cpt).toBe('71260');
    expect(study.studyDate).toBe('2026-07-12');
    expect(study.studyTime).toBe('2026-07-12T13:45:00');
  });
});
