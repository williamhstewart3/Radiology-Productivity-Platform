import Dexie, { type Table } from 'dexie';
import type {
  CptRvuRow,
  ExamAlias,
  StudyLog,
  DailySession,
  UserSettings,
  RadiologistProfile,
  Organization,
  Practice,
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
  organizations!: Table<Organization, string>;
  practices!: Table<Practice, string>;

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
    this.version(2).stores({
      cptRvuTable: 'id, &[cptCode+modifier], cptCode, modality, statusCategory, rvuFileVersion',
      examAliases: 'id, aliasText, cptCode',
      studyLogs: 'id, logDate, cptCode, needsReview, sessionId, sourceImportId, studyFingerprint',
      dailySessions: 'id, sessionDate',
      userSettings: 'id',
    });

    // v3: adds radiologistProfiles table; adds profileId index to studyLogs and examAliases.
    this.version(3).stores({
      cptRvuTable: 'id, &[cptCode+modifier], cptCode, modality, statusCategory, rvuFileVersion',
      examAliases: 'id, profileId, aliasText, cptCode',
      studyLogs: 'id, profileId, logDate, cptCode, needsReview, sessionId, sourceImportId, studyFingerprint',
      dailySessions: 'id, sessionDate',
      userSettings: 'id',
      radiologistProfiles: 'id, active, lastUsed',
    });

    // v4: adds organizations and practices tables.
    //     adds practiceId index to radiologistProfiles.
    //     adds organizationId index to practices.
    //     No data transform needed — old rows without practiceId are sparse-indexed.
    this.version(4).stores({
      cptRvuTable: 'id, &[cptCode+modifier], cptCode, modality, statusCategory, rvuFileVersion',
      examAliases: 'id, profileId, aliasText, cptCode',
      studyLogs: 'id, profileId, logDate, cptCode, needsReview, sessionId, sourceImportId, studyFingerprint',
      dailySessions: 'id, sessionDate',
      userSettings: 'id',
      radiologistProfiles: 'id, practiceId, active, lastUsed',
      organizations: 'id',
      practices: 'id, organizationId',
    });
  }
}

export const db = new RvuDatabase();

// ─── Seed helpers ──────────────────────────────────────────────────────────────

/** Ensures a single user_settings row exists. */
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
    dailyRvuGoal: 90,
    workdayStart: '08:00',
    workdayEnd: '17:00',
    breakMinutes: 0,
  };
  await db.userSettings.put(defaults);
  return defaults;
}

/**
 * Ensures at least one Organization exists.
 * Returns the first (and typically only) organization.
 */
export async function ensureDefaultOrganization(): Promise<Organization> {
  const existing = await db.organizations.toArray();
  if (existing.length > 0) return existing[0];

  const now = new Date().toISOString();
  const org: Organization = {
    id: 'org-default',
    name: 'My Organization',
    initials: 'MO',
    color: 'indigo',
    createdAt: now,
    updatedAt: now,
  };
  await db.organizations.put(org);
  return org;
}

/**
 * Ensures at least one Practice exists under the given org.
 * Returns the first practice in the org.
 */
export async function ensureDefaultPractice(organizationId: string): Promise<Practice> {
  const existing = await db.practices
    .where('organizationId')
    .equals(organizationId)
    .first();
  if (existing) return existing;

  const now = new Date().toISOString();
  const practice: Practice = {
    id: 'practice-default',
    organizationId,
    name: 'My Practice',
    city: null,
    color: 'violet',
    createdAt: now,
    updatedAt: now,
  };
  await db.practices.put(practice);
  return practice;
}

/**
 * Ensures at least one RadiologistProfile exists, attached to the given practice.
 * If profiles exist without a practiceId, migrates them to the default practice.
 * Returns the currently active profile.
 */
export async function ensureDefaultProfile(practiceId: string): Promise<RadiologistProfile> {
  const allProfiles = await db.radiologistProfiles.toArray();

  if (allProfiles.length > 0) {
    // Migrate any legacy profiles that lack a practiceId
    const unattached = allProfiles.filter((p) => !p.practiceId);
    if (unattached.length > 0) {
      await db.transaction('rw', db.radiologistProfiles, async () => {
        for (const p of unattached) {
          await db.radiologistProfiles.update(p.id, {
            practiceId,
            updatedAt: new Date().toISOString(),
          });
        }
      });
    }

    // Return active profile
    const active = allProfiles.find((p) => p.active);
    if (active) return { ...active, practiceId: active.practiceId ?? practiceId };

    const fallback = allProfiles[0];
    await db.radiologistProfiles.update(fallback.id, { active: true });
    return { ...fallback, active: true, practiceId: fallback.practiceId ?? practiceId };
  }

  // No profiles at all — create default
  const existingSettings = await db.userSettings.get('default');
  const now = new Date().toISOString();

  const profile: RadiologistProfile = {
    id: 'profile-default',
    practiceId,
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

/**
 * Master seed: ensures org → practice → radiologist chain exists.
 * Called once on app startup. Safe to call multiple times (idempotent).
 */
export async function ensureOrgHierarchy(): Promise<{
  org: Organization;
  practice: Practice;
  profile: RadiologistProfile;
}> {
  const org = await ensureDefaultOrganization();
  const practice = await ensureDefaultPractice(org.id);
  const profile = await ensureDefaultProfile(practice.id);
  return { org, practice, profile };
}
