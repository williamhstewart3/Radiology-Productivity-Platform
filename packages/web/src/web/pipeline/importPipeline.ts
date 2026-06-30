import { findMatchCandidates, learnAlias } from '../utils/matching';
import { checkBatchDuplicates, buildFingerprint } from '../utils/duplicateDetection';
import { db } from '../db/database';
import { supabasePersistence } from '../services/supabasePersistence';
import type { MatchCandidate, StudyLog, DuplicateStatus } from '../types';
import type { ImportedStudy, ImportSource } from '../types/importProvider';
import type { StudyCandidate } from '../utils/duplicateDetection';

export interface PipelineReviewRow {
  tempId: string;
  source: ImportedStudy;
  candidates: MatchCandidate[];
  selectedCandidateIndex: number | null;
  selectedCandidateIndices: number[];
  needsReview: boolean;
  duplicateStatus: DuplicateStatus;
  duplicateExistingLogId: string | null;
  duplicateReason: string | null;
  included: boolean;
  autoSkipped: boolean;
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
    const query = study.cpt ?? study.examTitle;
    const candidates = (await findMatchCandidates(query, 6, profileId, {
      requireExamContextForDirectCpt: study.source === 'ocr' && !study.cpt,
      directCptContext: study.examTitle,
    })).filter(productivityRelevant);
    matched.push({ study, candidates });
  }

  const dupeCandidates: StudyCandidate[] = matched.map(({ study, candidates }) => ({
    examNameRaw: study.examTitle,
    cptCode: study.cpt ?? candidates[0]?.cptCode ?? null,
    modifier: candidates[0]?.modifier ?? null,
    logDate: study.studyDate || logDate,
    studyDateTime: study.studyTime,
    accessionNumber: study.accessionNumber,
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

    const autoAccept =
      top?.method === 'alias_match' &&
      top?.confidence >= 0.95 &&
      dupStatus === null;

    const selectedIndex =
      top && top.confidence >= 0.75 && productivityRelevant(top) ? 0 : null;

    const row: PipelineReviewRow = {
      tempId: crypto.randomUUID(),
      source: study,
      candidates,
      selectedCandidateIndex: selectedIndex,
      selectedCandidateIndices: selectedIndex === null ? [] : [selectedIndex],
      needsReview: !autoAccept && (candidates.length === 0 || !top || top.confidence < 0.75),
      duplicateStatus: dupStatus,
      duplicateExistingLogId: dupLogId,
      duplicateReason: dupReason,
      included: true,
      autoSkipped: false,
    };

    if (dupStatus === 'exact' || dupStatus === 'very_likely') {
      skippedRows.push({ ...row, included: false, autoSkipped: true });
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
  const committedLogs: StudyLog[] = [];

  for (const row of reviewRows) {
    if (!row.included) continue;
    const selectedCandidates = selectedCandidatesForRow(row).filter(productivityRelevant);
    if (selectedCandidates.length === 0) continue;

    const study = row.source;
    const effectiveDate = study.studyDate || logDate;
    const rowSessionId = crypto.randomUUID();
    let rowCommitted = false;
    let rowNeedsReview = false;

    for (const cand of selectedCandidates) {
      const fingerprint = buildFingerprint(
        study.examTitle,
        cand.cptCode,
        effectiveDate,
        study.studyTime,
        study.accessionNumber,
        cand.modality,
      );

      const existing = await db.studyLogs.where('studyFingerprint').equals(fingerprint).first();
      if (existing && !(existing as any).deletedAt) continue;

      const isReview =
        cand.confidence < 0.75 ||
        row.needsReview ||
        row.duplicateStatus === 'possible';

      const studyDate = study.studyDate || effectiveDate;
      const logDateFinal = (study.dateTimeConfidence ?? 0) > 0 ? studyDate : effectiveDate;

      const log: StudyLog = {
        id: crypto.randomUUID(),
        profileId: profileId ?? null,
        logDate: logDateFinal,
        studyDateTime: study.studyTime,
        studyDate,
        dateTimeConfidence: study.dateTimeConfidence ?? 0,
        dateTimeSource: study.dateTimeSource ?? 'import_default',
        examNameRaw: study.examTitle,
        cptCode: cand.cptCode,
        modifier: '26',
        workRvu: cand.workRvu,
        modality: study.modality ?? cand.modality,
        matchMethod: cand.method,
        matchConfidence: cand.confidence,
        needsReview: isReview,
        accessionNumber: study.accessionNumber,
        sessionId: rowSessionId,
        sourceImportId: importId,
        notes: selectedCandidates.length > 1 ? 'Combined CPT study' : null,
        studyFingerprint: fingerprint,
        createdAt: now,
        updatedAt: now,
      };

      await db.studyLogs.add(log);
      committedLogs.push(log);
      rowCommitted = true;
      if (isReview) rowNeedsReview = true;
    }

    if (rowCommitted) {
      await learnAlias({
        rawText: study.examTitle,
        canonicalExamName: selectedCandidates.map((candidate) => candidate.description).join(' + '),
        candidates: selectedCandidates.map((candidate) => ({
          cptCode: candidate.cptCode,
          modifier: '26',
          workRvu: candidate.workRvu,
        })),
        source: 'ocr_confirmed',
        profileId: profileId ?? null,
      });
      importedCount++;
      if (rowNeedsReview) reviewNeededCount++;
    }
  }

  if (committedLogs.length > 0 && supabasePersistence.isConfigured()) {
    const totalDailyWrvu = committedLogs.reduce((sum, log) => sum + (log.workRvu ?? 0), 0);
    const uploadDayId = await supabasePersistence.createUploadDay({
      readingDate: logDate,
      profileId: profileId ?? null,
      rawExamText: reviewRows.map((row) => row.source.examTitle).join('\n'),
      totalDailyWrvu,
    });
    await supabasePersistence.saveStudyLogs(committedLogs, uploadDayId);
  }

  return { importedCount, skippedCount, reviewNeededCount };
}
