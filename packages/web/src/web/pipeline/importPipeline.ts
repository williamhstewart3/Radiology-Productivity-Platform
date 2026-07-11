import { findMatchCandidates, learnAlias } from '../utils/matching';
import { checkBatchDuplicates, buildFingerprint, isStrongDuplicateFingerprint } from '../utils/duplicateDetection';
import { db } from '../db/database';
import { supabasePersistence } from '../services/supabasePersistence';
import { normalizeRadiologyDescription } from '../utils/radiologyDescriptionNormalization';
import type { MatchCandidate, StudyLog, DuplicateStatus } from '../types';
import type { ImportedStudy, ImportSource } from '../types/importProvider';
import type { StudyCandidate } from '../utils/duplicateDetection';

export interface PipelineReviewRow {
  tempId: string;
  source: ImportedStudy;
  candidates: MatchCandidate[];
  selectedCandidateIndex: number | null;
  selectedCandidateIndices: number[];
  displayTitle?: string;
  needsReview: boolean;
  duplicateStatus: DuplicateStatus;
  duplicateExistingLogId: string | null;
  duplicateReason: string | null;
  included: boolean;
  autoSkipped: boolean;
  autoApproved: boolean;
  autoApprovalLevel: 'silent' | 'learned' | null;
  approvalStatus?: 'pending' | 'manual_approved' | 'approved_as_new' | 'auto_approved' | 'excluded' | 'exact_duplicate_skipped';
  reviewReason: string | null;
}

export interface PipelineResult {
  reviewRows: PipelineReviewRow[];
  skippedRows: PipelineReviewRow[];
  sources: ImportSource[];
  profileId: string | null;
}

export interface CommitResult {
  importedCount: number;
  skippedCount: number;
  reviewNeededCount: number;
  alreadySavedCount: number;
  blockedNoValidCptCount: number;
}

function selectedCandidatesForRow(row: PipelineReviewRow): MatchCandidate[] {
  const selectedIndices =
    row.selectedCandidateIndices?.length
      ? row.selectedCandidateIndices
      : row.selectedCandidateIndex === null
        ? []
        : [row.selectedCandidateIndex];

  return selectedIndices
    .map((index) => row.candidates[index])
    .filter((candidate): candidate is MatchCandidate => Boolean(candidate));
}

function productivityRelevant(candidate: MatchCandidate): boolean {
  return candidate.modifier === '26' && (candidate.workRvu ?? 0) > 0;
}

export function isReviewRowSaveEligible(row: PipelineReviewRow): boolean {
  if (!row.included || row.autoSkipped || row.approvalStatus === 'excluded' || row.approvalStatus === 'exact_duplicate_skipped') {
    return false;
  }
  const selectedCandidates = selectedCandidatesForRow(row).filter(productivityRelevant);
  if (selectedCandidates.length === 0) return false;
  if (row.approvalStatus === 'auto_approved' || row.approvalStatus === 'manual_approved' || row.approvalStatus === 'approved_as_new') {
    return true;
  }
  return !row.needsReview;
}

function isDeterministicProtocolCandidate(candidate: MatchCandidate): boolean {
  return candidate.method === 'radiology_match' &&
    candidate.confidence >= 0.99 &&
    candidate.explanation?.source === 'deterministic protocol mapping';
}

function isInstitutionMappingCandidate(candidate: MatchCandidate): boolean {
  return candidate.method === 'radiology_match' &&
    candidate.confidence >= 0.95 &&
    (candidate.explanation?.source === 'Institution procedure dictionary' ||
      candidate.explanation?.source === 'Institution mapping');
}

function isExactInstitutionMappingCandidate(candidate: MatchCandidate): boolean {
  return isInstitutionMappingCandidate(candidate) && candidate.confidence >= 0.98;
}

function selectedDuplicateCptCodes(candidates: MatchCandidate[], directCpt: string | null): string[] {
  if (directCpt) return [directCpt];
  const institution = candidates
    .filter((candidate) => productivityRelevant(candidate) && isInstitutionMappingCandidate(candidate))
    .map((candidate) => candidate.cptCode);
  if (institution.length > 0) return [...new Set(institution)].sort();
  const deterministic = candidates
    .filter((candidate) => productivityRelevant(candidate) && isDeterministicProtocolCandidate(candidate))
    .map((candidate) => candidate.cptCode);
  if (deterministic.length > 0) return [...new Set(deterministic)].sort();
  const top = candidates.find(productivityRelevant);
  return top ? [top.cptCode] : [];
}

function reviewReasonFor(top: MatchCandidate | undefined, candidates: MatchCandidate[], duplicateStatus: DuplicateStatus, duplicateReason?: string | null): string | null {
  if (!top) return 'New or unknown exam';
  if (!productivityRelevant(top)) return 'Not modifier 26 productivity RVU';
  if (duplicateStatus === 'possible') return duplicateReason ?? 'Possible duplicate';
  if (top.confidence < 0.95) return 'Low confidence match';
  const plausible = candidates.filter((candidate) => productivityRelevant(candidate) && candidate.confidence >= 0.65);
  if (plausible.length > 1 && plausible.every(isExactInstitutionMappingCandidate)) return null;
  if (plausible.length > 1 && plausible.every(isDeterministicProtocolCandidate)) return null;
  if (plausible.length > 1 && top.method !== 'alias_match') return 'Multiple possible CPT matches';
  return null;
}

export function __testInstitutionMappingReviewReason(candidates: MatchCandidate[], duplicateStatus: DuplicateStatus = null): string | null {
  return reviewReasonFor(candidates[0], candidates, duplicateStatus);
}

function cmsDescriptionsFor(candidates: MatchCandidate[]): string {
  return candidates.map((candidate) => candidate.description).filter(Boolean).join(' + ');
}

export function resolvePowerScribeProductivityDates(study: ImportedStudy, fallbackLogDate: string): {
  performedDate: string;
  productivityDate: string;
  modifiedDateTime: string | null;
} {
  const performedDate = study.examDate ?? study.examDateTime?.slice(0, 10) ?? study.studyDate ?? fallbackLogDate;
  const modifiedDateTime = study.modifiedDateTime ?? null;
  const productivityDate = study.modifiedDate ?? modifiedDateTime?.slice(0, 10) ?? study.studyDate ?? fallbackLogDate;
  return { performedDate, productivityDate, modifiedDateTime };
}

function procedureNameFor(study: ImportedStudy): string {
  return (study.procedureName ?? study.cleanedExamName ?? study.cleanedText ?? study.examTitle).trim();
}

export function __testProcedureNameFor(study: ImportedStudy): string {
  return procedureNameFor(study);
}

export async function runImportPipeline(
  studies: ImportedStudy[],
  logDate: string,
  profileId?: string | null,
): Promise<PipelineResult> {
  if (studies.length === 0) {
    return { reviewRows: [], skippedRows: [], sources: [], profileId: profileId ?? null };
  }

  const sources = [...new Set(studies.map((s) => s.source))];
  const matched: Array<{ study: ImportedStudy; candidates: MatchCandidate[] }> = [];

  for (const study of studies) {
    const procedureName = procedureNameFor(study);
    const query = study.cpt ?? procedureName;
    const candidates = (await findMatchCandidates(query, 6, profileId, {
      requireExamContextForDirectCpt: study.source === 'ocr' && !study.cpt,
      directCptContext: procedureName,
    })).filter(productivityRelevant);
    matched.push({ study, candidates });
  }

  const dupeCandidates: StudyCandidate[] = matched.map(({ study, candidates }) => ({
    examNameRaw: procedureNameFor(study),
    cptCode: study.cpt ?? candidates[0]?.cptCode ?? null,
    cptCodes: selectedDuplicateCptCodes(candidates, study.cpt),
    modifier: candidates[0]?.modifier ?? null,
    logDate: study.modifiedDate ?? study.modifiedDateTime?.slice(0, 10) ?? study.studyDate ?? logDate,
    studyDateTime: study.modifiedDateTime,
    performedDateTime: study.examDateTime ?? null,
    modifiedDateTime: study.modifiedDateTime,
    studyDate: study.studyDate ?? null,
    accessionNumber: study.accessionNumber,
    rowIndex: study.rowIndex ?? null,
    modality: study.modality ?? candidates[0]?.modality ?? null,
  }));

  const dupeResults = await checkBatchDuplicates(dupeCandidates, logDate);
  const reviewRows: PipelineReviewRow[] = [];
  const skippedRows: PipelineReviewRow[] = [];

  for (let i = 0; i < matched.length; i++) {
    const { study, candidates } = matched[i];
    const dupeResult = dupeResults[i];
    const top = candidates[0];
    const dupStatus: DuplicateStatus = dupeResult?.match?.confidence ?? null;
    const dupReason = dupeResult?.match?.reason ?? null;
    const dupLogId =
      dupeResult?.match?.existingLog.id === 'batch-duplicate'
        ? null
        : (dupeResult?.match?.existingLog.id ?? null);

    const parserNeedsReview =
      Boolean(study.parserNeedsReview) ||
      (study.extractionConfidence != null && study.extractionConfidence < 0.75);
    const deterministicSelectedIndices = top && isDeterministicProtocolCandidate(top)
      ? candidates
          .map((candidate, index) => (isDeterministicProtocolCandidate(candidate) && productivityRelevant(candidate) ? index : -1))
          .filter((index) => index >= 0)
      : [];
    const institutionSelectedIndices = top && isExactInstitutionMappingCandidate(top)
      ? candidates
          .map((candidate, index) => (isExactInstitutionMappingCandidate(candidate) && productivityRelevant(candidate) ? index : -1))
          .filter((index) => index >= 0)
      : [];
    const selectedIndex =
      institutionSelectedIndices[0] ??
      deterministicSelectedIndices[0] ??
      (top && top.confidence >= 0.75 && productivityRelevant(top) ? 0 : null);
    const selectedCandidateIndices =
      institutionSelectedIndices.length > 0
        ? institutionSelectedIndices
        : deterministicSelectedIndices.length > 0
        ? deterministicSelectedIndices
        : selectedIndex === null ? [] : [selectedIndex];
    const selectedCandidates = selectedCandidateIndices
      .map((index) => candidates[index])
      .filter((candidate): candidate is MatchCandidate => Boolean(candidate));
    const matchReviewReason = reviewReasonFor(top, candidates, dupStatus, dupReason);
    const reviewReason = study.parserReviewReason ?? matchReviewReason;
    const exactInstitutionAutoAccept =
      !parserNeedsReview &&
      dupStatus === null &&
      institutionSelectedIndices.length > 0 &&
      selectedCandidates.length === institutionSelectedIndices.length &&
      selectedCandidates.every((candidate) => isExactInstitutionMappingCandidate(candidate) && productivityRelevant(candidate)) &&
      !matchReviewReason;
    const autoApprovalLevel =
      exactInstitutionAutoAccept
        ? 'learned'
        : !parserNeedsReview && top && isDeterministicProtocolCandidate(top) && dupStatus === null
        ? 'learned'
        : !parserNeedsReview && top?.method === 'alias_match' && top.confidence >= 0.99 && dupStatus === null
        ? 'silent'
        : !parserNeedsReview && top?.method === 'alias_match' && top.confidence >= 0.95 && dupStatus === null
        ? 'learned'
        : null;
    const autoAccept = Boolean(autoApprovalLevel && !reviewReason);

    const row: PipelineReviewRow = {
      tempId: crypto.randomUUID(),
      source: study,
      candidates,
      selectedCandidateIndex: selectedIndex,
      selectedCandidateIndices,
      displayTitle: procedureNameFor(study),
      needsReview: parserNeedsReview || (!autoAccept && Boolean(reviewReason ?? (candidates.length === 0 || !top || top.confidence < 0.75))),
      autoApproved: autoAccept,
      autoApprovalLevel,
      approvalStatus: autoAccept ? 'auto_approved' : 'pending',
      reviewReason,
      duplicateStatus: dupStatus,
      duplicateExistingLogId: dupLogId,
      duplicateReason: dupReason,
      included: true,
      autoSkipped: false,
    };

    if (dupStatus === 'exact') {
      skippedRows.push({ ...row, included: false, autoSkipped: true, approvalStatus: 'exact_duplicate_skipped' });
    } else {
      reviewRows.push(row);
    }
  }

  return { reviewRows, skippedRows, sources, profileId: profileId ?? null };
}

export async function commitPipelineResults(
  reviewRows: PipelineReviewRow[],
  logDate: string,
  skippedCount: number,
  profileId?: string | null,
): Promise<CommitResult> {
  const now = new Date().toISOString();
  const importId = crypto.randomUUID();
  let importedCount = 0;
  let reviewNeededCount = 0;
  let alreadySavedCount = 0;
  let blockedNoValidCptCount = 0;
  const committedLogs: StudyLog[] = [];

  for (const row of reviewRows) {
    const selectedCandidates = selectedCandidatesForRow(row).filter(productivityRelevant);
    if (selectedCandidates.length === 0) {
      if (row.included && !row.autoSkipped && row.approvalStatus !== 'excluded') blockedNoValidCptCount++;
      continue;
    }
    if (!isReviewRowSaveEligible(row)) {
      if (row.included && !row.autoSkipped && row.approvalStatus !== 'excluded' && row.approvalStatus !== 'exact_duplicate_skipped') {
        reviewNeededCount++;
      }
      continue;
    }

    const study = row.source;
    const procedureName = procedureNameFor(study);
    const displayTitle = (row.displayTitle ?? procedureName).trim() || procedureName;
    const normalizedTitle = normalizeRadiologyDescription(displayTitle || procedureName);
    const cmsDescription = cmsDescriptionsFor(selectedCandidates) || null;
    const { productivityDate, modifiedDateTime } = resolvePowerScribeProductivityDates(study, logDate);
    const rowSessionId = crypto.randomUUID();
    let rowCommitted = false;
    let rowAlreadySaved = false;

    for (const cand of selectedCandidates) {
      const fingerprint = buildFingerprint(
        procedureName,
        cand.cptCode,
        productivityDate,
        modifiedDateTime,
        study.accessionNumber,
        cand.modality,
        {
          cptCodes: selectedCandidates.map((candidate) => candidate.cptCode),
          performedDateTime: study.examDateTime ?? null,
          modifiedDateTime,
        },
      );

      const existing = isStrongDuplicateFingerprint(fingerprint)
        ? await db.studyLogs.where('studyFingerprint').equals(fingerprint).first()
        : null;
      if (existing && !(existing as any).deletedAt) {
        rowAlreadySaved = true;
        continue;
      }

      const isReview = false;

      const studyDate = productivityDate;
      const logDateFinal = productivityDate;

      const log: StudyLog = {
        id: crypto.randomUUID(),
        profileId: profileId ?? null,
        logDate: logDateFinal,
        studyDateTime: modifiedDateTime,
        examDateTime: study.examDateTime ?? null,
        studyDate,
        dateTimeConfidence: study.dateTimeConfidence ?? 0,
        dateTimeSource: study.dateTimeSource ?? 'import_default',
        examNameRaw: procedureName,
        examTitleNormalized: normalizedTitle,
        examTitleDisplay: displayTitle,
        cmsDescription: cand.description || cmsDescription,
        cptCode: cand.cptCode,
        modifier: '26',
        workRvu: cand.workRvu,
        modality: study.modality ?? cand.modality,
        matchMethod: cand.method,
        matchConfidence: cand.confidence,
        needsReview: isReview,
        accessionNumber: study.accessionNumber,
        rowIndex: study.rowIndex ?? null,
        ocrConfidence: study.ocrConfidence ?? null,
        sessionId: rowSessionId,
        sourceImportId: importId,
        notes: selectedCandidates.length > 1 ? `Combined CPT study: ${cmsDescription}` : null,
        studyFingerprint: fingerprint,
        createdAt: now,
        updatedAt: now,
      };

      await db.studyLogs.add(log);
      committedLogs.push(log);
      rowCommitted = true;
    }

    if (rowCommitted) {
      await learnAlias({
        rawText: procedureName,
        canonicalExamName: displayTitle,
        candidates: selectedCandidates.map((candidate) => ({
          cptCode: candidate.cptCode,
          modifier: '26',
          workRvu: candidate.workRvu,
          description: candidate.description,
          modality: candidate.modality,
        })),
        source: 'ocr_confirmed',
        profileId: profileId ?? null,
        action: row.autoApproved ? 'confirm' : row.needsReview ? 'correct' : 'confirm',
      });
      importedCount++;
    } else if (rowAlreadySaved) {
      alreadySavedCount++;
    }
  }

  if (committedLogs.length > 0 && supabasePersistence.isConfigured()) {
    const totalDailyWrvu = committedLogs.reduce((sum, log) => sum + (log.workRvu ?? 0), 0);
    const uploadDayId = await supabasePersistence.createUploadDay({
      readingDate: logDate,
      profileId: profileId ?? null,
      rawExamText: reviewRows.map((row) => procedureNameFor(row.source)).join('\n'),
      totalDailyWrvu,
    });
    await supabasePersistence.saveStudyLogs(committedLogs, uploadDayId);
  }

  return { importedCount, skippedCount, reviewNeededCount, alreadySavedCount, blockedNoValidCptCount };
}
