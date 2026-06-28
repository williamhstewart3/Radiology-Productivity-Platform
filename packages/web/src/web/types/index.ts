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
  cptCode: string;
  modifier: string | null;
  matchConfidence: number;
  source: 'manual' | 'ocr_confirmed' | 'seed';
  timesUsed: number;
  lastUsedAt: string | null;
  createdAt: string;
}

export type MatchMethod =
  | 'manual_cpt'
  | 'manual_name_match'
  | 'alias_match'
  | 'ocr_match'
  | 'unmatched';

/** One completed study log — the core transactional record. */
export interface StudyLog {
  id: string;
  /** Profile this log belongs to. null = legacy row (treated as default profile). */
  profileId: string | null;
  logDate: string; // YYYY-MM-DD, local calendar day
  studyDateTime: string | null;
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
 * Top-level organizational entity (e.g. "Baptist Medical Group").
 * Contains one or more practices.
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
 * A practice / site within an organization (e.g. "Memphis", "Oxford").
 * Contains one or more radiologist profiles.
 */
export interface Practice {
  id: string;
  /** Parent organization. */
  organizationId: string;
  name: string;
  /** Optional city / location label. */
  city: string | null;
  color: ProfileColor;
  createdAt: string;
  updatedAt: string;
}

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
