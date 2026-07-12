import { describe, expect, test } from 'bun:test';
import {
  buildAssistantContext,
  createAssistantArtifacts,
  generateFeedbackSummary,
  proposeAssistantResponse,
} from '../src/web/services/aiReviewAssistantService';
import type { PipelineReviewRow } from '../src/web/pipeline/importPipeline';
import type { ImportedStudy } from '../src/web/types/importProvider';
import type { MatchCandidate, Modality } from '../src/web/types';

function candidate(cptCode: string, description = `CPT ${cptCode}`): MatchCandidate {
  return {
    cptCode,
    modifier: '26',
    description,
    workRvu: 1,
    modality: 'XR' as Modality,
    confidence: 0.98,
    method: 'radiology_match',
    explanation: {
      rawText: description,
      normalizedText: description.toLowerCase(),
      source: 'Institution procedure dictionary',
      detail: 'test',
    },
  };
}

function row(patch: Partial<ImportedStudy> = {}, rowPatch: Partial<PipelineReviewRow> = {}): PipelineReviewRow {
  const source: ImportedStudy = {
    source: 'ocr',
    examTitle: 'XR CHEST PORTABLE',
    procedureName: 'XR CHEST PORTABLE',
    canonicalExam: null,
    cpt: null,
    workRvu: null,
    studyDate: '2026-07-08',
    examDate: '2026-07-08',
    examTime: '08:19',
    examDateTime: '2026-07-08T08:19',
    studyTime: '2026-07-08T08:36',
    modifiedDate: '2026-07-08',
    modifiedTime: '08:36',
    modifiedDateTime: '2026-07-08T08:36',
    modality: 'XR',
    accessionNumber: null,
    patientMRN: 'SECRET-MRN',
    rowIndex: null,
    cleanedExamName: 'XR CHEST PORTABLE',
    cleanedText: 'XR CHEST PORTABLE',
    extractionConfidence: 0.86,
    parserNeedsReview: false,
    parserReviewReason: null,
    parserRawLine: 'XR CHEST PORTABLE',
    ocrConfidence: 0.9,
    importedAt: '2026-07-08T08:40:00.000Z',
    dateTimeConfidence: 1,
    dateTimeSource: 'ocr',
    ...patch,
  };

  return {
    tempId: 'row-1',
    source,
    candidates: [candidate('71045', 'XR Chest 1 View')],
    selectedCandidateIndex: 0,
    selectedCandidateIndices: [0],
    displayTitle: source.procedureName ?? source.examTitle,
    needsReview: false,
    duplicateStatus: null,
    duplicateExistingLogId: null,
    duplicateReason: null,
    included: true,
    autoSkipped: false,
    autoApproved: false,
    autoApprovalLevel: null,
    reviewReason: null,
    ...rowPatch,
  };
}

const baseInput = (reviewRow: PipelineReviewRow, requestText: string) => ({
  requestText,
  profileId: 'profile-1',
  siteId: 'site-1',
  sessionId: 'session-1',
  logDate: '2026-07-08',
  row: reviewRow,
  rowIndex: 0,
  rows: [reviewRow],
});

describe('AI Review Assistant service', () => {
  test('creates feedback context from review row without PHI fields', () => {
    const reviewRow = row();
    const context = buildAssistantContext(baseInput(reviewRow, 'Wrong CPT'));
    const serialized = JSON.stringify(context);

    expect(context.rawProcedureText).toBe('XR CHEST PORTABLE');
    expect(context.selectedCpts).toEqual(['71045']);
    expect(serialized).not.toContain('SECRET-MRN');
    expect(serialized).not.toContain('patientMRN');
  });

  test('identifies merged OCR rows and proposes a user-approved split', () => {
    const reviewRow = row({
      examTitle: 'CTCHESTABDUOMEN PELVIS W CONTRAST v 28 CT CARDIAC SCORING 08',
      procedureName: 'CTCHESTABDUOMEN PELVIS W CONTRAST v 28 CT CARDIAC SCORING 08',
      parserRawLine: 'CTCHESTABDUOMEN PELVIS W CONTRAST v 28 CT CARDIAC SCORING 08',
    }, {
      candidates: [],
      selectedCandidateIndex: null,
      selectedCandidateIndices: [],
      needsReview: true,
    });

    const response = proposeAssistantResponse(baseInput(reviewRow, 'This is two exams recognized as one.'));
    const split = response.proposedActions.find((action) => action.actionType === 'split_merged_row');

    expect(response.problemType).toBe('merged_ocr_rows');
    expect(split?.requiresUserApproval).toBe(true);
    expect(split?.proposedNewRows?.map((proposed) => proposed.procedureName)).toEqual([
      'CT CHEST ABDOMEN PELVIS W CONTRAST',
      'CT CARDIAC SCORING',
    ]);
    expect(split?.proposedNewRows?.every((proposed) => proposed.dateTimePairingConfidence === 0)).toBe(true);
  });

  test('resolves damaged chest portable request to protected title and CPT intent', () => {
    const reviewRow = row({
      examTitle: 'XRCHESTPORFABLE',
      procedureName: 'XRCHESTPORFABLE',
      cleanedExamName: 'XRCHESTPORFABLE',
      cleanedText: 'XRCHESTPORFABLE',
      parserRawLine: 'XRCHESTPORFABLE',
    });

    const response = proposeAssistantResponse(baseInput(reviewRow, 'This should be XR chest portable.'));
    const correction = response.proposedActions.find((action) => action.actionType === 'correct_exam_title');

    expect(correction?.proposedTitle).toBe('XR CHEST PORTABLE');
    expect(correction?.proposedCptCodes).toEqual(['71045']);
    expect(correction?.requiresUserApproval).toBe(true);
  });

  test('not duplicate request proposes current-session duplicate override only', () => {
    const reviewRow = row({}, {
      duplicateStatus: 'exact',
      duplicateReason: 'Duplicate within this import batch',
      autoSkipped: true,
    });

    const response = proposeAssistantResponse(baseInput(reviewRow, 'This is not a duplicate.'));
    const action = response.proposedActions.find((proposed) => proposed.actionType === 'mark_not_duplicate');

    expect(response.problemType).toBe('wrong_duplicate');
    expect(action?.requiresUserApproval).toBe(true);
    expect(action?.explanation).toContain('current review session');
  });

  test('why in review returns an explanation without proposing an unsafe change', () => {
    const reviewRow = row({}, {
      needsReview: true,
      reviewReason: 'Multiple possible CPT matches',
    });

    const response = proposeAssistantResponse(baseInput(reviewRow, 'Why is this in review?'));

    expect(response.proposedActions).toEqual([]);
    expect(response.explanation).toBe('Multiple possible CPT matches');
    expect(response.requiresUserApproval).toBe(false);
  });

  test('assistant artifacts include feedback event and correction action', () => {
    const reviewRow = row({
      examTitle: 'XRCHESTPORFABLE',
      procedureName: 'XRCHESTPORFABLE',
      cleanedExamName: 'XRCHESTPORFABLE',
      cleanedText: 'XRCHESTPORFABLE',
    });

    const artifacts = createAssistantArtifacts(baseInput(reviewRow, 'This should be XR chest portable.'));

    expect(artifacts.feedbackEvent.category).toBe('bad_exam_cleanup');
    expect(artifacts.feedbackEvent.rawProcedureText).toBe('XRCHESTPORFABLE');
    expect(artifacts.correctionActions.some((action) => action.actionType === 'correct_exam_title')).toBe(true);
  });

  test('developer summary produces Codex-ready prompt from feedback events', () => {
    const artifacts = createAssistantArtifacts(baseInput(row(), 'This is not a duplicate.'));
    const summary = generateFeedbackSummary([artifacts.feedbackEvent]);

    expect(summary.topRecurringIssues[0]).toContain('wrong duplicate');
    expect(summary.codexPrompt).toContain('Problem statement');
    expect(summary.codexPrompt).toContain('Tests required');
  });
});
