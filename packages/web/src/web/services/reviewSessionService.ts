import { db } from '../db/database';
import { commitPipelineResults, isReviewRowSaveEligible } from '../pipeline/importPipeline';
import type { CommitResult, PipelineReviewRow } from '../pipeline/importPipeline';
import { recordAuditEvent } from '../utils/audit';
import { normalizeRadiologyDescription } from '../utils/radiologyDescriptionNormalization';

export type TimelineEvent = { id: string; at: string; label: string };

export interface ReviewSessionSnapshot {
  sessionId: string;
  siteId: string | null;
  readingDate: string;
  rows: PipelineReviewRow[];
  skippedRows: PipelineReviewRow[];
  timeline: TimelineEvent[];
}

export function createTimelineEvent(label: string): TimelineEvent {
  return { id: crypto.randomUUID(), at: new Date().toISOString(), label };
}

export function getSelectedCandidateIndices(row: PipelineReviewRow): number[] {
  if (row.selectedCandidateIndices?.length) {
    return row.selectedCandidateIndices.filter((index) => Boolean(row.candidates[index]));
  }
  return row.selectedCandidateIndex === null ? [] : [row.selectedCandidateIndex];
}

export function getSelectedCandidates(row: PipelineReviewRow) {
  return getSelectedCandidateIndices(row)
    .map((index) => row.candidates[index])
    .filter(Boolean);
}

export function getSelectedWorkRvu(row: PipelineReviewRow): number {
  return getSelectedCandidates(row).reduce((sum, candidate) => sum + (candidate.workRvu ?? 0), 0);
}

export function normalizedExamKey(row: PipelineReviewRow): string {
  return normalizeRadiologyDescription(row.source.procedureName ?? row.source.examTitle);
}

export function reviewSessionRowKey(row: PipelineReviewRow): string {
  const selectedCptSet = getSelectedCandidates(row)
    .map((candidate) => candidate.cptCode)
    .filter(Boolean)
    .sort()
    .join('+');
  if (selectedCptSet && row.source.examDateTime && row.source.modifiedDateTime) {
    return [
      'strict',
      selectedCptSet,
      row.source.examDateTime.slice(0, 16),
      row.source.modifiedDateTime.slice(0, 16),
    ].join('|');
  }

  return [
    'review',
    normalizedExamKey(row),
    row.source.modifiedDateTime ?? row.source.studyTime ?? '',
    row.source.modifiedDate ?? '',
    row.source.studyDate ?? '',
    row.source.accessionNumber ?? '',
    row.source.rowIndex ?? '',
  ].join('|');
}

function reviewSessionExactDuplicateKey(row: PipelineReviewRow): string | null {
  const selectedCptSet = getSelectedCandidates(row)
    .map((candidate) => candidate.cptCode)
    .filter(Boolean)
    .sort()
    .join('+');
  const normalizedTitle = normalizedExamKey(row);
  const identity = selectedCptSet || normalizedTitle;
  if (!identity || !row.source.examDateTime || !row.source.modifiedDateTime) return null;
  return [
    identity,
    row.source.examDateTime.slice(0, 16),
    row.source.modifiedDateTime.slice(0, 16),
  ].join('|');
}

function performedStudyIdentityKey(row: PipelineReviewRow): string | null {
  if (!row.source.examDateTime) return null;
  const selectedCptSet = getSelectedCandidates(row)
    .map((candidate) => candidate.cptCode)
    .filter(Boolean)
    .sort()
    .join('+');
  const identity = selectedCptSet || normalizedExamKey(row);
  return identity ? `${identity}|${row.source.examDateTime.slice(0, 16)}` : null;
}

export function summarizeReviewSession(rows: PipelineReviewRow[], skippedRows: PipelineReviewRow[]) {
  const included = rows.filter((row) => row.included);
  const confirmedWrvu = included
    .filter((row) => !row.needsReview)
    .reduce((sum, row) => sum + getSelectedWorkRvu(row), 0);
  const estimatedPendingWrvu = included
    .filter((row) => row.needsReview)
    .reduce((sum, row) => sum + getSelectedWorkRvu(row), 0);

  return {
    totalExams: included.length,
    confirmedWrvu,
    estimatedPendingWrvu,
    projectedWrvu: confirmedWrvu + estimatedPendingWrvu,
    needsReviewCount: included.filter((row) => row.needsReview).length,
    duplicateCount: skippedRows.length + rows.filter((row) => row.duplicateStatus === 'possible').length,
  };
}

export function mergeReviewSessionRows(
  currentRows: PipelineReviewRow[],
  currentSkippedRows: PipelineReviewRow[],
  nextRows: PipelineReviewRow[],
  nextSkippedRows: PipelineReviewRow[],
): { reviewRows: PipelineReviewRow[]; skippedRows: PipelineReviewRow[] } {
  const existingKeys = new Set(currentRows.map(reviewSessionExactDuplicateKey).filter((key): key is string => Boolean(key)));
  const mergedCurrentRows = [...currentRows];
  const performedRows = new Map<string, { row: PipelineReviewRow; index: number }>();
  currentRows.forEach((row, index) => {
    const key = performedStudyIdentityKey(row);
    if (key) performedRows.set(key, { row, index });
  });
  const appendRows: PipelineReviewRow[] = [];
  const duplicateRows: PipelineReviewRow[] = [];

  for (const row of nextRows) {
    const performedKey = performedStudyIdentityKey(row);
    const performedMatch = performedKey ? performedRows.get(performedKey) : null;
    if (performedMatch && (performedMatch.row.source.source === 'report_capture' || row.source.source === 'report_capture')) {
      if (performedMatch.row.source.source === 'report_capture' && row.source.source !== 'report_capture') {
        mergedCurrentRows[performedMatch.index] = {
          ...performedMatch.row,
          source: {
            ...performedMatch.row.source,
            modifiedDate: row.source.modifiedDate ?? performedMatch.row.source.modifiedDate,
            modifiedTime: row.source.modifiedTime ?? performedMatch.row.source.modifiedTime,
            modifiedDateTime: row.source.modifiedDateTime ?? performedMatch.row.source.modifiedDateTime,
            rowIndex: row.source.rowIndex ?? performedMatch.row.source.rowIndex,
          },
          duplicateReason: 'Later worklist row reconciled with this pending report capture',
        };
      }
      duplicateRows.push({
        ...row,
        included: false,
        autoSkipped: true,
        duplicateStatus: 'exact',
        duplicateReason: performedMatch.row.needsReview
          ? 'Same study is already pending approval from Report Capture'
          : 'Same study is already represented in this review session',
        approvalStatus: 'exact_duplicate_skipped',
      });
      continue;
    }
    const key = reviewSessionExactDuplicateKey(row);
    if (key && existingKeys.has(key)) {
      duplicateRows.push({
        ...row,
        included: false,
        autoSkipped: true,
        duplicateStatus: 'exact',
        duplicateReason: row.duplicateReason ?? 'Same CPT/title, exam time, and read time already exist in this active review session',
        approvalStatus: 'exact_duplicate_skipped',
      });
    } else {
      if (key) existingKeys.add(key);
      if (performedKey) performedRows.set(performedKey, { row, index: mergedCurrentRows.length + appendRows.length });
      appendRows.push(row);
    }
  }

  return {
    reviewRows: [...mergedCurrentRows, ...appendRows],
    skippedRows: [...currentSkippedRows, ...duplicateRows, ...nextSkippedRows],
  };
}

export function selectScopedActiveReviewSession<T extends { profileId: string | null; siteId?: string | null }>(
  sessions: T[],
  profileId: string | null,
  siteId?: string | null,
): T | undefined {
  return sessions.find((entry) =>
    entry.profileId === profileId &&
    (siteId === undefined || (entry.siteId ?? null) === siteId),
  );
}

export async function loadActiveReviewSession(profileId: string | null, siteId?: string | null): Promise<ReviewSessionSnapshot | null> {
  const sessions = await db.activeReviewSessions
    .where('status')
    .equals('active')
    .reverse()
    .sortBy('updatedAt');
  const session = selectScopedActiveReviewSession(sessions, profileId, siteId);
  if (!session) return null;

  try {
    const rows = JSON.parse(session.rowsJson) as PipelineReviewRow[];
    const skippedRows = JSON.parse(session.skippedRowsJson) as PipelineReviewRow[];
    const timeline = JSON.parse(session.timelineJson) as TimelineEvent[];
    return {
      sessionId: session.id,
      siteId: session.siteId ?? null,
      readingDate: session.readingDate,
      rows: Array.isArray(rows) ? rows : [],
      skippedRows: Array.isArray(skippedRows) ? skippedRows : [],
      timeline: Array.isArray(timeline) ? timeline : [],
    };
  } catch {
    return null;
  }
}

/**
 * Commits every row that's already ready (auto-approved / nothing left to
 * decide) immediately, even when another row in the batch still needs review.
 *
 * Previously this sweep lived exclusively in resolveInboxRows, which only
 * runs when the user accepts or skips a card. A batch where every row
 * matched with high confidence from the start never puts a card in front
 * of the user — Inbox shows "All caught up" immediately — so
 * resolveInboxRows was never called and those rows sat in rowsJson
 * forever, never written to studyLogs despite the UI reporting nothing
 * outstanding. Running the same sweep here, at the single place every
 * caller already persists a session, closes that gap for all of them
 * (a fresh capture, a resolved decision, or a candidate change) without
 * duplicating the eligibility logic.
 */
async function sweepQuietRows(input: {
  readingDate: string;
  profileId: string | null;
  rows: PipelineReviewRow[];
  timeline: TimelineEvent[];
}): Promise<{ rows: PipelineReviewRow[]; timeline: TimelineEvent[] }> {
  const quietRows = input.rows.filter(isReviewRowSaveEligible);
  if (quietRows.length === 0) return { rows: input.rows, timeline: input.timeline };

  await commitPipelineResults(quietRows, input.readingDate, 0, input.profileId);
  const quietIds = new Set(quietRows.map((row) => row.tempId));
  return {
    rows: input.rows.filter((row) => !quietIds.has(row.tempId)),
    timeline: [...input.timeline, createTimelineEvent(`Auto-counted ${quietRows.length} quiet ${quietRows.length === 1 ? 'study' : 'studies'}`)],
  };
}

export function __testQuietRowsForImmediateCommit(rows: PipelineReviewRow[]): PipelineReviewRow[] {
  return rows.filter(isReviewRowSaveEligible);
}

export async function persistActiveReviewSession(input: {
  sessionId: string;
  profileId: string | null;
  siteId?: string | null;
  readingDate: string;
  rows: PipelineReviewRow[];
  skippedRows: PipelineReviewRow[];
  timeline: TimelineEvent[];
}): Promise<void> {
  const swept = await sweepQuietRows(input);
  const now = new Date().toISOString();

  if (swept.rows.length === 0 && input.rows.length > 0) {
    // Everything in this batch was quiet-eligible and just got committed —
    // finalize rather than leave an empty "active" session behind.
    await db.activeReviewSessions.put({
      id: input.sessionId,
      profileId: input.profileId,
      siteId: input.siteId ?? null,
      readingDate: input.readingDate,
      status: 'finalized',
      rowsJson: '[]',
      skippedRowsJson: JSON.stringify(input.skippedRows),
      timelineJson: JSON.stringify(swept.timeline),
      ...summarizeReviewSession([], input.skippedRows),
      createdAt: now,
      updatedAt: now,
      finalizedAt: now,
    });
    return;
  }

  await db.activeReviewSessions.put({
    id: input.sessionId,
    profileId: input.profileId,
    siteId: input.siteId ?? null,
    readingDate: input.readingDate,
    status: 'active',
    rowsJson: JSON.stringify(swept.rows),
    skippedRowsJson: JSON.stringify(input.skippedRows),
    timelineJson: JSON.stringify(swept.timeline),
    ...summarizeReviewSession(swept.rows, input.skippedRows),
    createdAt: now,
    updatedAt: now,
    finalizedAt: null,
  });
}

export async function finalizeReviewSession(input: {
  sessionId: string | null;
  profileId: string | null;
  siteId: string | null;
  logDate: string;
  rows: PipelineReviewRow[];
  skippedRows: PipelineReviewRow[];
  timeline: TimelineEvent[];
}): Promise<CommitResult> {
  const result = await commitPipelineResults(input.rows, input.logDate, input.skippedRows.length, input.profileId);
  if (input.sessionId) {
    await db.activeReviewSessions.update(input.sessionId, {
      status: 'finalized',
      timelineJson: JSON.stringify([...input.timeline, createTimelineEvent('Finalized day')]),
      updatedAt: new Date().toISOString(),
      finalizedAt: new Date().toISOString(),
    });
  }
  await recordAuditEvent({
    profileId: input.profileId,
    siteId: input.siteId,
    sessionId: input.sessionId,
    logDate: input.logDate,
    action: 'day_finalized',
    summary: `Finalized ${result.importedCount} studies; ${result.reviewNeededCount} still marked for review`,
    detailsJson: JSON.stringify({ imported: result.importedCount, skipped: result.skippedCount, reviewNeeded: result.reviewNeededCount }),
  });
  return result;
}

export async function discardActiveReviewSession(input: {
  sessionId: string | null;
  profileId: string | null;
  siteId: string | null;
  logDate: string;
  reviewRowCount: number;
  skippedRowCount: number;
}): Promise<void> {
  if (!input.sessionId) return;
  await db.activeReviewSessions.update(input.sessionId, {
    status: 'discarded',
    updatedAt: new Date().toISOString(),
  });
  await recordAuditEvent({
    profileId: input.profileId,
    siteId: input.siteId,
    sessionId: input.sessionId,
    logDate: input.logDate,
    action: 'day_reopened',
    summary: 'Discarded active review session',
    detailsJson: JSON.stringify({ reviewRows: input.reviewRowCount, skippedRows: input.skippedRowCount }),
  });
}
