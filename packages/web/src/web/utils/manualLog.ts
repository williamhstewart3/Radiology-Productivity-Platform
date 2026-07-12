/**
 * manualLog.ts
 *
 * Shared "log one already-confirmed study" path — used by manual entry
 * (LogStudy) and Codes' "Add to today". Routes through the shared import
 * pipeline's commit function (commitPipelineResults) rather than a bespoke
 * direct DB write, so fingerprinting, alias learning, and Supabase sync are
 * centralized and consistent with every other import source.
 */

import { commitPipelineResults } from '../pipeline/importPipeline';
import type { CommitResult, PipelineReviewRow } from '../pipeline/importPipeline';
import type { ImportedStudy } from '../types/importProvider';
import type { MatchCandidate } from '../types';

export async function logConfirmedStudy(params: {
  examTitle: string;
  candidate: MatchCandidate;
  logDate: string;
  notes?: string | null;
  profileId: string | null;
}): Promise<CommitResult> {
  const study: ImportedStudy = {
    examTitle: params.examTitle.trim(),
    canonicalExam: null,
    cpt: params.candidate.cptCode,
    workRvu: params.candidate.workRvu,
    studyDate: params.logDate,
    studyTime: null,
    modality: params.candidate.modality,
    accessionNumber: null,
    patientMRN: null,
    source: 'manual',
    importedAt: new Date().toISOString(),
    dateTimeConfidence: 0,
    dateTimeSource: 'manual',
  };

  const row: PipelineReviewRow = {
    tempId: crypto.randomUUID(),
    source: study,
    candidates: [params.candidate],
    selectedCandidateIndex: 0,
    selectedCandidateIndices: [0],
    displayTitle: params.examTitle.trim(),
    needsReview: false,
    duplicateStatus: null,
    duplicateExistingLogId: null,
    duplicateReason: null,
    included: true,
    autoSkipped: false,
    autoApproved: true,
    autoApprovalLevel: null,
    approvalStatus: 'manual_approved',
    reviewReason: null,
    notes: params.notes?.trim() || null,
  };

  return commitPipelineResults([row], params.logDate, 0, params.profileId);
}
