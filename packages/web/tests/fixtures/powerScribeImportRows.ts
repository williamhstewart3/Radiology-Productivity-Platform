import type { PowerScribeStructuredOcrRow } from '../../src/web/types/structuredOcr';

export interface PowerScribeImportRowFixture {
  id: string;
  cptCodes: string[];
  rawOcrText: string;
  expectedProcedureName: string;
  expectedExamDateTime: string;
  expectedModifiedDateTime: string;
  structured: PowerScribeStructuredOcrRow;
}

function row(
  fixture: Omit<PowerScribeImportRowFixture, 'structured'>,
): PowerScribeImportRowFixture {
  const [rawProcedureText, rawExamDateText, rawModifiedText] = fixture.rawOcrText.split(' | ');
  return {
    ...fixture,
    structured: {
      procedureName: fixture.expectedProcedureName,
      examDateTime: fixture.expectedExamDateTime,
      modifiedDateTime: fixture.expectedModifiedDateTime,
      rawProcedureText,
      rawExamDateText,
      rawModifiedText,
      confidence: 0.98,
      needsReview: false,
      reviewReason: null,
    },
  };
}

export const powerScribeImportRows: PowerScribeImportRowFixture[] = [
  row({
    id: 'portable-morning',
    cptCodes: ['71045'],
    rawOcrText: 'XR CHEST PORTABLE | 7/11/26 8:15 AM | 7/11/26 8:29 AM',
    expectedProcedureName: 'XR CHEST PORTABLE',
    expectedExamDateTime: '2026-07-11T08:15:00',
    expectedModifiedDateTime: '2026-07-11T08:29:00',
  }),
  row({
    id: 'portable-afternoon-same-cpt',
    cptCodes: ['71045'],
    rawOcrText: 'XR CHEST PORTABLE | 7/11/26 2:15 PM | 7/11/26 2:30 PM',
    expectedProcedureName: 'XR CHEST PORTABLE',
    expectedExamDateTime: '2026-07-11T14:15:00',
    expectedModifiedDateTime: '2026-07-11T14:30:00',
  }),
  row({
    id: 'portable-morning-recapture',
    cptCodes: ['71045'],
    rawOcrText: 'XR CHEST PORTABLE | 7/11/26 8:15 AM | 7/11/26 8:29 AM',
    expectedProcedureName: 'XR CHEST PORTABLE',
    expectedExamDateTime: '2026-07-11T08:15:00',
    expectedModifiedDateTime: '2026-07-11T08:29:00',
  }),
  row({
    id: 'portable-addendum',
    cptCodes: ['71045'],
    rawOcrText: 'XR CHEST PORTABLE | 7/11/26 8:15 AM | 7/11/26 10:42 AM',
    expectedProcedureName: 'XR CHEST PORTABLE',
    expectedExamDateTime: '2026-07-11T08:15:00',
    expectedModifiedDateTime: '2026-07-11T10:42:00',
  }),
  row({
    id: 'midnight-oblique-misspelling',
    cptCodes: ['73110'],
    rawOcrText: 'XR WRIST RIGHT PA LATERAL AND OBLIGUE | 7/12/26 12:00 AM | 7/12/26 12:07 AM',
    expectedProcedureName: 'XR WRIST RIGHT PA LATERAL AND OBLIQUE',
    expectedExamDateTime: '2026-07-12T00:00:00',
    expectedModifiedDateTime: '2026-07-12T00:07:00',
  }),
  row({
    id: 'modified-at-midnight',
    cptCodes: ['71045'],
    rawOcrText: 'XR CHEST PORTABLE | 7/11/26 11:58 PM | 7/12/26 12:00 AM',
    expectedProcedureName: 'XR CHEST PORTABLE',
    expectedExamDateTime: '2026-07-11T23:58:00',
    expectedModifiedDateTime: '2026-07-12T00:00:00',
  }),
];

export const quotedCommaCsv = [
  'examTitle,cpt,studyDate,studyTime,modality',
  '"CT CHEST, ABDOMEN AND PELVIS W CONTRAST",71260,2026-07-12,"2026-07-12T13:45:00",CT',
].join('\n');
