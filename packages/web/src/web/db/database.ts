import Dexie, { type Table } from 'dexie';
import type {
  CptRvuRow,
  ExamAlias,
  StudyLog,
  DailySession,
  UserSettings,
  RadiologistProfile,
} from '../types';

/**
 * Local-first database. Phase 1 uses IndexedDB via Dexie exclusively.
 * Table shapes are designed to map 1:1 onto Postgres tables of the same
 * name in Phase 2 (Supabase), so a future sync layer is a data-migration
 * problem, not a schema-redesign problem.
 */
export class RvuDatabase extends Dexie {
  cptRvuTable!: Table<CptRvuRow, string>;
  examAliases!: Table<ExamAlias, string>;
  studyLogs!: Table<StudyLog, string>;
  dailySessions!: Table<DailySession, string>;
  userSettings!: Table<UserSettings, string>;
  radiologistProfiles!: Table<RadiologistProfile, string>;

  constructor() {
    super('rvu_tracker_db');

    this.version(1).stores({
      cptRvuTable: 'id, &[cptCode+modifier], cptCode, modality, statusCategory, rvuFileVersion',
      examAliases: 'id, aliasText, cptCode',
      studyLogs: 'id, logDate, cptCode, needsReview, sessionId, sourceImportId',
      dailySessions: 'id, sessionDate',
      userSettings: 'id',
    });

    // v2: adds studyFingerprint index for O(1) duplicate detection.
    // Existing rows without a fingerprint are left as-is; Dexie handles
    // sparse indexes — null/undefined values are simply not indexed.
    this.version(2).stores({
      cptRvuTable: 'id, &[cptCode+modifier], cptCode, modality, statusCategory, rvuFileVersion',
      examAliases: 'id, aliasText, cptCode',
      studyLogs: 'id, logDate, cptCode, needsReview, sessionId, sourceImportId, studyFingerprint',
      dailySessions: 'id, sessionDate',
      userSettings: 'id',
    });

    // v3: adds radiologistProfiles table; adds profileId index to studyLogs
    // and examAliases. No data transform needed — old rows without profileId
    // are sparse-indexed (null/undefined not indexed), and are treated as
    // belonging to the default profile at query time.
    this.version(3).stores({
      cptRvuTable: 'id, &[cptCode+modifier], cptCode, modality, statusCategory, rvuFileVersion',
      examAliases: 'id, profileId, aliasText, cptCode',
      studyLogs: 'id, profileId, logDate, cptCode, needsReview, sessionId, sourceImportId, studyFingerprint',
      dailySessions: 'id, sessionDate',
      userSettings: 'id',
      radiologistProfiles: 'id, active, lastUsed',
    });
  }
}

export const db = new RvuDatabase();

/** Ensures a single user_settings row exists, creating sane defaults if not. */
export async function ensureUserSettings(): Promise<UserSettings> {
  const existing = await db.userSettings.get('default');
  if (existing) return existing;

  const defaults: UserSettings = {
    id: 'default',
    annualRvuGoal: 15000,
    fiscalYearStartMonth: 1,
    lowConfidenceThreshold: 0.75,
    defaultRvuType: 'work',
    workdaysPerWeek: 5,
    vacationDaysPlanned: 0,
    activeRvuFileVersion: 'RVU26A',
    theme: 'system',
    updatedAt: new Date().toISOString(),
    // Daily Pace defaults
    dailyRvuGoal: 90,
    workdayStart: '08:00',
    workdayEnd: '17:00',
    breakMinutes: 0,
  };
  await db.userSettings.put(defaults);
  return defaults;
}

/**
 * Ensures at least one RadiologistProfile exists.
 * If none exist, creates a "Default" profile and marks it active.
 * Also migrates goal/schedule fields from userSettings → default profile
 * so first-time users don't lose their existing config.
 * Returns the currently active profile.
 */
export async function ensureDefaultProfile(): Promise<RadiologistProfile> {
  const count = await db.radiologistProfiles.count();

  if (count > 0) {
    // Return whichever profile is marked active (or most recently used)
    const active = await db.radiologistProfiles
      .where('active')
      .equals(1 as any)
      .first();
    if (active) return active;

    // Fallback: most recently used
    const all = await db.radiologistProfiles.orderBy('lastUsed').reverse().first();
    if (all) {
      await db.radiologistProfiles.update(all.id, { active: true });
      return { ...all, active: true };
    }
  }

  // No profiles yet — create default, inheriting any existing userSettings
  const existingSettings = await db.userSettings.get('default');
  const now = new Date().toISOString();

  const profile: RadiologistProfile = {
    id: 'profile-default',
    name: 'My Profile',
    initials: 'ME',
    color: 'indigo',
    active: true,
    lastUsed: now,
    dailyRvuGoal: existingSettings?.dailyRvuGoal ?? 90,
    annualRvuGoal: existingSettings?.annualRvuGoal ?? 15000,
    fiscalYearStartMonth: existingSettings?.fiscalYearStartMonth ?? 1,
    workdayStart: existingSettings?.workdayStart ?? '08:00',
    workdayEnd: existingSettings?.workdayEnd ?? '17:00',
    breakMinutes: existingSettings?.breakMinutes ?? 0,
    powerScribeUsername: null,
    powerScribeLastSync: null,
    createdAt: now,
    updatedAt: now,
  };

  await db.radiologistProfiles.put(profile);
  return profile;
}
