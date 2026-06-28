// Core domain types for the RVU tracker.
// These map 1:1 to the database schema documented in the PRD and are
// designed to translate cleanly to a Postgres/Supabase schema in Phase 2.

export type Modality =
  | 'CT'
  | 'MRI'
  | 'US'
  | 'XR'
  | 'NM_PET'
  | 'MAMMO'
  | 'FLUORO'
  | 'PROCEDURE'
  | 'OTHER';

export const MODALITIES: Modality[] = [
  'CT',
  'MRI',
  'US',
  'XR',
  'NM_PET',
  'MAMMO',
  'FLUORO',
  'PROCEDURE',
  'OTHER',
];

export const MODALITY_LABELS: Record<Modality, string> = {
  CT: 'CT',
  MRI: 'MRI',
  US: 'Ultrasound',
  XR: 'X-Ray',
  NM_PET: 'NM / PET',
  MAMMO: 'Mammography',
  FLUORO: 'Fluoroscopy',
  PROCEDURE: 'Procedures (IR/Biopsy)',
  OTHER: 'Other',
};

/** PFS status indicator categories — used to decide whether a code should
 * be suggested as a default match. We never silently mutate these. */
export type StatusCategory = 'active' | 'restricted' | 'excluded' | 'unknown';

export type PcTcIndicator = 'global' | 'professional' | 'technical' | 'na';

/** One row from the CMS PFS Relative Value File. */
export interface CptRvuRow {
  id: string;
  cptCode: string;
  modifier: string | null;
  description: string;
  workRvu: number | null;
  nonFacilityPeRvu: number | null;
  facilityPeRvu: number | null;
  malpracticeRvu: number | null;
  totalRvuNonFacility: number | null;
  totalRvuFacility: number | null;
  statusCode: string;
  statusCategory: StatusCategory;
  globalDays: string | null;
  pcTcIndicator: PcTcIndicator;
  modality: Modality;
  rvuFileVersion: string;
  effectiveDate: string;
  isUserVerified: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Local exam-name -> CPT alias, fully user editable. */
export interface ExamAlias {
  id: string;
  /** Profile this alias belongs to. null = legacy row (treated as default profile). */
  profileId: string | null;
  aliasText: string;
  aliasTextRaw: string;
  /**
   * The canonical exam name selected from the library (e.g. "CTA Head and Neck with Contrast").
   * Stored for display in Settings and for future multi-CPT grouping.
   */
  canonicalExamName: string | null;
  /**
   * Primary CPT code for this alias (used for single-CPT fast-path lookups).
   * For multi-CPT exams (e.g. CTA Head+Neck → 70496-26 + 70498-26), this
   * holds the first / highest-RVU code; the full list is in cptCodes.
   */
  cptCode: string;
  modifier: string | null;
  /**
   * All CPT codes for this exam, each serialized as "CPTCODE" or "CPTCODE-MOD".
   * Empty array = legacy single-code alias (treat cptCode+modifier as the only entry).
   */
  cptCodes: string[];
  /** Sum of work RVUs for all professional-component CPTs in cptCodes. */
  totalWorkRvu: number | null;
  matchConfidence: number;
  source: 'manual' | 'ocr_confirmed' | 'seed' | 'user';
  timesUsed: number;
  lastUsedAt: string | null;
  createdAt: string;
}

export type MatchMethod =
  | 'manual_cpt'
  | 'manual_name_match'
  | 'alias_match'
  | 'ocr_match'
  | 'radiology_match'
  | 'unmatched';

/** Source of the study date/time — used to show confidence indicators in UI. */
export type DateTimeSource = 'ocr' | 'import_default' | 'manual' | 'api_future';

/** One completed study log — the core transactional record. */
export interface StudyLog {
  id: string;
  /** Profile this log belongs to. null = legacy row (treated as default profile). */
  profileId: string | null;
  logDate: string; // YYYY-MM-DD, local calendar day (= studyDate when OCR-confirmed)
  studyDateTime: string | null; // Full ISO 8601 datetime if known, else null
  /**
   * YYYY-MM-DD extracted from OCR or source data — distinct from logDate so
   * we can show it was OCR-confirmed vs just the import day.
   * When OCR provides a date, logDate is set to this value.
   */
  studyDate: string | null;
  /**
   * Confidence score for the date/time extraction. 0.0–1.0.
   * 1.0 = exact OCR match (date + time), 0.85 = date only, 0.5 = relative,
   * 0.0 = fallback (import date used).
   * null = legacy row (pre-v7).
   */
  dateTimeConfidence: number | null;
  /**
   * How the date/time was determined.
   * null = legacy row (pre-v7).
   */
  dateTimeSource: DateTimeSource | null;
  examNameRaw: string;
  cptCode: string | null;
  modifier: string | null;
  workRvu: number | null; // SNAPSHOT — immutable even if RVU table updates later
  modality: Modality | null;
  matchMethod: MatchMethod;
  matchConfidence: number;
  needsReview: boolean;
  accessionNumber: string | null;
  sessionId: string | null;
  sourceImportId: string | null;
  notes: string | null;
  /**
   * Deterministic identity fingerprint. Built at save time from the best
   * available combination of: accession number, CPT code, logDate,
   * studyDateTime, and normalized exam name. Used for duplicate detection
   * across all import sources. Indexed in Dexie for fast lookup.
   */
  studyFingerprint: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Optional shift/session tracking for hourly-rate calculations. */
export interface DailySession {
  id: string;
  sessionDate: string;
  startTime: string | null;
  endTime: string | null;
  manualHours: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserSettings {
  id: string;
  annualRvuGoal: number;
  fiscalYearStartMonth: number;
  lowConfidenceThreshold: number;
  defaultRvuType: 'work';
  workdaysPerWeek: number;
  vacationDaysPlanned: number;
  activeRvuFileVersion: string;
  theme: 'light' | 'dark' | 'system';
  updatedAt: string;
  // Daily Pace settings
  dailyRvuGoal: number;
  workdayStart: string;  // "HH:MM" 24-hr
  workdayEnd: string;    // "HH:MM" 24-hr
  breakMinutes: number;
  // PowerScribe Watcher settings
  watchFolderPath: string | null;
  autoDeleteProcessed: boolean;
}

/** Color accent for a radiologist profile, practice, or org. */
export type ProfileColor =
  | 'indigo'
  | 'violet'
  | 'emerald'
  | 'amber'
  | 'rose'
  | 'cyan'
  | 'orange'
  | 'teal';

/**
 * Top-level organizational entity — kept for future multi-org support.
 * NOT exposed in the UI. A single hidden default org is created on startup.
 */
export interface Organization {
  id: string;
  name: string;
  /** Short initials (≤3 chars) for avatar. */
  initials: string;
  color: ProfileColor;
  createdAt: string;
  updatedAt: string;
}

/**
 * A Location represents where a radiologist works or the coverage group
 * they belong to (e.g. "Baptist Hospital North MS", "Night Coverage").
 *
 * Internally stored as a `Practice` row — the organizationId always points
 * to the single hidden default org. The UI only ever says "Location".
 */
export interface Practice {
  id: string;
  /** Always points to the hidden default organization. */
  organizationId: string;
  /** Full location name shown in UI, e.g. "Baptist Memorial Hospital–Memphis" */
  name: string;
  /**
   * Optional short code (≤4 chars) shown where screen space is limited.
   * e.g. "MEM", "NIGHTS", "REMOTE". Stored in the `city` column.
   */
  city: string | null;
  color: ProfileColor;
  createdAt: string;
  updatedAt: string;
}

/** UI alias: Location is a Practice in the data layer. */
export type Location = Practice;

/** One radiologist / user context. All study data is scoped to a profile. */
export interface RadiologistProfile {
  id: string;
  /** Parent practice. null = legacy / unassigned. */
  practiceId: string | null;
  /** Display name shown in the UI. */
  name: string;
  /** Short initials (≤3 chars) shown in the avatar bubble. */
  initials: string;
  /** Accent color for this profile. */
  color: ProfileColor;
  /** Whether this is the currently active profile. Only one row has true. */
  active: boolean;
  /** ISO timestamp of last time this profile was the active one. */
  lastUsed: string;

  // ── Goal + schedule (per-radiologist) ────────────────────────────────────
  dailyRvuGoal: number;
  annualRvuGoal: number;
  fiscalYearStartMonth: number;
  workdayStart: string;  // "HH:MM" 24-hr
  workdayEnd: string;    // "HH:MM" 24-hr
  breakMinutes: number;

  // ── PowerScribe (stub — unused until live integration) ────────────────────
  powerScribeUsername: string | null;
  powerScribeLastSync: string | null;

  createdAt: string;
  updatedAt: string;
}

/** A candidate CPT match returned by the matcher, before user confirmation. */
export interface MatchCandidate {
  cptCode: string;
  modifier: string | null;
  description: string;
  workRvu: number | null;
  modality: Modality;
  confidence: number;
  method: MatchMethod;
}

export type DuplicateStatus = 'exact' | 'very_likely' | 'possible' | null;

/** One row in the OCR review table, prior to being written to study_logs. */
export interface OcrReviewRow {
  tempId: string;
  rawText: string;
  parsedExamName: string;
  studyDateTime: string | null;
  accessionNumber: string | null;
  candidates: MatchCandidate[];
  selectedCandidateIndex: number | null; // null = unmatched, needs manual pick
  needsReview: boolean;
  included: boolean; // user can exclude a row (e.g. duplicate/garbage line)
  /** Duplicate detection result. null = no duplicate found. */
  duplicateStatus: DuplicateStatus;
  /** ID of the existing log this row collides with, if any. */
  duplicateExistingLogId: string | null;
  /** Human-readable reason for the duplicate classification. */
  duplicateReason: string | null;
}
