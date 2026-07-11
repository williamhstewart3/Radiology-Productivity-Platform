import { describe, expect, test } from 'bun:test';
import { reconciliationWarningFor, __testForceReviewForReconciliation } from '../src/web/services/ocrWorkflowService';
import type { PipelineReviewRow } from '../src/web/pipeline/importPipeline';
import type { ImportedStudy } from '../src/web/types/importProvider';

function row(overrides: Partial<PipelineReviewRow> = {}): PipelineReviewRow {
  const source: ImportedStudy = {
    examTitle: 'XR CHEST PORTABLE',
    procedureName: 'XR CHEST PORTABLE',
    canonicalExam: null,
    cpt: null,
    workRvu: null,
    studyDate: '2026-07-01',
    modality: 'XR',
    accessionNumber: null,
    patientMRN: null,
    studyTime: null,
    source: 'ocr',
    importedAt: new Date().toISOString(),
    dateTimeConfidence: 1,
    dateTimeSource: 'ocr',
  };
  return {
    tempId: crypto.randomUUID(),
    source,
    candidates: [],
    selectedCandidateIndex: null,
    selectedCandidateIndices: [],
    needsReview: false,
    duplicateStatus: null,
    duplicateExistingLogId: null,
    duplicateReason: null,
    included: true,
    autoSkipped: false,
    autoApproved: true,
    autoApprovalLevel: 'silent',
    approvalStatus: 'auto_approved',
    reviewReason: null,
    ...overrides,
  };
}

describe('reconciliation gate — trigger condition', () => {
  test('bandCount 60 vs inkEstimate 68 (spread 8) triggers the gate', () => {
    const warning = reconciliationWarningFor({
      cropMethod: 'header-anchor',
      anchorCount: 60,
      procedureLineCount: 68,
      examLineCount: 60,
      modifiedLineCount: 60,
      bandCount: 60,
      suspectedMissedRows: 3,
      inkProjectionRowEstimate: 68,
    });

    expect(warning).not.toBeNull();
    expect(warning).toContain('anchors=60');
    expect(warning).toContain('bands=60');
    expect(warning).toContain('ink-estimate=68');
  });

  test('a spread of 2 or less does not trigger the gate', () => {
    const warning = reconciliationWarningFor({
      cropMethod: 'header-anchor',
      anchorCount: 60,
      procedureLineCount: 60,
      examLineCount: 60,
      modifiedLineCount: 60,
      bandCount: 61,
      suspectedMissedRows: 0,
      inkProjectionRowEstimate: 62,
    });

    expect(warning).toBeNull();
  });

  test('no accounting data means no gate (helper is an old array-shaped response)', () => {
    expect(reconciliationWarningFor(null)).toBeNull();
    expect(reconciliationWarningFor(undefined)).toBeNull();
  });
});

describe('reconciliation gate — forces the whole batch to review', () => {
  test('every row loses auto-approval and needsReview becomes true', () => {
    const rows = [
      row({ needsReview: false, autoApproved: true, autoApprovalLevel: 'silent', approvalStatus: 'auto_approved' }),
      row({ needsReview: false, autoApproved: false, autoApprovalLevel: null, approvalStatus: 'manual_approved' }),
    ];

    const forced = __testForceReviewForReconciliation(rows);

    expect(forced.every((r) => r.needsReview)).toBe(true);
    expect(forced.every((r) => !r.autoApproved)).toBe(true);
    expect(forced.every((r) => r.autoApprovalLevel === null)).toBe(true);
    expect(forced[0].approvalStatus).toBe('pending');
    expect(forced[1].approvalStatus).toBe('manual_approved');
  });
});
