import { describe, expect, test } from 'bun:test';
import { resolvePowerScribeProductivityDates } from '../src/web/pipeline/importPipeline';
import { StructuredPowerScribeOcrImportProvider } from '../src/web/providers/StructuredPowerScribeOcrImportProvider';

describe('StructuredPowerScribeOcrImportProvider', () => {
  test('maps structured helper rows without appending dates to procedureName', async () => {
    const provider = new StructuredPowerScribeOcrImportProvider([
      {
        procedureName: 'XR CHEST PORTABLE',
        examDateTime: '2026-07-01T17:18',
        modifiedDateTime: '2026-07-02T07:59',
        rawProcedureText: 'XR CHEST PORTABLE',
        rawExamDateText: '7/1/2026 5:18 PM',
        rawModifiedText: '7/2/2026 7:59 AM',
        confidence: 0.96,
        needsReview: false,
        reviewReason: null,
      },
    ], '2026-07-03');

    const studies = await provider.importStudies();
    expect(studies).toHaveLength(1);
    expect(studies[0].procedureName).toBe('XR CHEST PORTABLE');
    expect(studies[0].examTitle).toBe('XR CHEST PORTABLE');
    expect(studies[0].cleanedText).toBe('XR CHEST PORTABLE');
    expect(studies[0].examDateTime).toBe('2026-07-01T17:18:00');
    expect(studies[0].modifiedDateTime).toBe('2026-07-02T07:59:00');
    expect(studies[0].studyTime).toBe('2026-07-02T07:59:00');
    expect(studies[0].studyDate).toBe('2026-07-02');
    expect(studies[0].modifiedDate).toBe('2026-07-02');
    expect(studies[0].accessionNumber).toBeNull();
    expect(studies[0].parserNeedsReview).toBe(false);
  });

  test('keeps unclear rows visible for review', async () => {
    const provider = new StructuredPowerScribeOcrImportProvider([
      {
        procedureName: 'UNCLEAR POWERSCRIBE ROW',
        examDateTime: null,
        modifiedDateTime: '2026-07-02T07:59',
        rawProcedureText: '',
        rawExamDateText: '',
        rawModifiedText: '7/2/2026 7:59 AM',
        confidence: 0.4,
        needsReview: true,
        reviewReason: 'Unclear PowerScribe procedure text',
      },
    ], '2026-07-03');

    const studies = await provider.importStudies();
    expect(studies).toHaveLength(1);
    expect(studies[0].procedureName).toBe('UNCLEAR POWERSCRIBE ROW');
    expect(studies[0].parserNeedsReview).toBe(true);
    expect(studies[0].parserReviewReason).toBe('Unclear PowerScribe procedure text');
  });

  test('preserves compact OCR date-times from independent date columns', async () => {
    const provider = new StructuredPowerScribeOcrImportProvider([
      {
        procedureName: 'XR CHEST PORTABLE',
        examDateTime: null,
        modifiedDateTime: null,
        rawProcedureText: 'XR CHEST PORTABLE',
        rawExamDateText: '7/8/26 819 AM',
        rawModifiedText: '7/8/26 905 PM',
        confidence: 0.9,
        needsReview: false,
        reviewReason: null,
      },
    ], '2026-07-08');

    const studies = await provider.importStudies();
    expect(studies[0].examDateTime).toBe('2026-07-08T08:19:00');
    expect(studies[0].modifiedDateTime).toBe('2026-07-08T21:05:00');
    expect(studies[0].studyTime).toBe('2026-07-08T21:05:00');
    expect(studies[0].studyDate).toBe('2026-07-08');
  });

  test('maps row-specific exam and modified date-times from separate columns', async () => {
    const provider = new StructuredPowerScribeOcrImportProvider([
      {
        procedureName: 'XR ABDOMEN AP',
        examDateTime: null,
        modifiedDateTime: null,
        rawProcedureText: 'XR ABDOMEN AP',
        rawExamDateText: '7/1/2026 8:28 PM',
        rawModifiedText: '7/2/2026 8:17 AM',
        confidence: 0.9,
        needsReview: false,
        reviewReason: null,
      },
    ], '2026-07-08');

    const studies = await provider.importStudies();
    expect(studies[0].examDateTime).toBe('2026-07-01T20:28:00');
    expect(studies[0].modifiedDateTime).toBe('2026-07-02T08:17:00');
    expect(studies[0].studyTime).toBe('2026-07-02T08:17:00');
    expect(studies[0].examDateTime).not.toBe('2026-07-11T20:28:00');
    expect(studies[0].modifiedDateTime).not.toBe(studies[0].examDateTime);
  });

  test('does not copy examDateTime into modifiedDateTime when modified column is missing', async () => {
    const provider = new StructuredPowerScribeOcrImportProvider([
      {
        procedureName: 'XR ABDOMEN AP',
        examDateTime: null,
        modifiedDateTime: null,
        rawProcedureText: 'XR ABDOMEN AP',
        rawExamDateText: '7/1/2026 8:28 PM',
        rawModifiedText: '',
        confidence: 0.62,
        needsReview: true,
        reviewReason: null,
      },
    ], '2026-07-08');

    const studies = await provider.importStudies();
    expect(studies[0].examDateTime).toBe('2026-07-01T20:28:00');
    expect(studies[0].modifiedDateTime).toBeNull();
    expect(studies[0].studyTime).toBeNull();
    expect(studies[0].studyDate).toBe('2026-07-08');
    expect(studies[0].modifiedDate).toBeNull();
    expect(studies[0].parserNeedsReview).toBe(true);
    expect(studies[0].parserReviewReason).toContain('Missing Modified time/date');
  });

  test('selected import log date does not override parsed modified productivity date', async () => {
    const provider = new StructuredPowerScribeOcrImportProvider([
      {
        procedureName: 'XR CHEST PORTABLE',
        examDateTime: '2026-07-01T17:18',
        modifiedDateTime: '2026-07-02T07:59',
        rawProcedureText: 'XR CHEST PORTABLE',
        rawExamDateText: '7/1/2026 5:18 PM',
        rawModifiedText: '7/2/2026 7:59 AM',
        confidence: 0.96,
        needsReview: false,
        reviewReason: null,
      },
    ], '2026-07-09');

    const [study] = await provider.importStudies();
    const dates = resolvePowerScribeProductivityDates(study, '2026-07-09');

    expect(study.examDate).toBe('2026-07-01');
    expect(study.examDateTime).toBe('2026-07-01T17:18:00');
    expect(study.modifiedDate).toBe('2026-07-02');
    expect(study.modifiedDateTime).toBe('2026-07-02T07:59:00');
    expect(study.studyDate).toBe('2026-07-02');
    expect(dates.performedDate).toBe('2026-07-01');
    expect(dates.productivityDate).toBe('2026-07-02');
    expect(dates.productivityDate).not.toBe('2026-07-09');
  });

  test('missing modified date falls back to selected log date instead of exam date', async () => {
    const provider = new StructuredPowerScribeOcrImportProvider([
      {
        procedureName: 'XR ABDOMEN AP',
        examDateTime: '2026-07-01T20:28',
        modifiedDateTime: null,
        rawProcedureText: 'XR ABDOMEN AP',
        rawExamDateText: '7/1/2026 8:28 PM',
        rawModifiedText: '',
        confidence: 0.7,
        needsReview: true,
        reviewReason: null,
      },
    ], '2026-07-09');

    const [study] = await provider.importStudies();
    const dates = resolvePowerScribeProductivityDates(study, '2026-07-09');

    expect(study.examDate).toBe('2026-07-01');
    expect(study.modifiedDate).toBeNull();
    expect(study.studyDate).toBe('2026-07-09');
    expect(study.parserNeedsReview).toBe(true);
    expect(dates.productivityDate).toBe('2026-07-09');
    expect(dates.productivityDate).not.toBe('2026-07-01');
  });
});
