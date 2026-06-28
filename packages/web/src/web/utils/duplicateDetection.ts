/**
 * duplicateDetection.ts
 *
 * Identifies duplicate studies before they are committed to the database.
 * Works identically for all import sources: manual entry, OCR, CSV,
 * PowerScribe API, and future PACS integrations.
 *
 * ── Fingerprinting ────────────────────────────────────────────────────────
 * A study fingerprint is a deterministic string built from the best
 * available combination of identity fields. More fields = stronger identity.
 * Not every source provides every field — the fingerprint gracefully
 * degrades to whatever IS available.
 *
 * Priority:
 *   1. accessionNumber (globally unique per study at any institution)
 *   2. cptCode + logDate + normalized studyDateTime minute bucket (±0)
 *   3. normalizedExamName + cptCode + logDate
 *   4. modality + cptCode + logDate (weakest — only used as fallback)
 *
 * ── Duplicate confidence tiers ────────────────────────────────────────────
 *   exact        — same accession number OR identical full fingerprint
 *                  → auto-skip, no user action required
 *   very_likely  — same CPT + same date + studyDateTime within 3 minutes
 *                  → auto-skip by default, user can override
 *   possible     — same CPT + same date + studyDateTime within 15 minutes,
 *                  OR similar exam name + same CPT + same date
 *                  → show warning, ask user to decide
 */

import { db } from '../db/database';
import { normalizeExamText } from './textMatching';
import type { StudyLog } from '../types';

// ─── Types ───────────────────────────────────────────────────────────────────

export type DuplicateConfidence = 'exact' | 'very_likely' | 'possible';

export interface DuplicateMatch {
  confidence: DuplicateConfidence;
  /** The existing StudyLog that this candidate collides with */
  existingLog: StudyLog;
  /** Human-readable reason for the classification */
  reason: string;
}

export interface StudyCandidate {
  /** Raw exam name (from OCR, paste, CSV, or manual entry) */
  examNameRaw: string;
  cptCode: string | null;
  modifier: string | null;
  logDate: string;              // YYYY-MM-DD
  studyDateTime: string | null; // ISO 8601 or null
  accessionNumber: string | null;
  modality: string | null;
}

export interface DuplicateCheckResult {
  candidate: StudyCandidate;
  /** null = no duplicate found */
  match: DuplicateMatch | null;
}

// ─── Fingerprint building ────────────────────────────────────────────────────

/**
 * Builds the strongest available fingerprint string for a study.
 * Used both when saving a new study AND when checking against existing ones.
 *
 * Returns the primary fingerprint. For time-window checks (very_likely /
 * possible), the caller does the datetime arithmetic separately.
 */
export function buildFingerprint(
  examNameRaw: string,
  cptCode: string | null,
  logDate: string,
  studyDateTime: string | null,
  accessionNumber: string | null,
  modality: string | null,
): string {
  // Tier 1: accession number — strongest possible identity
  if (accessionNumber?.trim()) {
    return `acc:${accessionNumber.trim().toUpperCase()}`;
  }

  const normExam = normalizeExamText(examNameRaw);
  const cpt = cptCode?.trim() ?? 'nocpt';
  const date = logDate;

  // Tier 2: exam + CPT + date + minute bucket (0-minute precision)
  if (studyDateTime) {
    const minuteBucket = isoToMinuteBucket(studyDateTime);
    if (minuteBucket !== null) {
      return `fp:${normExam}|${cpt}|${date}|${minuteBucket}`;
    }
  }

  // Tier 3: exam + CPT + date (no time)
  if (normExam && cpt !== 'nocpt') {
    return `fp:${normExam}|${cpt}|${date}`;
  }

  // Tier 4: modality + CPT + date (weakest)
  return `fp:${modality ?? 'nomod'}|${cpt}|${date}`;
}

/** Converts an ISO datetime to "YYYY-MM-DD|HH:MM" minute bucket. */
function isoToMinuteBucket(iso: string): string | null {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  } catch {
    return null;
  }
}

/** Returns the study time as total minutes since midnight, or null. */
function isoToMinutes(iso: string | null): number | null {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return d.getHours() * 60 + d.getMinutes();
  } catch {
    return null;
  }
}

// ─── Core duplicate check ────────────────────────────────────────────────────

/**
 * Checks a single study candidate against all existing logs for that date.
 * Pass `existingLogs` if you already have them loaded (batch imports);
 * omit to load from DB directly (single-entry flow).
 */
export async function checkOneDuplicate(
  candidate: StudyCandidate,
  existingLogs?: StudyLog[],
): Promise<DuplicateMatch | null> {
  const logs =
    existingLogs ??
    (await db.studyLogs
      .where('logDate')
      .equals(candidate.logDate)
      .toArray());

  if (logs.length === 0) return null;

  const candidateFingerprint = buildFingerprint(
    candidate.examNameRaw,
    candidate.cptCode,
    candidate.logDate,
    candidate.studyDateTime,
    candidate.accessionNumber,
    candidate.modality,
  );

  const candidateMinutes = isoToMinutes(candidate.studyDateTime);
  const normCandidate = normalizeExamText(candidate.examNameRaw);

  for (const log of logs) {
    // ── Tier 1: exact — accession number match ──────────────────────────
    if (
      candidate.accessionNumber?.trim() &&
      log.accessionNumber?.trim() &&
      candidate.accessionNumber.trim().toUpperCase() ===
        log.accessionNumber.trim().toUpperCase()
    ) {
      return {
        confidence: 'exact',
        existingLog: log,
        reason: `Same accession number (${candidate.accessionNumber})`,
      };
    }

    // ── Tier 1: exact — full fingerprint match ──────────────────────────
    if (log.studyFingerprint && log.studyFingerprint === candidateFingerprint) {
      return {
        confidence: 'exact',
        existingLog: log,
        reason: 'Identical study fingerprint',
      };
    }

    // ── Tiers 2 & 3: require same CPT and same date ────────────────────
    if (!candidate.cptCode || log.cptCode !== candidate.cptCode) continue;
    if (log.logDate !== candidate.logDate) continue;

    const logMinutes = isoToMinutes(log.studyDateTime);

    // ── Tier 2: very_likely — same CPT, date, within 3 minutes ────────
    if (candidateMinutes !== null && logMinutes !== null) {
      const diffMin = Math.abs(candidateMinutes - logMinutes);
      if (diffMin <= 3) {
        return {
          confidence: 'very_likely',
          existingLog: log,
          reason: `Same CPT (${candidate.cptCode}), same date, study time ${diffMin === 0 ? 'identical' : `${diffMin} min apart`}`,
        };
      }

      // ── Tier 3: possible — same CPT, date, within 15 minutes ────────
      if (diffMin <= 15) {
        return {
          confidence: 'possible',
          existingLog: log,
          reason: `Same CPT (${candidate.cptCode}), same date, study time ${diffMin} min apart`,
        };
      }
    }

    // ── Tier 3: possible — similar exam name + same CPT, no time ──────
    if (!candidateMinutes || !logMinutes) {
      const normLog = normalizeExamText(log.examNameRaw);
      // Simple token overlap check — heavy fuzzy match not needed here,
      // we already know CPT matches
      const tokensC = new Set(normCandidate.split(' ').filter(Boolean));
      const tokensL = normLog.split(' ').filter(Boolean);
      const overlap =
        tokensL.filter((t) => tokensC.has(t)).length /
        Math.max(1, Math.min(tokensC.size, tokensL.length));

      if (overlap >= 0.7) {
        return {
          confidence: 'possible',
          existingLog: log,
          reason: `Same CPT (${candidate.cptCode}), same date, similar exam name`,
        };
      }
    }
  }

  return null;
}

/**
 * Batch duplicate check for import workflows.
 * Loads all existing logs for the target date once, then checks each
 * candidate against that set — O(candidates × existing) per date.
 * Also detects within-batch duplicates (two identical rows in the same
 * import file/paste block).
 */
export async function checkBatchDuplicates(
  candidates: StudyCandidate[],
  logDate: string,
): Promise<DuplicateCheckResult[]> {
  const existingLogs = await db.studyLogs
    .where('logDate')
    .equals(logDate)
    .toArray();

  const results: DuplicateCheckResult[] = [];
  // Track fingerprints seen so far in THIS batch to catch within-batch dupes
  const batchSeen = new Map<string, StudyCandidate>();

  for (const candidate of candidates) {
    const fp = buildFingerprint(
      candidate.examNameRaw,
      candidate.cptCode,
      candidate.logDate,
      candidate.studyDateTime,
      candidate.accessionNumber,
      candidate.modality,
    );

    // Within-batch duplicate check
    const batchPrior = batchSeen.get(fp);
    if (batchPrior) {
      results.push({
        candidate,
        match: {
          confidence: 'exact',
          existingLog: {
            // Synthesize a pseudo-log for display purposes
            id: 'batch-duplicate',
            examNameRaw: batchPrior.examNameRaw,
            cptCode: batchPrior.cptCode,
            logDate: batchPrior.logDate,
            studyDateTime: batchPrior.studyDateTime,
            accessionNumber: batchPrior.accessionNumber,
            modality: batchPrior.modality as StudyLog['modality'],
            // Required fields for type compliance
            modifier: batchPrior.modifier,
            workRvu: null,
            matchMethod: 'unmatched',
            matchConfidence: 1,
            needsReview: false,
            sessionId: null,
            sourceImportId: null,
            notes: null,
            studyFingerprint: fp,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          } as StudyLog,
          reason: 'Duplicate within this import batch',
        },
      });
      continue;
    }

    batchSeen.set(fp, candidate);

    const match = await checkOneDuplicate(candidate, existingLogs);
    results.push({ candidate, match });
  }

  return results;
}
