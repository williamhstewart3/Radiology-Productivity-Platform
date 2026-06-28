/**
 * OrgContext.tsx
 *
 * Single source of truth for the full Org → Practice → Radiologist hierarchy.
 * All components read from this context. Switching at any level updates the
 * context, and all dependent useLiveQuery hooks re-run automatically.
 *
 * Hierarchy:
 *   Organization (e.g. "Baptist Medical Group")
 *     └─ Practice (e.g. "Memphis", "Oxford")
 *          └─ RadiologistProfile (e.g. "Will", "Benjie")
 *               └─ StudyLog (all data scoped here)
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
import { db, ensureOrgHierarchy } from '../db/database';
import type {
  Organization,
  Practice,
  Location,
  RadiologistProfile,
  ProfileColor,
} from '../types';

// ─── Context shape ─────────────────────────────────────────────────────────────

export interface OrgContextValue {
  // ── Hierarchy data (live) ──────────────────────────────────────────────────
  organizations: Organization[];
  practices: Practice[];           // internal name; use `locations` in UI code
  locations: Location[];           // UI alias for practices
  radiologists: RadiologistProfile[];

  // ── Active selections ──────────────────────────────────────────────────────
  /** Active radiologist profile (fully scoped). */
  activeProfile: RadiologistProfile | null;
  /** Location (Practice) of the active radiologist. */
  activePractice: Practice | null;
  /** UI alias for activePractice */
  activeLocation: Location | null;
  /** Organization of the active practice (hidden from UI). */
  activeOrg: Organization | null;

  // ── Radiologists in the active location ───────────────────────────────────
  practiceRadiologists: RadiologistProfile[];  // internal
  locationRadiologists: RadiologistProfile[];  // UI alias
  /** All radiologists across all locations. */
  orgRadiologists: RadiologistProfile[];
  allRadiologists: RadiologistProfile[];       // UI alias for orgRadiologists

  // ── Radiologist actions ────────────────────────────────────────────────────
  switchRadiologist: (profileId: string) => Promise<void>;
  createRadiologist: (
    data: Omit<RadiologistProfile, 'id' | 'active' | 'lastUsed' | 'createdAt' | 'updatedAt'>,
  ) => Promise<RadiologistProfile>;
  updateRadiologist: (id: string, patch: Partial<RadiologistProfile>) => Promise<void>;
  deleteRadiologist: (id: string) => Promise<void>;

  // ── Location (Practice) actions ────────────────────────────────────────────
  createLocation: (
    data: Omit<Location, 'id' | 'createdAt' | 'updatedAt' | 'organizationId'>,
  ) => Promise<Location>;
  updateLocation: (id: string, patch: Partial<Location>) => Promise<void>;
  deleteLocation: (id: string) => Promise<void>;
  // Internal aliases (same operations)
  createPractice: (
    data: Omit<Practice, 'id' | 'createdAt' | 'updatedAt'>,
  ) => Promise<Practice>;
  updatePractice: (id: string, patch: Partial<Practice>) => Promise<void>;
  deletePractice: (id: string) => Promise<void>;

  // ── Organization actions (internal — not shown in UI) ─────────────────────
  createOrganization: (
    data: Omit<Organization, 'id' | 'createdAt' | 'updatedAt'>,
  ) => Promise<Organization>;
  updateOrganization: (id: string, patch: Partial<Organization>) => Promise<void>;
  deleteOrganization: (id: string) => Promise<void>;

  // ── Default org (hidden singleton) ────────────────────────────────────────
  defaultOrgId: string | null;

  // ── Ready flag ─────────────────────────────────────────────────────────────
  isReady: boolean;

  // ── Legacy compat (matches old ProfileContextValue) ───────────────────────
  profiles: RadiologistProfile[];
  switchProfile: (id: string) => Promise<void>;
  createProfile: (
    data: Omit<RadiologistProfile, 'id' | 'active' | 'lastUsed' | 'createdAt' | 'updatedAt'>,
  ) => Promise<RadiologistProfile>;
  updateProfile: (id: string, patch: Partial<RadiologistProfile>) => Promise<void>;
  deleteProfile: (id: string) => Promise<void>;
}

const OrgContext = createContext<OrgContextValue | null>(null);

// ─── Provider ──────────────────────────────────────────────────────────────────

export function OrgProvider({ children }: { children: ReactNode }) {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    ensureOrgHierarchy().then(() => setIsReady(true));
  }, []);

  // Live queries
  const organizations = useLiveQuery(() => db.organizations.toArray(), [], []) ?? [];
  const practices     = useLiveQuery(() => db.practices.toArray(), [], []) ?? [];
  const radiologists  = useLiveQuery(
    () => db.radiologistProfiles.orderBy('lastUsed').reverse().toArray(),
    [],
    [],
  ) ?? [];

  // Active radiologist
  const activeProfile = radiologists.find((r) => r.active) ?? radiologists[0] ?? null;

  // Derive active practice + org from active profile
  const activePractice = activeProfile?.practiceId
    ? (practices.find((p) => p.id === activeProfile.practiceId) ?? null)
    : null;

  const activeOrg = activePractice?.organizationId
    ? (organizations.find((o) => o.id === activePractice.organizationId) ?? null)
    : null;

  // Radiologists in the active practice
  const practiceRadiologists = activePractice
    ? radiologists.filter((r) => r.practiceId === activePractice.id)
    : radiologists;

  // All practice IDs in active org
  const orgPracticeIds = activeOrg
    ? new Set(practices.filter((p) => p.organizationId === activeOrg.id).map((p) => p.id))
    : null;

  const orgRadiologists = orgPracticeIds
    ? radiologists.filter((r) => r.practiceId && orgPracticeIds.has(r.practiceId))
    : radiologists;

  // ── Radiologist actions ──────────────────────────────────────────────────

  const switchRadiologist = useCallback(async (profileId: string) => {
    if (!activeProfile || activeProfile.id === profileId) return;
    const now = new Date().toISOString();
    await db.transaction('rw', db.radiologistProfiles, async () => {
      await db.radiologistProfiles.where('active').equals(1 as any).modify({ active: false });
      await db.radiologistProfiles.update(profileId, { active: true, lastUsed: now, updatedAt: now });
    });
  }, [activeProfile]);

  const createRadiologist = useCallback(async (
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
      await db.radiologistProfiles.where('active').equals(1 as any).modify({ active: false });
      await db.radiologistProfiles.add(newProfile);
    });
    return newProfile;
  }, []);

  const updateRadiologist = useCallback(async (id: string, patch: Partial<RadiologistProfile>) => {
    await db.radiologistProfiles.update(id, { ...patch, updatedAt: new Date().toISOString() });
  }, []);

  const deleteRadiologist = useCallback(async (id: string) => {
    const count = await db.radiologistProfiles.count();
    if (count <= 1) throw new Error('Cannot delete the last radiologist profile.');
    const wasActive = (await db.radiologistProfiles.get(id))?.active ?? false;
    await db.radiologistProfiles.delete(id);
    if (wasActive) {
      const next = await db.radiologistProfiles.orderBy('lastUsed').reverse().first();
      if (next) await db.radiologistProfiles.update(next.id, { active: true, updatedAt: new Date().toISOString() });
    }
  }, []);

  // ── Practice actions ─────────────────────────────────────────────────────

  const createPractice = useCallback(async (
    data: Omit<Practice, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<Practice> => {
    const now = new Date().toISOString();
    const practice: Practice = { ...data, id: crypto.randomUUID(), createdAt: now, updatedAt: now };
    await db.practices.add(practice);
    return practice;
  }, []);

  const updatePractice = useCallback(async (id: string, patch: Partial<Practice>) => {
    await db.practices.update(id, { ...patch, updatedAt: new Date().toISOString() });
  }, []);

  const deletePractice = useCallback(async (id: string) => {
    // Reassign radiologists to no practice (they'll be orphaned, not deleted)
    await db.radiologistProfiles.where('practiceId').equals(id).modify({ practiceId: null });
    await db.practices.delete(id);
  }, []);

  // ── Organization actions ─────────────────────────────────────────────────

  const createOrganization = useCallback(async (
    data: Omit<Organization, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<Organization> => {
    const now = new Date().toISOString();
    const org: Organization = { ...data, id: crypto.randomUUID(), createdAt: now, updatedAt: now };
    await db.organizations.add(org);
    return org;
  }, []);

  const updateOrganization = useCallback(async (id: string, patch: Partial<Organization>) => {
    await db.organizations.update(id, { ...patch, updatedAt: new Date().toISOString() });
  }, []);

  const deleteOrganization = useCallback(async (id: string) => {
    const orgPractices = await db.practices.where('organizationId').equals(id).toArray();
    for (const p of orgPractices) {
      await deletePractice(p.id);
    }
    await db.organizations.delete(id);
  }, [deletePractice]);

  // ── Location aliases (createLocation auto-injects the default org) ────────

  const defaultOrgId = organizations[0]?.id ?? null;

  const createLocation = useCallback(async (
    data: Omit<Location, 'id' | 'createdAt' | 'updatedAt' | 'organizationId'>,
  ): Promise<Location> => {
    const orgId = (await db.organizations.limit(1).first())?.id ?? 'org-default';
    return createPractice({ ...data, organizationId: orgId });
  }, [createPractice]);

  const updateLocation = updatePractice;
  const deleteLocation = deletePractice;

  // ── Value ────────────────────────────────────────────────────────────────

  const value: OrgContextValue = {
    organizations,
    practices,
    locations: practices,           // UI alias
    radiologists,
    activeProfile,
    activePractice,
    activeLocation: activePractice, // UI alias
    activeOrg,
    practiceRadiologists,
    locationRadiologists: practiceRadiologists, // UI alias
    orgRadiologists,
    allRadiologists: radiologists,  // UI alias
    switchRadiologist,
    createRadiologist,
    updateRadiologist,
    deleteRadiologist,
    createLocation,
    updateLocation,
    deleteLocation,
    createPractice,
    updatePractice,
    deletePractice,
    createOrganization,
    updateOrganization,
    deleteOrganization,
    defaultOrgId,
    isReady,
    // Legacy ProfileContext compat
    profiles: radiologists,
    switchProfile: switchRadiologist,
    createProfile: createRadiologist,
    updateProfile: updateRadiologist,
    deleteProfile: deleteRadiologist,
  };

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

// ─── Hooks ─────────────────────────────────────────────────────────────────────

export function useOrg(): OrgContextValue {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error('useOrg must be used inside <OrgProvider>');
  return ctx;
}

/** Backward-compat alias — same shape as old ProfileContextValue. */
export function useProfile(): OrgContextValue {
  return useOrg();
}
