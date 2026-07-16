/**
 * importProvider.ts
 *
 * Canonical type definitions for the Import Provider architecture.
 *
 * Every import source — paste text, OCR screenshot, CSV, and eventually
 * PowerScribe live sync — must produce an ImportedStudy[] and feed it
 * through the shared importPipeline. No provider performs normalization,
 * alias lookup, duplicate detection, or CPT matching on its own.
 *
 * ── Data flow ────────────────────────────────────────────────────────────────
 *
 *   ImportProvider.importStudies()
 *       ↓ ImportedStudy[]
 *   importPipeline()
 *       ↓ normalize exam text
 *       ↓ alias mapping   (learnAlias on commit)
 *       ↓ duplicate detection
 *       ↓ CPT matching
 *       ↓ db.studyLogs.add()
 *
 * ── Adding a new source ──────────────────────────────────────────────────────
 *
 * 1. Create a class that implements ImportProvider.
 * 2. Implement importStudies() to return ImportedStudy[].
 * 3. The pipeline handles everything downstream — no extra wiring needed.
 * 4. Alias learning from one source immediately benefits all other sources.
 */

import type { Modality } from './index';

// ─── Canonical study model returned by every provider ──────────────────────

export type ImportSource = 'manual' | 'ocr' | 'csv' | 'powerscribe' | 'report_capture';

/**
 * One study as emitted by any ImportProvider.
 *
 * Providers supply what they know. Fields the source cannot provide should
 * be left null — the pipeline degrades gracefully.
 *
 * Do NOT perform CPT matching or alias lookup inside a provider. The
 * pipeline does that uniformly for every source.
 */
export interface ImportedStudy {
  /** Raw exam title as it appears in the source system (e.g. "CT ABDOMEN W CON") */
  examTitle: string;

  /** Clean procedure/exam name with OCR date/time columns removed. */
  procedureName?: string | null;

  /**
   * Canonical exam name if the source system already provides one.
   * If the source only gives a raw title, leave this null and let the
   * pipeline normalize it through the alias table.
   */
  canonicalExam: string | null;

  /**
   * CPT code if the source system provides it directly (e.g. PowerScribe
   * billing integration, CSV with CPT column). Leave null to let CPT
   * matching run in the pipeline.
   */
  cpt: string | null;

  /**
   * Work RVU if the source provides it. If non-null, the pipeline skips
   * CPT matching and uses this value directly — caller's responsibility
   * to ensure correctness.
   */
  workRvu: number | null;

  /** ISO date string (YYYY-MM-DD) for the performed exam date. */
  studyDate: string;

  /** Explicit performed exam date extracted from OCR, if available. */
  examDate?: string | null;

  /** Explicit performed exam time (HH:MM) extracted from OCR, if available. */
  examTime?: string | null;

  /** Full ISO datetime for the performed exam, exposed with PowerScribe column naming. */
  examDateTime?: string | null;

  /** Timezone abbreviation printed beside a report-header exam datetime. */
  examTimeZone?: string | null;

  /**
   * Full ISO 8601 datetime for the performed exam if the source provides it.
   * OCR often only provides the date, so this may be null.
   */
  studyTime: string | null;

  /**
   * ISO date string (YYYY-MM-DD) for when the exam was read/signed/modified.
   * This is the productivity date; if omitted, the pipeline falls back to studyDate.
   */
  modifiedDate?: string | null;

  /** Explicit modified/read time (HH:MM) extracted from OCR, if available. */
  modifiedTime?: string | null;

  /**
   * Full ISO 8601 datetime for when the exam was read/signed/modified.
   * Used for productivity timestamping and preferred duplicate detection.
   */
  modifiedDateTime?: string | null;

  /**
   * Modality if known from the source. If null, the pipeline infers from
   * the matched CPT code.
   */
  modality: Modality | null;

  /**
   * Accession number — strongest identity anchor for duplicate detection.
   * Provide whenever available; leave null if the source doesn't have it.
   */
  accessionNumber: string | null;

  /** Patient MRN — stored for audit purposes, never used for dedup. */
  patientMRN: string | null;

  /** Optional visible row/index number from the source table, when OCR captures it. */
  rowIndex?: string | null;

  /** PowerScribe row status when the capture engine can distinguish it. */
  powerScribeStatus?: 'check' | 'arrow' | 'unknown';

  /** OCR/parser-cleaned exam name before CPT matching, when available. */
  cleanedExamName?: string | null;

  /** OCR/parser-cleaned row text before CPT matching, when available. */
  cleanedText?: string | null;

  /** Confidence that OCR table row/procedure extraction was clean. */
  extractionConfidence?: number | null;

  /** Provider/parser-level review flag, before CPT matching. */
  parserNeedsReview?: boolean | null;

  /** Provider/parser-level explanation for why review is needed. */
  parserReviewReason?: string | null;

  /** Original OCR table row text, when different from examTitle. */
  parserRawLine?: string | null;

  /**
   * OCR engine confidence for the source image/text when this came from OCR.
   * Current Tesseract provider reports image-level confidence, so each parsed
   * study from the same screenshot receives the same score.
   */
  ocrConfidence?: number | null;

  /** Which provider emitted this study. Set by the provider itself. */
  source: ImportSource;

  /** Capture context frozen at intake so background processing cannot drift profiles/sites. */
  captureProfileId?: string | null;
  captureSiteId?: string | null;

  /** ISO timestamp of when this study was ingested by the provider. */
  importedAt: string;

  /**
   * Confidence in the studyTime/studyDate values. 0.0–1.0.
   * 1.0 = full date+time from OCR, 0.85 = date only, 0.5 = relative date,
   * 0.0 = no date found (pipeline will use logDate as fallback).
   * null = provider didn't assess confidence (treat as 0.0).
   */
  dateTimeConfidence: number | null;

  /**
   * How the date/time was determined. Passed through to StudyLog.dateTimeSource.
   * null = provider didn't set this (defaults to 'import_default' in pipeline).
   */
  dateTimeSource: import('./index').DateTimeSource | null;
}

// ─── Provider interface ────────────────────────────────────────────────────

/**
 * Every import source implements this interface.
 *
 * The provider's sole responsibility is to gather raw data from its source
 * and translate it into ImportedStudy[]. All downstream intelligence
 * (normalization, alias lookup, duplicate detection, CPT matching, DB write)
 * lives exclusively in importPipeline.ts.
 *
 * For live sources (e.g. PowerScribe), importStudies() should:
 *   1. Authenticate
 *   2. Request studies finalized since last sync
 *   3. Map each to ImportedStudy
 *   4. Return the array — let the pipeline do the rest
 */
export interface ImportProvider {
  /** Human-readable name for logging and UI labels. */
  readonly name: string;

  /** Short identifier used in sourceImportId logs. */
  readonly sourceId: ImportSource;

  /**
   * Fetch or extract studies from the underlying source.
   * May be async (API call, file read, OCR).
   * Returns an empty array rather than throwing if there is nothing to import.
   */
  importStudies(): Promise<ImportedStudy[]>;
}
