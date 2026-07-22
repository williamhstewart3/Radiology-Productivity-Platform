import { describe, expect, test } from 'bun:test';
import {
  CAPTURE_PRIVACY_COPY,
  CAPTURE_PROCESSING_LABEL,
  CAPTURE_PROMPT_TITLE,
  formatOcrDateTime,
  shouldShowAccession,
  shouldAutoProcessPowerScribeCaptures,
  shouldAutoProcessRecognizedCapture,
  approvalButtonLabel,
  buildUserApprovalPatch,
  canApproveReviewRow,
  hasValidSelectedProductivityRvu,
  isRowFinalizableAfterApproval,
  reviewRowStatusLabel,
  summarizeReviewApproval,
} from '../src/web/pages/Import';
import { isReviewRowSaveEligible, type PipelineReviewRow } from '../src/web/pipeline/importPipeline';
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

describe('import review date-time formatting', () => {
  test('displays fallback datetime time when separate date is present', () => {
    expect(formatOcrDateTime('2026-07-08', null, '2026-07-08T21:05:00')).toBe('7/8/26 9:05 PM');
  });

  test('displays explicit OCR time when available', () => {
    expect(formatOcrDateTime('2026-07-08', '08:19', '2026-07-08T21:05:00')).toBe('7/8/26 8:19 AM');
  });

  test('hides accession line when PowerScribe OCR has no real accession', () => {
    expect(shouldShowAccession(null)).toBe(false);
    expect(shouldShowAccession('')).toBe(false);
    expect(shouldShowAccession('ACC12345')).toBe(true);
  });

  test('uses broad capture processing language instead of OCR-only language', () => {
    expect(CAPTURE_PROCESSING_LABEL).toBe('Processing...');
    expect(CAPTURE_PROCESSING_LABEL).not.toMatch(/Running OCR/i);
  });

  test('PowerScribe capture prompt explains memory processing and stored data scope', () => {
    expect(CAPTURE_PROMPT_TITLE).toBe('PowerScribe capture detected');
    expect(CAPTURE_PRIVACY_COPY).toContain('processed in memory');
    expect(CAPTURE_PRIVACY_COPY).toContain('discarded after parsing');
    expect(CAPTURE_PRIVACY_COPY).toContain('Only extracted productivity data is stored');
  });

  test('always-process setting controls future capture confirmation bypass', () => {
    expect(shouldAutoProcessPowerScribeCaptures({ alwaysProcessPowerScribeClipboard: true })).toBe(true);
    expect(shouldAutoProcessPowerScribeCaptures({ alwaysProcessPowerScribeClipboard: false })).toBe(false);
    expect(shouldAutoProcessPowerScribeCaptures(null)).toBe(false);
  });

  test('auto-process never bypasses preview for an unrecognized capture', () => {
    expect(shouldAutoProcessRecognizedCapture(true, { alwaysProcessPowerScribeClipboard: true })).toBe(true);
    expect(shouldAutoProcessRecognizedCapture(false, { alwaysProcessPowerScribeClipboard: true })).toBe(false);
    expect(shouldAutoProcessRecognizedCapture(true, { alwaysProcessPowerScribeClipboard: false })).toBe(false);
  });
});

describe('import review approval workflow', () => {
  test('review row with selected CPT/RVU shows universal approval state', () => {
    const reviewRow = row();

    expect(hasValidSelectedProductivityRvu(reviewRow)).toBe(true);
    expect(canApproveReviewRow(reviewRow)).toBe(true);
    expect(approvalButtonLabel(reviewRow)).toBe('Approve');
    expect(reviewRowStatusLabel(reviewRow)).toBe('Pending approval');
  });

  test('possible duplicate can be approved as new', () => {
    const reviewRow = row({
      duplicateStatus: 'possible',
      duplicateReason: 'Possible duplicate - missing time',
    });

    expect(approvalButtonLabel(reviewRow)).toBe('Approve as new');
    const patch = buildUserApprovalPatch(reviewRow);

    expect(patch).toMatchObject({
      needsReview: false,
      duplicateStatus: null,
      approvalStatus: 'approved_as_new',
    });
  });

  test('rows without valid modifier 26 RVU require CPT assignment', () => {
    const reviewRow = row({
      candidates: [candidate({ modifier: 'TC', workRvu: 0 })],
    });

    expect(hasValidSelectedProductivityRvu(reviewRow)).toBe(false);
    expect(canApproveReviewRow(reviewRow)).toBe(false);
    expect(approvalButtonLabel(reviewRow)).toBe('Add CPT');
    expect(reviewRowStatusLabel(reviewRow)).toBe('Missing CPT/RVU');
  });

  test('approval summary separates finalizable and pending RVUs', () => {
    const approved = row({ tempId: 'approved', needsReview: false, approvalStatus: 'manual_approved' });
    const pending = row({ tempId: 'pending', needsReview: true });
    const possible = row({ tempId: 'possible', needsReview: true, duplicateStatus: 'possible' });
    const excluded = row({ tempId: 'excluded', included: false, approvalStatus: 'excluded' });
    const exactSkipped = row({ tempId: 'skipped', included: false, duplicateStatus: 'exact', autoSkipped: true });

    const summary = summarizeReviewApproval([approved, pending, possible, excluded], [exactSkipped]);

    expect(summary.finalizableRows).toBe(1);
    expect(summary.finalizableWrvu).toBe(0.18);
    expect(summary.pendingRows).toBe(2);
    expect(summary.pendingWrvu).toBe(0.36);
    expect(summary.possibleDuplicateRows).toBe(1);
    expect(summary.exactDuplicateRows).toBe(1);
    expect(summary.excludedRows).toBe(1);
  });

  test('pending warning row is not finalizable until explicitly approved', () => {
    const pending = row({ needsReview: true, approvalStatus: 'pending' });
    const staleApproved = row({ needsReview: true, approvalStatus: 'manual_approved' });
    const approvedAsNew = row({ needsReview: true, duplicateStatus: 'possible', approvalStatus: 'approved_as_new' });

    expect(isRowFinalizableAfterApproval(pending)).toBe(false);
    expect(isReviewRowSaveEligible(pending)).toBe(false);
    expect(isRowFinalizableAfterApproval(staleApproved)).toBe(true);
    expect(isReviewRowSaveEligible(staleApproved)).toBe(true);
    expect(isRowFinalizableAfterApproval(approvedAsNew)).toBe(true);
    expect(isReviewRowSaveEligible(approvedAsNew)).toBe(true);
  });
});
