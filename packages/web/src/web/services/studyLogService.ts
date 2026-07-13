/**
 * studyLogService.ts
 *
 * Shared operations on committed StudyLog rows, used by History's legacy
 * table, the Inbox/History "Recent batches" undo feature, and the per-study
 * detail sheet. There is exactly one delete path (soft delete via
 * `deletedAt`, mirrored to Supabase) and one rename path (display title +
 * alias learning) -- both were previously inlined in History.tsx; batch
 * undo and the study sheet need the same behavior, so they live here once.
 */

import { db } from '../db/database';
import { supabasePersistence } from './supabasePersistence';
import { recordAuditEvent } from '../utils/audit';
import { rememberExamMapping } from './memoryLearningService';
import { normalizeRadiologyDescription } from '../utils/radiologyDescriptionNormalization';
import type { StudyLog } from '../types';

export function isDeleted(log: StudyLog): boolean {
  return Boolean((log as StudyLog & { deletedAt?: string }).deletedAt);
}

export interface DeleteStudyLogsResult {
  removedCount: number;
  removedWrvu: number;
}

export async function softDeleteStudyLogs(
  ids: string[],
  context: { profileId: string | null; summary: string },
): Promise<DeleteStudyLogsResult> {
  if (ids.length === 0) return { removedCount: 0, removedWrvu: 0 };
  const rows = await db.studyLogs.bulkGet(ids);
  const found = rows.filter((row): row is StudyLog => Boolean(row) && !isDeleted(row as StudyLog));
  if (found.length === 0) return { removedCount: 0, removedWrvu: 0 };
  const now = new Date().toISOString();
  await db.transaction('rw', db.studyLogs, async () => {
    for (const row of found) {
      await db.studyLogs.update(row.id, { deletedAt: now, updatedAt: now } as Partial<StudyLog>);
    }
  });
  await supabasePersistence.softDeleteStudyLogs(found.map((row) => row.id));
  const removedWrvu = found.reduce((sum, row) => sum + (row.workRvu ?? 0), 0);
  await recordAuditEvent({
    profileId: context.profileId,
    sessionId: found[0]?.sessionId ?? null,
    logDate: found[0]?.logDate ?? now.slice(0, 10),
    action: 'exam_deleted',
    summary: context.summary,
    detailsJson: JSON.stringify({ ids: found.map((row) => row.id), removedWrvu }),
  });
  return { removedCount: found.length, removedWrvu };
}

export async function renameStudyLog(log: StudyLog, title: string, profileId: string | null): Promise<void> {
  const trimmed = title.trim();
  if (!trimmed) return;
  const normalizedTitle = normalizeRadiologyDescription(trimmed);
  const relatedLogs = log.sessionId
    ? await db.studyLogs.where('sessionId').equals(log.sessionId).toArray()
    : [log];
  const ids = relatedLogs.map((candidate) => candidate.id);
  const now = new Date().toISOString();
  await db.transaction('rw', db.studyLogs, async () => {
    for (const id of ids) {
      await db.studyLogs.update(id, { examTitleDisplay: trimmed, examTitleNormalized: normalizedTitle, updatedAt: now } as Partial<StudyLog>);
    }
  });
  await supabasePersistence.updateStudyLogDisplayTitle(ids, trimmed, normalizedTitle);
  await rememberExamMapping({
    rawText: log.examNameRaw,
    canonicalExamName: trimmed,
    candidates: relatedLogs
      .filter((candidate) => candidate.cptCode && candidate.modifier === '26' && (candidate.workRvu ?? 0) > 0)
      .map((candidate) => ({ cptCode: candidate.cptCode!, modifier: '26', workRvu: candidate.workRvu })),
    source: 'user',
    profileId,
    siteId: null,
    sessionId: log.sessionId,
    logDate: log.logDate,
    action: 'correct',
    audit: {
      action: 'cpt_changed',
      summary: `Renamed ${log.examNameRaw} to ${trimmed}`,
      details: { logIds: ids, normalizedTitle },
    },
  });
}

export interface RecentBatch {
  sourceImportId: string;
  sourceLabel: string;
  capturedAt: string;
  studyCount: number;
  totalWrvu: number;
  logIds: string[];
}

function batchSourceLabel(logs: StudyLog[]): string {
  const sources = new Set(logs.map((log) => log.dateTimeSource ?? 'import_default'));
  if (sources.size > 1) return 'Mixed';
  const [source] = sources;
  if (source === 'ocr' || source === 'llm_ocr_cleanup') return 'Screenshot';
  if (source === 'manual') return 'Manual';
  return 'Import';
}

/** Today's commits, grouped by the one sourceImportId every row from a single Inbox Accept shares. */
export async function listRecentBatches(profileId: string | null, logDate: string): Promise<RecentBatch[]> {
  const rows = await db.studyLogs.where('logDate').equals(logDate).toArray();
  const relevant = rows.filter((row) => !isDeleted(row) && (row.profileId === profileId || row.profileId == null) && row.sourceImportId);
  const bySource = new Map<string, StudyLog[]>();
  for (const row of relevant) {
    const arr = bySource.get(row.sourceImportId!) ?? [];
    arr.push(row);
    bySource.set(row.sourceImportId!, arr);
  }
  const batches: RecentBatch[] = [];
  for (const [sourceImportId, logs] of bySource) {
    logs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    batches.push({
      sourceImportId,
      sourceLabel: batchSourceLabel(logs),
      capturedAt: logs[0].createdAt,
      studyCount: logs.length,
      totalWrvu: logs.reduce((sum, log) => sum + (log.workRvu ?? 0), 0),
      logIds: logs.map((log) => log.id),
    });
  }
  return batches.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
}

/** "2:07 PM" -> "2:07p", matching the ticket's confirm-line example exactly. */
function shortClockTime(iso: string): string {
  const formatted = new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const match = formatted.match(/^(\d+):(\d+)\s?(AM|PM)$/i);
  if (!match) return formatted;
  const [, hour, minute, ampm] = match;
  return `${hour}:${minute}${ampm[0].toLowerCase()}`;
}

export function batchConfirmLine(batch: Pick<RecentBatch, 'studyCount' | 'totalWrvu' | 'capturedAt'>): string {
  return `Remove ${batch.studyCount} stud${batch.studyCount === 1 ? 'y' : 'ies'} · ${batch.totalWrvu.toFixed(1)} wRVU · captured ${shortClockTime(batch.capturedAt)}`;
}

export async function undoBatch(batch: RecentBatch, profileId: string | null): Promise<DeleteStudyLogsResult> {
  return softDeleteStudyLogs(batch.logIds, {
    profileId,
    summary: `Undid batch: ${batch.studyCount} studies · ${batch.totalWrvu.toFixed(1)} wRVU`,
  });
}
