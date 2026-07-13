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
import type { ActiveReviewSession, MatchMethod } from '../types';

export interface InboxAccounting {
  totalRows: number;
  readyCount: number;
  possibleDuplicateCount: number;
  needsCptCount: number;
}

/**
 * The Inbox header's permanent batch-accounting line — every field comes
 * straight off the session summary (already computed by
 * summarizeReviewSession) and the pending rows already loaded for the card
 * queue. No parallel counting, no new pipeline fields.
 */
export function summarizeInboxAccounting(
  session: Pick<ActiveReviewSession, 'totalExams' | 'needsReviewCount'> | null,
  pending: PipelineReviewRow[],
): InboxAccounting | null {
  if (!session || session.totalExams === 0) return null;
  return {
    totalRows: session.totalExams,
    readyCount: session.totalExams - session.needsReviewCount,
    possibleDuplicateCount: pending.filter((row) => row.duplicateStatus === 'possible').length,
    needsCptCount: pending.filter((row) => row.duplicateStatus !== 'possible' && row.candidates.length === 0).length,
  };
}

export function formatInboxAccounting(accounting: InboxAccounting): string {
  const parts = [
    `${accounting.totalRows} row${accounting.totalRows === 1 ? '' : 's'}`,
    `${accounting.readyCount} ready`,
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
  const selectedIndex = row.selectedCandidateIndex ?? row.selectedCandidateIndices?.[0] ?? (row.candidates[0] ? 0 : null);
  if (selectedIndex == null || !row.candidates[selectedIndex]) return null;
  return {
    ...row,
    included: true,
    autoSkipped: false,
    selectedCandidateIndex: selectedIndex,
    selectedCandidateIndices: [selectedIndex],
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
  rowIds: string[];
  action: 'accept' | 'skip';
}): Promise<InboxResolutionResult> {
  const session = await loadActiveReviewSession(input.profileId);
  if (!session) return { importedCount: 0, addedWrvu: 0, remainingAttention: 0 };
  const ids = new Set(input.rowIds);
  const selected = session.rows.filter((row) => ids.has(row.tempId));
  const remaining = session.rows.filter((row) => !ids.has(row.tempId));
  const accepted = input.action === 'accept'
    ? selected.map(approveInboxRow).filter((row): row is PipelineReviewRow => Boolean(row))
    : [];
  const skipped = input.action === 'skip'
    ? selected.map((row) => ({ ...row, included: false, needsReview: false, approvalStatus: 'excluded' as const }))
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
  const nextTimeline = [...session.timeline, createTimelineEvent(input.action === 'accept' ? 'Accepted from Inbox' : 'Skipped from Inbox')];

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
      readingDate: session.readingDate,
      rows: nextRows,
      skippedRows: nextSkipped,
      timeline: nextTimeline,
    });
  }

  return { importedCount: result.importedCount, addedWrvu, remainingAttention };
}

export async function selectInboxCandidate(profileId: string | null, rowId: string, candidateIndex: number): Promise<void> {
  const session = await loadActiveReviewSession(profileId);
  if (!session) return;
  const rows = session.rows.map((row) => row.tempId === rowId ? {
    ...row,
    selectedCandidateIndex: candidateIndex,
    selectedCandidateIndices: [candidateIndex],
    needsReview: true,
    approvalStatus: 'pending' as const,
  } : row);
  await persistActiveReviewSession({ ...session, profileId, rows });
}
