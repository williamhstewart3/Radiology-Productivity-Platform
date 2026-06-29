/**
 * importPipeline.ts
 *
 * The single shared pipeline that every import source feeds into.
 *
 * ── Data flow ────────────────────────────────────────────────────────────────
 *
 *   ImportProvider.importStudies()
 *       ↓ ImportedStudy[]
 *   runImportPipeline()
 *       ↓ alias mapping      — normalize exam text, look up learned aliases
 *       ↓ CPT matching       — findMatchCandidates() for each study
 *       ↓ duplicate detection — checkBatchDuplicates() against existing logs
 *       ↓ produce PipelineReviewRow[]
 *       → caller decides whether to auto-commit or show review UI
 *
 *   commitPipelineResults()
 *       ↓ writes accepted rows to db.studyLogs
 *       ↓ calls learnAlias() for every committed study
 *
 * ── Design principles ────────────────────────────────────────────────────────
 *
 * • Alias learning from one source (e.g. OCR) benefits all future sources
 *   (paste, CSV, PowerScribe) automatically — aliases are source-agnostic.
 *
 * • Duplicate detection always runs AFTER alias mapping and CPT matching,
 *   so the fingerprint is built from the most-resolved data available.
 *
 * • No provider touches the DB. Only commitPipelineResults() writes.
 *
 * • The pipeline is pure async — it produces a data structure that the UI
 *   can render for review. The commit step is separate and explicit.
 */

import { findMatchCandidates, learnAlias } from '../utils/matching';
import { checkBatchDuplicates, buildFingerprint } from '../utils/duplicateDetection';
import { db } from '../db/database';
import type { MatchCandidate, StudyLog, DuplicateStatus } from '../types';
import type { ImportedStudy, ImportSource } from '../types/importProvider';
import type { StudyCandidate } from '../utils/duplicateDetection';

// ─── Pipeline row model ───────────────────────────────────────────────────────

/**
 * One study after the pipeline has run alias mapping, CPT matching, and
 * duplicate detection on it. This is what the review UI receives.
 */
export interface PipelineReviewRow {
  /** Stable identifier within this pipeline run (not persisted). */
  tempId: string;

  /** The original ImportedStudy from the provider. */
  source: ImportedStudy;

  // ── CPT matching results ─────────────────────────────────────────────────
  candidates: MatchCandidate[];
  /** Index into candidates[] the pipeline recommends; null = needs manual pick. */
  selectedCandidateIndex: number | null;
  /** One or more selected candidates for combined-code studies. */
  selectedCandidateIndices: number[];
  /** True if the pipeline isn't confident enough to auto-accept this match. */
  needsReview: boolean;

  // ── Duplicate detection results ──────────────────────────────────────────
  duplicateStatus: DuplicateStatus;
  duplicateExistingLogId: string | null;
  duplicateReason: string | null;

  // ── User decision flags ──────────────────────────────────────────────────
  /** False if auto-skipped as exact/very_likely dup. User can toggle back. */
  included: boolean;
  /** True for exact/very_likely dups that were auto-moved to skippedRows. */
  autoSkipped: boolean;
}

// ─── Pipeline result ──────────────────────────────────────────────────────────

export interface PipelineResult {
  /** Rows presented to the user for review (includes 'possible' dups). */
  reviewRows: PipelineReviewRow[];
  /**
   * Rows auto-skipped as exact or very_likely duplicates.
   * User can restore any of these to reviewRows via "Import anyway".
   */
  skippedRows: PipelineReviewRow[];
  /** Source identifiers used by the providers in this run (for logging). */
  sources: ImportSource[];
  /** Profile to stamp on all committed logs. */
  profileId: string | null;
}

// ─── Commit result ────────────────────────────────────────────────────────────

export interface CommitResult {
  importedCount: number;
  skippedCount: number;
  reviewNeededCount: number;
}

// ─── Core pipeline ────────────────────────────────────────────────────────────

/**
 * Runs the full pipeline on a set of studies from one or more providers.
 *
 * Does NOT write to the DB — call commitPipelineResults() to persist.
 *
 * @param studies    Array of ImportedStudy from any provider(s).
 * @param logDate    Calendar date to log studies against (YYYY-MM-DD).
 *                   Used for duplicate detection window and as fallback when
 *                   the study itself has no date.
 * @param profileId  Active radiologist profile ID to stamp on all created logs.
 */
export async function runImportPipeline(
  studies: ImportedStudy[],
  logDate: string,
  profileId?: string | null,
): Promise<PipelineResult> {
  if (studies.length === 0) {
    return { reviewRows: [], skippedRows: [], sources: [], profileId: profileId ?? null };
  }

  const sources = [...new Set(studies.map((s) => s.source))];

  // ── Step 1: Alias mapping + CPT matching ───────────────────────────────────
  const matched: Array<{
    study: ImportedStudy;
    candidates: MatchCandidate[];
  }> = [];

  for (const study of studies) {
    // If the provider already supplies a CPT code, use it as the primary
    // lookup to preserve the source system's billing intent. The alias table
    // still runs — existing aliases will surface as additional candidates.
    const query = study.cpt ?? study.examTitle;
    const candidates = await findMatchCandidates(query, 4, profileId);
    matched.push({ study, candidates });
  }

  // ── Step 2: Duplicate detection ────────────────────────────────────────────
  // Build StudyCandidate structs from the match results.
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

  // ── Step 3: Assemble review rows ───────────────────────────────────────────
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

    // Auto-accept when: exact alias match at ≥95% confidence (no dupe)
    const autoAccept =
      top?.method === 'alias_match' &&
      top?.confidence >= 0.95 &&
      dupStatus === null;

    const selectedIndex =
      candidates.length > 0 && candidates[0].confidence >= 0.75 ? 0 : null;

    const row: PipelineReviewRow = {
      tempId: crypto.randomUUID(),
      source: study,
      candidates,
      selectedCandidateIndex: selectedIndex,
      selectedCandidateIndices: selectedIndex === null ? [] : [selectedIndex],
      needsReview: !autoAccept && (candidates.length === 0 || candidates[0].confidence < 0.75),
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

// ─── Commit ───────────────────────────────────────────────────────────────────

/**
 * Writes accepted PipelineReviewRows to db.studyLogs and learns aliases.
 *
 * @param reviewRows  Rows from PipelineResult.reviewRows (the user-visible set).
 *                    Rows with included=false or no selected candidate are skipped.
 * @param logDate     Calendar date for all studies in this batch.
 * @param skippedCount  Number of auto-skipped rows — included in the CommitResult.
 * @param profileId   Active profile to stamp on each log.
 */
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

  for (const row of reviewRows) {
    if (!row.included) continue;
    const selectedIndices =
      row.selectedCandidateIndices?.length
        ? row.selectedCandidateIndices
        : row.selectedCandidateIndex === null
          ? []
          : [row.selectedCandidateIndex];
    const selectedCandidates = selectedIndices
      .map((index) => row.candidates[index])
      .filter((candidate): candidate is MatchCandidate => Boolean(candidate));
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
      if (existing) continue;

      const isReview =
        cand.confidence < 0.75 ||
        row.needsReview ||
        row.duplicateStatus === 'possible';

      // studyDate comes from OCR if available; otherwise falls back to effectiveDate.
      // When we have an OCR-confirmed date, logDate should reflect it.
      const studyDate = study.studyDate || effectiveDate;
      const logDateFinal = (study.dateTimeConfidence ?? 0) > 0 ? studyDate : effectiveDate;

      const log: StudyLog = {
        id: crypto.randomUUID(),
        profileId: profileId ?? null,
        logDate: logDateFinal,
        studyDateTime: study.studyTime,
        studyDate: studyDate,
        dateTimeConfidence: study.dateTimeConfidence ?? 0,
        dateTimeSource: study.dateTimeSource ?? 'import_default',
        examNameRaw: study.examTitle,
        cptCode: cand.cptCode,
        modifier: cand.modifier,
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
      rowCommitted = true;
      if (isReview) rowNeedsReview = true;
    }

    if (rowCommitted) {
      await learnAlias({
        rawText: study.examTitle,
        canonicalExamName: selectedCandidates.map((candidate) => candidate.description).join(' + '),
        candidates: selectedCandidates.map((candidate) => ({
          cptCode: candidate.cptCode,
          modifier: candidate.modifier,
          workRvu: candidate.workRvu,
        })),
        source: 'ocr_confirmed',
        profileId: profileId ?? null,
      });
      importedCount++;
      if (rowNeedsReview) reviewNeededCount++;
    }
  }

  return { importedCount, skippedCount, reviewNeededCount };
}
