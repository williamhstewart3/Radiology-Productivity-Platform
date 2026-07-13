import { describe, expect, test } from 'bun:test';
import { approveInboxRow, confidencePhrase, formatInboxAccounting, summarizeInboxAccounting } from '../src/web/services/inboxService';
import type { PipelineReviewRow } from '../src/web/pipeline/importPipeline';

function pendingRow(duplicateStatus: PipelineReviewRow['duplicateStatus'], hasCandidate: boolean): PipelineReviewRow {
  return {
    candidates: hasCandidate
      ? [{ cptCode: '74177', modifier: '26', description: 'CT abd/pelvis', workRvu: 3.15, modality: 'CT', confidence: 0.8, method: 'radiology_match' }]
      : [],
    selectedCandidateIndex: hasCandidate ? 0 : null,
    selectedCandidateIndices: hasCandidate ? [0] : [],
    duplicateStatus,
    included: true,
    autoSkipped: false,
    needsReview: true,
  } as PipelineReviewRow;
}

describe('Inbox confidence language', () => {
  test('maps every matcher situation to a human phrase', () => {
    expect(confidencePhrase('alias_match', true)).toBe('Learned match');
    expect(confidencePhrase('manual_cpt', true)).toBe('Direct match');
    expect(confidencePhrase('ocr_match', true)).toBe('Protocol match');
    expect(confidencePhrase('radiology_match', true)).toBe('Fuzzy match — worth a look');
    expect(confidencePhrase(undefined, false)).toBe('No confident match');
  });

  test('approval preserves the pipeline row contract', () => {
    const row = {
      candidates: [{ cptCode: '70450', modifier: '26', description: 'CT head', workRvu: 0.83, modality: 'CT', confidence: 0.8, method: 'radiology_match' }],
      selectedCandidateIndex: 0,
      selectedCandidateIndices: [0],
      duplicateStatus: 'possible',
      included: true,
      autoSkipped: false,
      needsReview: true,
    } as PipelineReviewRow;
    expect(approveInboxRow(row)).toMatchObject({ needsReview: false, approvalStatus: 'approved_as_new' });
  });
});

describe('summarizeInboxAccounting — the permanent batch-accounting line', () => {
  test('null when there is no active session or it is empty', () => {
    expect(summarizeInboxAccounting(null, [])).toBeNull();
    expect(summarizeInboxAccounting({ totalExams: 0, needsReviewCount: 0, confirmedWrvu: 0 }, [])).toBeNull();
  });

  test('readyCount is totalExams minus needsReviewCount, readyWrvu is the session confirmedWrvu directly', () => {
    const summary = summarizeInboxAccounting({ totalExams: 11, needsReviewCount: 2, confirmedWrvu: 27.45 }, []);
    expect(summary).toMatchObject({ totalRows: 11, readyCount: 9, readyWrvu: 27.45 });
  });

  test('possibleDuplicateCount and needsCptCount are counted from the pending rows, mutually exclusive', () => {
    const pending = [
      pendingRow('possible', true), // possible duplicate
      pendingRow(null, false), // needs CPT
      pendingRow(null, true), // ordinary review row — neither bucket
    ];
    const summary = summarizeInboxAccounting({ totalExams: 11, needsReviewCount: 3, confirmedWrvu: 12.6 }, pending);
    expect(summary).toMatchObject({ possibleDuplicateCount: 1, needsCptCount: 1 });
  });

  test('a possible-duplicate row with no candidate is not double-counted as needing a CPT', () => {
    const summary = summarizeInboxAccounting({ totalExams: 1, needsReviewCount: 1, confirmedWrvu: 0 }, [pendingRow('possible', false)]);
    expect(summary).toMatchObject({ possibleDuplicateCount: 1, needsCptCount: 0 });
  });
});

describe('formatInboxAccounting', () => {
  test('shows the ready wRVU total (the auto-approved batch summary), omits zero-value duplicate/CPT segments', () => {
    expect(formatInboxAccounting({ totalRows: 11, readyCount: 9, readyWrvu: 27.4, possibleDuplicateCount: 0, needsCptCount: 0 }))
      .toBe('11 rows · 9 ready (+27.4 wRVU)');
  });

  test('appends non-zero segments, matching the spec\'s example line', () => {
    expect(formatInboxAccounting({ totalRows: 11, readyCount: 9, readyWrvu: 27.4, possibleDuplicateCount: 1, needsCptCount: 1 }))
      .toBe('11 rows · 9 ready (+27.4 wRVU) · 1 possible duplicate · 1 needs CPT');
  });

  test('omits the wRVU parenthetical when nothing is ready yet', () => {
    expect(formatInboxAccounting({ totalRows: 2, readyCount: 0, readyWrvu: 0, possibleDuplicateCount: 2, needsCptCount: 0 }))
      .toBe('2 rows · 0 ready · 2 possible duplicates');
  });

  test('singular/plural agreement on rows', () => {
    expect(formatInboxAccounting({ totalRows: 1, readyCount: 1, readyWrvu: 3.4, possibleDuplicateCount: 0, needsCptCount: 0 }))
      .toBe('1 row · 1 ready (+3.4 wRVU)');
  });
});
