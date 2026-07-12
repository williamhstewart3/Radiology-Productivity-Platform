import { describe, expect, test } from 'bun:test';
import { computeCardStatus, isBenignFlagRow } from '../src/web/pages/Import';
import { dedupeReasons } from '../src/web/utils/reviewReasons';
import type { PipelineReviewRow } from '../src/web/pipeline/importPipeline';
import type { ImportedStudy } from '../src/web/types/importProvider';
import type { MatchCandidate, Modality } from '../src/web/types';

function candidate(patch: Partial<MatchCandidate> = {}): MatchCandidate {
  return {
    cptCode: '71045',
    modifier: '26',
    description: 'XR Chest 1 View',
    workRvu: 0.18,
    modality: 'XR' as Modality,
    confidence: 0.94,
    method: 'radiology_match',
    explanation: {
      rawText: 'XR CHEST PORTABLE',
      normalizedText: 'XR CHEST PORTABLE',
      source: 'test',
      detail: 'test',
    },
    ...patch,
  };
}

function row(patch: Partial<PipelineReviewRow> = {}): PipelineReviewRow {
  const source: ImportedStudy = {
    source: 'ocr',
    examTitle: 'XR CHEST PORTABLE',
    procedureName: 'XR CHEST PORTABLE',
    canonicalExam: null,
    cpt: null,
    workRvu: null,
    studyDate: '2026-07-08',
    studyTime: '2026-07-08T08:19',
    examDate: '2026-07-08',
    examTime: '08:19',
    examDateTime: '2026-07-08T08:19',
    modifiedDate: '2026-07-08',
    modifiedTime: '08:25',
    modifiedDateTime: '2026-07-08T08:25',
    modality: 'XR',
    accessionNumber: null,
    patientMRN: null,
    rowIndex: null,
    cleanedExamName: 'XR CHEST PORTABLE',
    cleanedText: 'XR CHEST PORTABLE',
    extractionConfidence: 1,
    parserNeedsReview: false,
    parserReviewReason: null,
    parserRawLine: 'XR CHEST PORTABLE',
    ocrConfidence: 1,
    importedAt: '2026-07-08T08:30:00.000Z',
    dateTimeConfidence: 1,
    dateTimeSource: 'ocr',
  };

  return {
    tempId: 'row-1',
    source,
    candidates: [candidate()],
    selectedCandidateIndex: 0,
    selectedCandidateIndices: [0],
    displayTitle: 'XR CHEST PORTABLE',
    needsReview: true,
    duplicateStatus: null,
    duplicateExistingLogId: null,
    duplicateReason: null,
    included: true,
    autoSkipped: false,
    autoApproved: false,
    autoApprovalLevel: null,
    approvalStatus: 'pending',
    reviewReason: null,
    ...patch,
  };
}

describe('dedupeReasons', () => {
  test('the same phrase joined with different separators collapses to one occurrence', () => {
    const result = dedupeReasons('Missing or unclear Exam Date; Missing or unclear Modified Date', 'Missing or unclear Exam Date; Missing or unclear Modified Date');
    expect(result).toBe('Missing or unclear Exam Date; Missing or unclear Modified Date');
  });

  test('distinct reasons from different layers are combined, each appearing once', () => {
    const result = dedupeReasons('Missing or unclear Exam Date', 'Low confidence match');
    expect(result).toBe('Missing or unclear Exam Date; Low confidence match');
  });

  test('null/empty inputs are ignored', () => {
    expect(dedupeReasons(null, undefined, '')).toBeNull();
    expect(dedupeReasons(null, 'Low confidence')).toBe('Low confidence');
  });
});

describe('computeCardStatus — single badge', () => {
  test('excluded row is gray "Excluded"', () => {
    const status = computeCardStatus(row({ included: false }));
    expect(status).toEqual({ label: 'Excluded', tone: 'gray' });
  });

  test('possible duplicate takes priority and is amber "Possible duplicate"', () => {
    const status = computeCardStatus(row({ duplicateStatus: 'possible', needsReview: true }));
    expect(status).toEqual({ label: 'Possible duplicate', tone: 'amber' });
  });

  test('missing exam/modified date reason is amber "Check dates"', () => {
    const status = computeCardStatus(row({ needsReview: true, reviewReason: 'Missing or unclear Exam Date' }));
    expect(status).toEqual({ label: 'Check dates', tone: 'amber' });
  });

  test('no valid CPT selected is amber "Check CPT"', () => {
    const status = computeCardStatus(row({ needsReview: true, candidates: [], selectedCandidateIndex: null, selectedCandidateIndices: [] }));
    expect(status).toEqual({ label: 'Check CPT', tone: 'amber' });
  });

  test('a row with a valid CPT, valid dates, and no reason is green "Ready to approve"', () => {
    const status = computeCardStatus(row({ needsReview: true, reviewReason: null }));
    expect(status).toEqual({ label: 'Ready to approve', tone: 'green' });
  });

  test('exactly one badge is ever produced for a row with multiple problems', () => {
    const status = computeCardStatus(row({
      needsReview: true,
      duplicateStatus: 'possible',
      reviewReason: 'Missing or unclear Exam Date',
      candidates: [],
      selectedCandidateIndex: null,
      selectedCandidateIndices: [],
    }));
    expect(['Excluded', 'Possible duplicate', 'Check dates', 'Check CPT', 'Ready to approve']).toContain(status.label);
  });
});

describe('isBenignFlagRow — "Approve all ready" eligibility', () => {
  test('a benign, needs-review row with valid CPT and dates is ready', () => {
    expect(isBenignFlagRow(row({ needsReview: true, reviewReason: null }))).toBe(true);
  });

  test('a date-flagged row is not benign', () => {
    expect(isBenignFlagRow(row({ needsReview: true, reviewReason: 'Missing or unclear Modified Date' }))).toBe(false);
  });

  test('a possible-duplicate row is not benign', () => {
    expect(isBenignFlagRow(row({ needsReview: true, duplicateStatus: 'possible' }))).toBe(false);
  });

  test('an already-approved row is not in the "ready" bucket (nothing left to approve)', () => {
    expect(isBenignFlagRow(row({ needsReview: false }))).toBe(false);
  });
});
