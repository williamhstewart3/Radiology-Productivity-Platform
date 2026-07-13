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
  cptCodes?: string[] | null;
  modifier: string | null;
  logDate: string;              // YYYY-MM-DD
  studyDateTime: string | null; // Modified/read ISO 8601 or null
  performedDateTime?: string | null;
  modifiedDateTime?: string | null;
  studyDate: string | null;
  accessionNumber: string | null;
  rowIndex: string | null;
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
  identity?: {
    cptCodes?: string[] | null;
    performedDateTime?: string | null;
    modifiedDateTime?: string | null;
  },
): string {
  // Tier 1: accession number — strongest possible identity
  const accessionAnchor = normalizeAccessionAnchor(accessionNumber);
  if (accessionAnchor) {
    return `acc:${accessionAnchor}`;
  }

  const normExam = normalizeExamText(examNameRaw);
  const cptSet = normalizeCptSet(identity?.cptCodes?.length ? identity.cptCodes : cptCode ? [cptCode] : []);
  const performedBucket = isoToExactMinuteBucket(identity?.performedDateTime ?? null);
  const modifiedBucket = isoToExactMinuteBucket(identity?.modifiedDateTime ?? studyDateTime ?? null);
  const date = logDate;

  // Tier 2: strict OCR/import identity. Missing either timestamp is not strong enough to auto-skip.
  if (cptSet && performedBucket && modifiedBucket) {
    return `strict:${cptSet}|exam:${performedBucket}|read:${modifiedBucket}`;
  }

  // Weak fallback only for review context. Missing/uncertain time is not strong enough to
  // auto-skip another same-title same-CPT study from a busy worklist day.
  const cpt = cptCode?.trim() ?? 'nocpt';
  if (normExam && cpt !== 'nocpt') {
    return `weak:${normExam}|${cpt}|${date}`;
  }

  return `weak:${modality ?? 'nomod'}|${cpt}|${date}`;
}

export function isStrongDuplicateFingerprint(fingerprint: string | null | undefined): boolean {
  return Boolean(fingerprint?.startsWith('acc:') || fingerprint?.startsWith('strict:'));
}

function batchDuplicateKey(candidate: StudyCandidate): string | null {
  const fingerprint = buildFingerprint(
    candidate.examNameRaw,
    candidate.cptCode,
    candidate.logDate,
    candidate.studyDateTime,
    candidate.accessionNumber,
    candidate.modality,
    {
      cptCodes: candidate.cptCodes,
      performedDateTime: candidate.performedDateTime,
      modifiedDateTime: candidate.modifiedDateTime ?? candidate.studyDateTime,
    },
  );
  return isStrongDuplicateFingerprint(fingerprint) ? fingerprint : null;
}

export function __testBatchDuplicateKey(candidate: StudyCandidate): string | null {
  return batchDuplicateKey(candidate);
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

function isoToDate(iso: string | null): string | null {
  return iso?.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
}

function isoToExactMinuteBucket(iso: string | null): string | null {
  if (!iso) return null;
  const date = isoToDate(iso);
  const minute = isoToMinuteBucket(iso);
  return date && minute ? `${date}T${minute}` : null;
}

function normalizeCptSet(cptCodes: Array<string | null | undefined>): string | null {
  const normalized = [...new Set(cptCodes.map((code) => code?.trim()).filter((code): code is string => Boolean(code)))].sort();
  return normalized.length > 0 ? normalized.join('+') : null;
}

function normalizeAccessionAnchor(accessionNumber: string | null | undefined): string | null {
  const accession = accessionNumber?.trim().toUpperCase();
  if (!accession) return null;
  const compact = accession.replace(/[\s-]/g, '');
  if (/^\d{3,4}(?:AM|PM)?$/.test(compact)) return null;
  if (/^\d{5,8}$/.test(compact) && (/20\d{2}/.test(compact) || compact.length === 8)) return null;
  return accession;
}

function strictFingerprintForLog(log: StudyLog): string | null {
  return buildFingerprint(
    log.examNameRaw,
    log.cptCode,
    log.logDate,
    log.studyDateTime,
    log.accessionNumber,
    log.modality,
    {
      cptCodes: log.cptCode ? [log.cptCode] : [],
      performedDateTime: log.examDateTime ?? null,
      modifiedDateTime: log.studyDateTime,
    },
  );
}

export function sameMinute(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  return isoToDate(a) === isoToDate(b) && isoToMinuteBucket(a) === isoToMinuteBucket(b);
}

function hasStrictDateTimeIdentity(candidate: StudyCandidate): boolean {
  return Boolean(candidate.performedDateTime && (candidate.modifiedDateTime ?? candidate.studyDateTime));
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
    {
      cptCodes: candidate.cptCodes,
      performedDateTime: candidate.performedDateTime,
      modifiedDateTime: candidate.modifiedDateTime ?? candidate.studyDateTime,
    },
  );

  const candidateMinutes = isoToMinutes(candidate.studyDateTime);
  const normCandidate = normalizeExamText(candidate.examNameRaw);

  for (const log of logs) {
    // ── Tier 1: exact — accession number match ──────────────────────────
    if (
      normalizeAccessionAnchor(candidate.accessionNumber) &&
      normalizeAccessionAnchor(log.accessionNumber) &&
      normalizeAccessionAnchor(candidate.accessionNumber) ===
        normalizeAccessionAnchor(log.accessionNumber)
    ) {
      return {
        confidence: 'exact',
        existingLog: log,
        reason: `Same accession number (${candidate.accessionNumber})`,
      };
    }

    // ── Tier 1: exact — full fingerprint match ──────────────────────────
    if (
      isStrongDuplicateFingerprint(candidateFingerprint) &&
      (
        (isStrongDuplicateFingerprint(log.studyFingerprint) && log.studyFingerprint === candidateFingerprint) ||
        strictFingerprintForLog(log) === candidateFingerprint
      )
    ) {
      return {
        confidence: 'exact',
        existingLog: log,
        reason: 'Same CPT set, performed time, and read time',
      };
    }

    const normLog = normalizeExamText(log.examNameRaw);
    if (normCandidate && normLog === normCandidate) {
      if (sameMinute(candidate.studyDateTime, log.studyDateTime)) {
        return {
          confidence: 'possible',
          existingLog: log,
          reason: hasStrictDateTimeIdentity(candidate)
            ? 'Same exam title and read timestamp without full duplicate identity'
            : 'Possible duplicate - missing time',
        };
      }

      if (!candidate.studyDateTime && !log.studyDateTime && candidate.studyDate && log.studyDate && candidate.studyDate === log.studyDate) {
        return {
          confidence: 'possible',
          existingLog: log,
          reason: 'Possible duplicate - missing time',
        };
      }

      if (candidate.rowIndex && log.rowIndex && candidate.rowIndex === log.rowIndex) {
        return {
          confidence: 'possible',
          existingLog: log,
          reason: 'Same exam title and visible row number',
        };
      }
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
          confidence: 'possible',
          existingLog: log,
          reason: `Same CPT (${candidate.cptCode}), same date, study time ${diffMin} min apart`,
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
          reason: hasStrictDateTimeIdentity(candidate)
            ? `Same CPT (${candidate.cptCode}), same date, similar exam name`
            : 'Possible duplicate - missing time',
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
  const candidateDates = [
    ...new Set(
      candidates
        .flatMap((c) => [c.logDate || logDate, c.studyDate])
        .filter((date): date is string => Boolean(date)),
    ),
  ];
  const logsByDate = new Map<string, StudyLog[]>();
  for (const date of candidateDates) {
    logsByDate.set(
      date,
      await db.studyLogs
        .where('logDate')
        .equals(date)
        .toArray(),
    );
  }

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
      {
        cptCodes: candidate.cptCodes,
        performedDateTime: candidate.performedDateTime,
        modifiedDateTime: candidate.modifiedDateTime ?? candidate.studyDateTime,
      },
    );
    const batchKey = isStrongDuplicateFingerprint(fp) ? fp : null;

    // Within-batch duplicate check
    const batchPrior = batchKey ? batchSeen.get(batchKey) : null;
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
            examDateTime: batchPrior.performedDateTime ?? null,
            studyDate: batchPrior.studyDate ?? batchPrior.logDate,
            dateTimeConfidence: batchPrior.studyDateTime ? 1 : 0,
            dateTimeSource: batchPrior.studyDateTime ? 'ocr' : 'import_default',
            accessionNumber: batchPrior.accessionNumber,
            rowIndex: batchPrior.rowIndex,
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

    if (batchKey) {
      batchSeen.set(batchKey, candidate);
    }

    const candidateLogDate = candidate.logDate || logDate;
    const existingLogs = [
      ...(logsByDate.get(candidateLogDate) ?? []),
      ...(candidate.studyDate && candidate.studyDate !== candidateLogDate
        ? logsByDate.get(candidate.studyDate) ?? []
        : []),
    ];

    const match = await checkOneDuplicate(candidate, existingLogs);
    results.push({ candidate, match });
  }

  return results;
}
