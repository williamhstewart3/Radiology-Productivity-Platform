import { db } from '../db/database';
import {
  commitPipelineResults,
  isReviewRowSaveEligible,
  type PipelineReviewRow,
} from '../pipeline/importPipeline';
import {
  createTimelineEvent,
  loadActiveReviewSession,
  persistActiveReviewSession,
} from './reviewSessionService';
import { candidateKey } from '../utils/cptPicker';
import { recordAuditEvent } from '../utils/audit';
import type { ActiveReviewSession, MatchCandidate, MatchMethod, StudyLog } from '../types';

export interface InboxAccounting {
  totalRows: number;
  readyCount: number;
  readyWrvu: number;
  possibleDuplicateCount: number;
  needsCptCount: number;
}

/**
 * The Inbox header's permanent batch-accounting line — every field comes
 * straight off the session summary (already computed by
 * summarizeReviewSession) and the pending rows already loaded for the card
 * queue. No parallel counting, no new pipeline fields. readyWrvu reuses
 * session.confirmedWrvu directly — the auto-approved batch's wRVU total —
 * rather than re-summing candidates here.
 */
export function summarizeInboxAccounting(
  session: Pick<ActiveReviewSession, 'totalExams' | 'needsReviewCount' | 'confirmedWrvu'> | null,
  pending: PipelineReviewRow[],
): InboxAccounting | null {
  if (!session || session.totalExams === 0) return null;
  return {
    totalRows: session.totalExams,
    readyCount: session.totalExams - session.needsReviewCount,
    readyWrvu: session.confirmedWrvu,
    possibleDuplicateCount: pending.filter((row) => row.duplicateStatus === 'possible').length,
    needsCptCount: pending.filter((row) => row.duplicateStatus !== 'possible' && row.candidates.length === 0).length,
  };
}

export function formatInboxAccounting(accounting: InboxAccounting): string {
  const parts = [
    `${accounting.totalRows} row${accounting.totalRows === 1 ? '' : 's'}`,
    `${accounting.readyCount} ready${accounting.readyCount > 0 ? ` (+${accounting.readyWrvu.toFixed(1)} wRVU)` : ''}`,
  ];
  if (accounting.possibleDuplicateCount > 0) {
    parts.push(`${accounting.possibleDuplicateCount} possible duplicate${accounting.possibleDuplicateCount === 1 ? '' : 's'}`);
  }
  if (accounting.needsCptCount > 0) {
    parts.push(`${accounting.needsCptCount} needs CPT`);
  }
  return parts.join(' · ');
}

export type ConfidencePhrase =
  | 'Learned match'
  | 'Direct match'
  | 'Protocol match'
  | 'Fuzzy match — worth a look'
  | 'No confident match';

export function confidencePhrase(method: MatchMethod | undefined, hasCandidate: boolean): ConfidencePhrase {
  if (!hasCandidate) return 'No confident match';
  if (method === 'alias_match') return 'Learned match';
  if (method === 'manual_cpt') return 'Direct match';
  if (method === 'manual_name_match' || method === 'ocr_match') return 'Protocol match';
  return 'Fuzzy match — worth a look';
}

export function approveInboxRow(row: PipelineReviewRow): PipelineReviewRow | null {
  const selectedIndices = (row.selectedCandidateIndices?.length
    ? row.selectedCandidateIndices
    : row.selectedCandidateIndex == null
      ? (row.candidates[0] ? [0] : [])
      : [row.selectedCandidateIndex])
    .filter((index) => Boolean(row.candidates[index]));
  const selectedIndex = selectedIndices[0] ?? null;
  if (selectedIndex == null || !row.candidates[selectedIndex]) return null;
  return {
    ...row,
    included: true,
    autoSkipped: false,
    selectedCandidateIndex: selectedIndex,
    selectedCandidateIndices: selectedIndices,
    needsReview: false,
    approvalStatus: row.duplicateStatus === 'possible' ? 'approved_as_new' : 'manual_approved',
  };
}

export interface InboxResolutionResult {
  importedCount: number;
  addedWrvu: number;
  remainingAttention: number;
}

export async function resolveInboxRows(input: {
  profileId: string | null;
  siteId?: string | null;
  rowIds: string[];
  action: 'accept' | 'skip' | 'update_existing';
}): Promise<InboxResolutionResult> {
  const session = await loadActiveReviewSession(input.profileId, input.siteId);
  if (!session) return { importedCount: 0, addedWrvu: 0, remainingAttention: 0 };
  const ids = new Set(input.rowIds);
  const selected = session.rows.filter((row) => ids.has(row.tempId));
  const remaining = session.rows.filter((row) => !ids.has(row.tempId));

  if (input.action === 'update_existing') {
    for (const row of selected) {
      await updateExistingStudyTouch(row, input.profileId);
    }
  }

  const accepted = input.action === 'accept'
    ? selected.map(approveInboxRow).filter((row): row is PipelineReviewRow => Boolean(row))
    : [];
  const skipped = input.action === 'skip' || input.action === 'update_existing'
    ? selected.map((row) => ({
        ...row,
        included: false,
        needsReview: false,
        approvalStatus: input.action === 'update_existing' ? 'existing_updated' as const : 'excluded' as const,
      }))
    : [];

  const remainingAttention = remaining.filter((row) => row.included && row.needsReview).length;
  const quietRows = remainingAttention === 0 ? remaining.filter(isReviewRowSaveEligible) : [];
  const rowsToCommit = [...accepted, ...quietRows];
  const addedWrvu = rowsToCommit.reduce((sum, row) => {
    const indices = row.selectedCandidateIndices?.length
      ? row.selectedCandidateIndices
      : row.selectedCandidateIndex == null ? [] : [row.selectedCandidateIndex];
    return sum + indices.reduce((rowSum, index) => rowSum + (row.candidates[index]?.workRvu ?? 0), 0);
  }, 0);
  const result = await commitPipelineResults(rowsToCommit, session.readingDate, skipped.length, input.profileId);
  const nextRows = remainingAttention === 0 ? remaining.filter((row) => !quietRows.includes(row)) : remaining;
  const nextSkipped = [...session.skippedRows, ...skipped];
  const nextTimeline = [...session.timeline, createTimelineEvent(
    input.action === 'accept' ? 'Accepted from Inbox' : input.action === 'update_existing' ? 'Updated existing from Inbox' : 'Skipped from Inbox',
  )];

  if (nextRows.filter((row) => row.included && row.needsReview).length === 0 && nextRows.length === 0) {
    await db.activeReviewSessions.update(session.sessionId, {
      status: 'finalized',
      rowsJson: '[]',
      skippedRowsJson: JSON.stringify(nextSkipped),
      timelineJson: JSON.stringify(nextTimeline),
      totalExams: 0,
      confirmedWrvu: 0,
      estimatedPendingWrvu: 0,
      projectedWrvu: 0,
      needsReviewCount: 0,
      updatedAt: new Date().toISOString(),
      finalizedAt: new Date().toISOString(),
    });
  } else {
    await persistActiveReviewSession({
      sessionId: session.sessionId,
      profileId: input.profileId,
      siteId: input.siteId ?? session.siteId,
      readingDate: session.readingDate,
      rows: nextRows,
      skippedRows: nextSkipped,
      timeline: nextTimeline,
    });
  }

  return { importedCount: result.importedCount, addedWrvu, remainingAttention };
}

/**
 * The Change code picker's commit path, pure half. `candidates` may include
 * codes already in row.candidates (a Suggested pick) or codes found via
 * search (not yet in row.candidates at all, e.g. anything from the open CPT
 * library) -- either is merged into row.candidates by cptCode+modifier
 * (deduped, never appended twice) and selectedCandidateIndices points at
 * the merged positions. This is the only schema-shaped change multi-CPT
 * selection needs: commitPipelineResults and learnAlias already iterate
 * `selectedCandidatesForRow(row)` as a set, not a single index.
 */
export function mergeInboxCandidateSelection(row: PipelineReviewRow, candidates: MatchCandidate[]): PipelineReviewRow {
  const mergedCandidates = [...row.candidates];
  const keyIndex = new Map(mergedCandidates.map((candidate, index) => [candidateKey(candidate), index]));
  const indices = candidates.map((candidate) => {
    const key = candidateKey(candidate);
    const existingIndex = keyIndex.get(key);
    if (existingIndex != null) return existingIndex;
    mergedCandidates.push(candidate);
    const newIndex = mergedCandidates.length - 1;
    keyIndex.set(key, newIndex);
    return newIndex;
  });
  return {
    ...row,
    candidates: mergedCandidates,
    selectedCandidateIndex: indices[0] ?? null,
    selectedCandidateIndices: indices,
    needsReview: true,
    approvalStatus: 'pending' as const,
  };
}

const SPLIT_REVIEW_REASON = 'Split from a merged OCR row; verify this study and its timestamps';

/**
 * Turns an explicitly selected multi-CPT row into one pending Inbox row per
 * CPT. The original OCR line is retained only as parser evidence; it is not
 * learned as an alias for either child study. Ambiguous accession and row
 * identifiers are cleared because they cannot be paired safely after a split.
 */
export function splitInboxRowByCandidates(
  row: PipelineReviewRow,
  candidates: MatchCandidate[],
  createId: () => string = () => crypto.randomUUID(),
): PipelineReviewRow[] {
  const uniqueCandidates = [...new Map(candidates.map((candidate) => [candidateKey(candidate), candidate])).values()];
  if (uniqueCandidates.length < 2) return [row];
  const originalRawLine = row.source.parserRawLine ?? row.source.examTitle;

  return uniqueCandidates.map((candidate) => ({
    ...row,
    tempId: createId(),
    source: {
      ...row.source,
      examTitle: candidate.description,
      procedureName: candidate.description,
      canonicalExam: candidate.description,
      cpt: candidate.cptCode,
      workRvu: candidate.workRvu,
      modality: candidate.modality,
      accessionNumber: null,
      rowIndex: null,
      cleanedExamName: candidate.description,
      cleanedText: candidate.description,
      parserRawLine: originalRawLine,
      parserNeedsReview: true,
      parserReviewReason: SPLIT_REVIEW_REASON,
    },
    candidates: [candidate],
    selectedCandidateIndex: 0,
    selectedCandidateIndices: [0],
    displayTitle: candidate.description,
    needsReview: true,
    duplicateStatus: null,
    duplicateExistingLogId: null,
    duplicateReason: null,
    included: true,
    autoSkipped: false,
    autoApproved: false,
    autoApprovalLevel: null,
    approvalStatus: 'pending',
    reviewReason: SPLIT_REVIEW_REASON,
    notes: 'Split from merged OCR row',
  }));
}

export async function applyInboxCandidateSelection(profileId: string | null, rowId: string, candidates: MatchCandidate[], siteId?: string | null): Promise<void> {
  const session = await loadActiveReviewSession(profileId, siteId);
  if (!session) return;
  const rows = session.rows.map((row) => row.tempId === rowId ? mergeInboxCandidateSelection(row, candidates) : row);
  await persistActiveReviewSession({ ...session, profileId, rows });
}

export async function applyInboxRowSplit(profileId: string | null, rowId: string, candidates: MatchCandidate[], siteId?: string | null): Promise<number> {
  const session = await loadActiveReviewSession(profileId, siteId);
  if (!session) return 0;
  const target = session.rows.find((row) => row.tempId === rowId);
  if (!target) return 0;
  const splitRows = splitInboxRowByCandidates(target, candidates);
  if (splitRows.length < 2) return 0;
  const rows = session.rows.flatMap((row) => row.tempId === rowId ? splitRows : [row]);
  await persistActiveReviewSession({
    ...session,
    profileId,
    rows,
    timeline: [...session.timeline, createTimelineEvent(`Split one merged OCR row into ${splitRows.length} studies`)],
  });
  return splitRows.length;
}

export interface ExistingStudyTouchPatch {
  studyDateTime?: string;
  examTitleDisplay?: string;
}

/**
 * The "Update existing" verb's pure half: what to change on the already-
 * committed StudyLog for an addendum touch. Never touches workRvu or
 * cptCode -- the billed code snapshot is immutable once committed. The
 * display name only moves if the existing record was never manually
 * cleaned up (still equals its raw OCR text), so a radiologist's earlier
 * rename is never clobbered by a later recapture's resolved title.
 */
export function buildExistingStudyTouchPatch(row: PipelineReviewRow, existing: StudyLog): ExistingStudyTouchPatch {
  const patch: ExistingStudyTouchPatch = {};
  const incomingModified = row.source.modifiedDateTime ?? row.source.studyTime ?? null;
  if (incomingModified && incomingModified !== existing.studyDateTime) {
    patch.studyDateTime = incomingModified;
  }
  const candidateName = (row.displayTitle ?? row.source.procedureName ?? row.source.examTitle ?? '').trim();
  const currentDisplay = (existing.examTitleDisplay ?? '').trim();
  const wasManuallyResolved = currentDisplay.length > 0 && currentDisplay !== existing.examNameRaw.trim();
  if (candidateName && !wasManuallyResolved && candidateName !== currentDisplay) {
    patch.examTitleDisplay = candidateName;
  }
  return patch;
}

export async function updateExistingStudyTouch(row: PipelineReviewRow, profileId: string | null): Promise<void> {
  if (!row.duplicateExistingLogId) return;
  const existing = await db.studyLogs.get(row.duplicateExistingLogId);
  if (!existing) return;
  const patch = buildExistingStudyTouchPatch(row, existing);
  if (Object.keys(patch).length === 0) return;
  const now = new Date().toISOString();
  await db.studyLogs.update(existing.id, { ...patch, updatedAt: now } as Partial<StudyLog>);
  await recordAuditEvent({
    profileId,
    sessionId: existing.sessionId,
    logDate: existing.logDate,
    action: 'duplicate_touch_updated',
    summary: `Updated read time for ${existing.examTitleDisplay ?? existing.examNameRaw}`,
    detailsJson: JSON.stringify({
      existingLogId: existing.id,
      previousModified: existing.studyDateTime,
      newModified: patch.studyDateTime ?? existing.studyDateTime,
      renamedTo: patch.examTitleDisplay ?? null,
    }),
  });
}
