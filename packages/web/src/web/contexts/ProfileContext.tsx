/**
 * ProfileContext.tsx
 *
 * Single source of truth for the active radiologist profile.
 * All components read activeProfile from this context rather than
 * querying the DB directly — switching profile updates the context
 * and all dependent useLiveQuery hooks re-run automatically.
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, ensureDefaultProfile } from '../db/database';
import type { RadiologistProfile } from '../types';

// ─── Context shape ────────────────────────────────────────────────────────────

interface ProfileContextValue {
  /** The currently active profile. null only during initial load. */
  activeProfile: RadiologistProfile | null;
  /** All profiles, sorted by lastUsed desc. */
  profiles: RadiologistProfile[];
  /** Switch to a different profile by id. */
  switchProfile: (id: string) => Promise<void>;
  /** Create a new profile (marks it active). */
  createProfile: (data: Omit<RadiologistProfile, 'id' | 'active' | 'lastUsed' | 'createdAt' | 'updatedAt'>) => Promise<RadiologistProfile>;
  /** Update fields on a profile (non-destructive merge). */
  updateProfile: (id: string, patch: Partial<RadiologistProfile>) => Promise<void>;
  /** Delete a profile. Refuses if it's the last one. */
  deleteProfile: (id: string) => Promise<void>;
  /** Whether the profile system is ready (default profile ensured). */
  isReady: boolean;
}

const ProfileContext = createContext<ProfileContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

interface ProfileProviderProps {
  children: ReactNode;
}

export function ProfileProvider({ children }: ProfileProviderProps) {
  const [isReady, setIsReady] = useState(false);

  // Ensure default profile exists on mount
  useEffect(() => {
    ensureDefaultProfile().then(() => setIsReady(true));
  }, []);

  // Live-query all profiles — auto-updates when DB changes
  const rawProfiles = useLiveQuery(
    () =>
      db.radiologistProfiles
        .orderBy('lastUsed')
        .reverse()
        .toArray(),
    [],
    [],
  );

  const profiles = rawProfiles ?? [];

  // Active profile = the one marked active, or the first one
  const activeProfile = profiles.find((p) => p.active) ?? profiles[0] ?? null;

  const switchProfile = useCallback(async (id: string) => {
    if (!activeProfile || activeProfile.id === id) return;
    const now = new Date().toISOString();
    // Deactivate all, activate selected
    await db.transaction('rw', db.radiologistProfiles, async () => {
      await db.radiologistProfiles
        .where('active')
        .equals(1 as any)
        .modify({ active: false });
      await db.radiologistProfiles.update(id, {
        active: true,
        lastUsed: now,
        updatedAt: now,
      });
    });
  }, [activeProfile]);

  const createProfile = useCallback(
    async (
      data: Omit<RadiologistProfile, 'id' | 'active' | 'lastUsed' | 'createdAt' | 'updatedAt'>,
    ): Promise<RadiologistProfile> => {
      const now = new Date().toISOString();
      const newProfile: RadiologistProfile = {
        ...data,
        id: crypto.randomUUID(),
        active: true,
        lastUsed: now,
        createdAt: now,
        updatedAt: now,
      };

      await db.transaction('rw', db.radiologistProfiles, async () => {
        // Deactivate current active
        await db.radiologistProfiles
          .where('active')
          .equals(1 as any)
          .modify({ active: false });
        await db.radiologistProfiles.add(newProfile);
      });

      return newProfile;
    },
    [],
  );

  const updateProfile = useCallback(async (id: string, patch: Partial<RadiologistProfile>) => {
    await db.radiologistProfiles.update(id, {
      ...patch,
      updatedAt: new Date().toISOString(),
    });
  }, []);

  const deleteProfile = useCallback(async (id: string) => {
    const count = await db.radiologistProfiles.count();
    if (count <= 1) {
      throw new Error('Cannot delete the last profile.');
    }

    const wasActive = (await db.radiologistProfiles.get(id))?.active ?? false;
    await db.radiologistProfiles.delete(id);

    if (wasActive) {
      // Activate the most recently used remaining profile
      const next = await db.radiologistProfiles
        .orderBy('lastUsed')
        .reverse()
        .first();
      if (next) {
        await db.radiologistProfiles.update(next.id, {
          active: true,
          updatedAt: new Date().toISOString(),
        });
      }
    }
  }, []);

  const value: ProfileContextValue = {
    activeProfile,
    profiles,
    switchProfile,
    createProfile,
    updateProfile,
    deleteProfile,
    isReady,
  };

  return (
    <ProfileContext.Provider value={value}>
      {children}
    </ProfileContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useProfile(): ProfileContextValue {
  const ctx = useContext(ProfileContext);
  if (!ctx) {
    throw new Error('useProfile must be used inside <ProfileProvider>');
  }
  return ctx;
}
