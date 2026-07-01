import { db } from '../db/database';
import { commitPipelineResults } from '../pipeline/importPipeline';
import type { CommitResult, PipelineReviewRow } from '../pipeline/importPipeline';
import { recordAuditEvent } from '../utils/audit';
import { normalizeRadiologyDescription } from '../utils/radiologyDescriptionNormalization';

export type TimelineEvent = { id: string; at: string; label: string };

export interface ReviewSessionSnapshot {
  sessionId: string;
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
  return normalizeRadiologyDescription(row.source.examTitle);
}

export function reviewSessionRowKey(row: PipelineReviewRow): string {
  return [
    normalizedExamKey(row),
    row.source.studyTime ?? '',
    row.source.studyDate ?? '',
    row.source.accessionNumber ?? '',
  ].join('|');
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
  const existingKeys = new Set(currentRows.map(reviewSessionRowKey));
  const appendRows: PipelineReviewRow[] = [];
  const duplicateRows: PipelineReviewRow[] = [];

  for (const row of nextRows) {
    const key = reviewSessionRowKey(row);
    if (existingKeys.has(key)) {
      duplicateRows.push({
        ...row,
        included: false,
        autoSkipped: true,
        duplicateStatus: row.duplicateStatus ?? 'very_likely',
        duplicateReason: row.duplicateReason ?? 'Duplicate already exists in this active review session',
      });
    } else {
      existingKeys.add(key);
      appendRows.push(row);
    }
  }

  return {
    reviewRows: [...currentRows, ...appendRows],
    skippedRows: [...currentSkippedRows, ...duplicateRows, ...nextSkippedRows],
  };
}

export async function loadActiveReviewSession(profileId: string | null): Promise<ReviewSessionSnapshot | null> {
  const sessions = await db.activeReviewSessions
    .where('status')
    .equals('active')
    .reverse()
    .sortBy('updatedAt');
  const session = sessions.find((entry) => entry.profileId === profileId) ?? sessions[0];
  if (!session) return null;

  try {
    const rows = JSON.parse(session.rowsJson) as PipelineReviewRow[];
    const skippedRows = JSON.parse(session.skippedRowsJson) as PipelineReviewRow[];
    const timeline = JSON.parse(session.timelineJson) as TimelineEvent[];
    return {
      sessionId: session.id,
      readingDate: session.readingDate,
      rows: Array.isArray(rows) ? rows : [],
      skippedRows: Array.isArray(skippedRows) ? skippedRows : [],
      timeline: Array.isArray(timeline) ? timeline : [],
    };
  } catch {
    return null;
  }
}

export async function persistActiveReviewSession(input: {
  sessionId: string;
  profileId: string | null;
  readingDate: string;
  rows: PipelineReviewRow[];
  skippedRows: PipelineReviewRow[];
  timeline: TimelineEvent[];
}): Promise<void> {
  const now = new Date().toISOString();
  await db.activeReviewSessions.put({
    id: input.sessionId,
    profileId: input.profileId,
    readingDate: input.readingDate,
    status: 'active',
    rowsJson: JSON.stringify(input.rows),
    skippedRowsJson: JSON.stringify(input.skippedRows),
    timelineJson: JSON.stringify(input.timeline),
    ...summarizeReviewSession(input.rows, input.skippedRows),
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
