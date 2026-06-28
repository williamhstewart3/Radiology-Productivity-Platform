import Dexie, { type Table } from 'dexie';
import type {
  CptRvuRow,
  ExamAlias,
  StudyLog,
  DailySession,
  UserSettings,
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

  constructor() {
    super('rvu_tracker_db');

    this.version(1).stores({
      cptRvuTable: 'id, &[cptCode+modifier], cptCode, modality, statusCategory, rvuFileVersion',
      examAliases: 'id, aliasText, cptCode',
      studyLogs: 'id, logDate, cptCode, needsReview, sessionId, sourceImportId',
      dailySessions: 'id, sessionDate',
      userSettings: 'id',
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
  };
  await db.userSettings.put(defaults);
  return defaults;
}
