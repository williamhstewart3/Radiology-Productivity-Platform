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

    // v5: adds canonicalExamName, cptCodes (multi-CPT), totalWorkRvu fields.
    //     No data transform needed — new fields are optional / default to null / [].
    //     Existing single-CPT alias rows remain valid (cptCodes empty → use cptCode).
    this.version(5).stores({
      cptRvuTable: 'id, &[cptCode+modifier], cptCode, modality, statusCategory, rvuFileVersion',
      examAliases: 'id, profileId, aliasText, cptCode, canonicalExamName',
      studyLogs: 'id, profileId, logDate, cptCode, needsReview, sessionId, sourceImportId, studyFingerprint',
      dailySessions: 'id, sessionDate',
      userSettings: 'id',
      radiologistProfiles: 'id, practiceId, active, lastUsed',
      organizations: 'id',
      practices: 'id, organizationId',
    }).upgrade((trans) => {
      // Back-fill missing fields on existing aliases so the type is consistent
      return trans.table('examAliases').toCollection().modify((alias) => {
        if (!('cptCodes' in alias))       alias.cptCodes = [];
        if (!('totalWorkRvu' in alias))   alias.totalWorkRvu = null;
        if (!('canonicalExamName' in alias)) alias.canonicalExamName = null;
      });
    });

    // v6: adds watchFolderPath + autoDeleteProcessed to userSettings.
    //     Same stores, no index changes needed.
    this.version(6).stores({
      cptRvuTable: 'id, &[cptCode+modifier], cptCode, modality, statusCategory, rvuFileVersion',
      examAliases: 'id, profileId, aliasText, cptCode, canonicalExamName',
      studyLogs: 'id, profileId, logDate, cptCode, needsReview, sessionId, sourceImportId, studyFingerprint',
      dailySessions: 'id, sessionDate',
      userSettings: 'id',
      radiologistProfiles: 'id, practiceId, active, lastUsed',
      organizations: 'id',
      practices: 'id, organizationId',
    }).upgrade((trans) => {
      return trans.table('userSettings').toCollection().modify((settings) => {
        if (!('watchFolderPath' in settings))     settings.watchFolderPath = null;
        if (!('autoDeleteProcessed' in settings)) settings.autoDeleteProcessed = false;
      });
    });

    // v7: adds studyDate, dateTimeConfidence, dateTimeSource fields to studyLogs.
    //     Adds studyDate index for efficient grouping in History.
    //     Back-fills existing rows: studyDate = logDate, dateTimeSource = 'import_default',
    //     dateTimeConfidence = 0 (no OCR date was available when those rows were created).
    this.version(7).stores({
      cptRvuTable: 'id, &[cptCode+modifier], cptCode, modality, statusCategory, rvuFileVersion',
      examAliases: 'id, profileId, aliasText, cptCode, canonicalExamName',
      studyLogs: 'id, profileId, logDate, studyDate, cptCode, needsReview, sessionId, sourceImportId, studyFingerprint',
      dailySessions: 'id, sessionDate',
      userSettings: 'id',
      radiologistProfiles: 'id, practiceId, active, lastUsed',
      organizations: 'id',
      practices: 'id, organizationId',
    }).upgrade((trans) => {
      return trans.table('studyLogs').toCollection().modify((log) => {
        if (!('studyDate' in log) || log.studyDate == null) {
          log.studyDate = log.logDate ?? null;
        }
        if (!('dateTimeConfidence' in log) || log.dateTimeConfidence == null) {
          log.dateTimeConfidence = 0;
        }
        if (!('dateTimeSource' in log) || log.dateTimeSource == null) {
          log.dateTimeSource = 'import_default';
        }
      });
    });

    // v8: adds requireCropBeforeOcr to userSettings (default true — PHI protection).
    //     Same stores, no index changes needed.
    this.version(8).stores({
      cptRvuTable: 'id, &[cptCode+modifier], cptCode, modality, statusCategory, rvuFileVersion',
      examAliases: 'id, profileId, aliasText, cptCode, canonicalExamName',
      studyLogs: 'id, profileId, logDate, studyDate, cptCode, needsReview, sessionId, sourceImportId, studyFingerprint',
      dailySessions: 'id, sessionDate',
      userSettings: 'id',
      radiologistProfiles: 'id, practiceId, active, lastUsed',
      organizations: 'id',
      practices: 'id, organizationId',
    }).upgrade((trans) => {
      return trans.table('userSettings').toCollection().modify((settings) => {
        if (!('requireCropBeforeOcr' in settings)) {
          settings.requireCropBeforeOcr = true; // default ON — protect PHI
        }
      });
    });

    // v9: adds lastUsedAt index to examAliases so Settings can sort learned mappings.
    this.version(9).stores({
      cptRvuTable: 'id, &[cptCode+modifier], cptCode, modality, statusCategory, rvuFileVersion',
      examAliases: 'id, profileId, aliasText, cptCode, canonicalExamName, lastUsedAt',
      studyLogs: 'id, profileId, logDate, studyDate, cptCode, needsReview, sessionId, sourceImportId, studyFingerprint',
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
  if (existing) {
    if (!('lowComplexityThreshold' in existing)) {
      const patched = { ...existing, lowComplexityThreshold: 0.75, updatedAt: new Date().toISOString() };
      await db.userSettings.put(patched);
      return patched;
    }
    return existing;
  }

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
    watchFolderPath: null,
    autoDeleteProcessed: false,
    requireCropBeforeOcr: true,
    lowComplexityThreshold: 0.75,
  };
  await db.userSettings.put(defaults);
  return defaults;
}

/**
 * Ensures the single hidden default Organization exists.
 * This org is never shown in the UI — it simply anchors all Location records.
 */
export async function ensureDefaultOrganization(): Promise<Organization> {
  const existing = await db.organizations.get('org-default');
  if (existing) return existing;

  // Also check if any org exists from an older version
  const any = await db.organizations.limit(1).first();
  if (any) return any;

  const now = new Date().toISOString();
  const org: Organization = {
    id: 'org-default',
    name: 'Default',
    initials: 'DF',
    color: 'cyan',
    createdAt: now,
    updatedAt: now,
  };
  await db.organizations.put(org);
  return org;
}

/**
 * Ensures at least one Location (Practice) exists under the given org.
 * On first launch we do NOT create a default location — the user should
 * create their own. However if profiles already exist without a location,
 * we create a placeholder so they're not orphaned.
 */
export async function ensureDefaultPractice(organizationId: string): Promise<Practice> {
  const existing = await db.practices
    .where('organizationId')
    .equals(organizationId)
    .first();
  if (existing) return existing;

  // Only create a placeholder if profiles already exist (migration path)
  const profileCount = await db.radiologistProfiles.count();
  if (profileCount > 0) {
    const now = new Date().toISOString();
    const practice: Practice = {
      id: 'location-default',
      organizationId,
      name: 'My Location',
      city: null,
      color: 'cyan',
      createdAt: now,
      updatedAt: now,
    };
    await db.practices.put(practice);
    return practice;
  }

  // No profiles yet — create a minimal placeholder so the app doesn't crash
  const now = new Date().toISOString();
  const practice: Practice = {
    id: 'location-default',
    organizationId,
    name: 'My Location',
    city: null,
    color: 'cyan',
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
    const missingAdminFlag = allProfiles.filter((p) => !('isAdmin' in p));
    if (missingAdminFlag.length > 0) {
      const hasAdmin = allProfiles.some((p) => (p as RadiologistProfile).isAdmin === true);
      await db.transaction('rw', db.radiologistProfiles, async () => {
        for (const [index, p] of missingAdminFlag.entries()) {
          await db.radiologistProfiles.update(p.id, {
            isAdmin: hasAdmin ? false : index === 0,
            updatedAt: new Date().toISOString(),
          } as Partial<RadiologistProfile>);
        }
      });
    }

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
    isAdmin: true,
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
