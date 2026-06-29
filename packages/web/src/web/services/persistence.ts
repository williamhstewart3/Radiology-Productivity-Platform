import { db, ensureOrgHierarchy, ensureUserSettings } from '../db/database';
import type {
  Organization,
  Practice,
  RadiologistProfile,
  StudyLog,
  UserSettings,
} from '../types';

export interface ProductivityPersistence {
  ensureInitialized(): Promise<void>;
  getUserSettings(): Promise<UserSettings | undefined>;
  saveUserSettings(settings: UserSettings): Promise<void>;
  listOrganizations(): Promise<Organization[]>;
  listPracticeLocations(): Promise<Practice[]>;
  listRadiologists(): Promise<RadiologistProfile[]>;
  listStudyLogs(): Promise<StudyLog[]>;
  saveStudyLog(log: StudyLog): Promise<void>;
}

class DexieProductivityPersistence implements ProductivityPersistence {
  async ensureInitialized(): Promise<void> {
    await ensureUserSettings();
    await ensureOrgHierarchy();
  }

  getUserSettings(): Promise<UserSettings | undefined> {
    return db.userSettings.get('default');
  }

  async saveUserSettings(settings: UserSettings): Promise<void> {
    await db.userSettings.put(settings);
  }

  listOrganizations(): Promise<Organization[]> {
    return db.organizations.toArray();
  }

  listPracticeLocations(): Promise<Practice[]> {
    return db.practices.toArray();
  }

  listRadiologists(): Promise<RadiologistProfile[]> {
    return db.radiologistProfiles.toArray();
  }

  listStudyLogs(): Promise<StudyLog[]> {
    return db.studyLogs.toArray();
  }

  async saveStudyLog(log: StudyLog): Promise<void> {
    await db.studyLogs.put(log);
  }
}

export const persistence: ProductivityPersistence = new DexieProductivityPersistence();
