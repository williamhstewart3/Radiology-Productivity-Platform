# Multi-Organization Architecture — TASK

## Hierarchy
Organization → Practice → Radiologist (RadiologistProfile) → StudyLog

## New Types Needed
- `Organization` { id, name, initials, color, createdAt, updatedAt }
- `Practice`     { id, organizationId, name, city, createdAt, updatedAt }
- `RadiologistProfile` += { practiceId: string | null }  (new FK)

## DB: Dexie v4
- New tables: `organizations`, `practices`
- `radiologistProfiles` gains `practiceId` index
- Migration: ensureDefaultOrg() + ensureDefaultPractice() + attach default profile to default practice

## Context / Hooks
- Replace `ProfileContext` with `OrgContext` (single source of truth for whole hierarchy)
  - Provides: organizations, practices, activeProfile, activeRadiologist, activePractice, activeOrg
  - Actions: switchRadiologist, createOrg, createPractice, createRadiologist, updateX, deleteX
- Keep `useProfile()` as thin alias for backward compat on activeProfile/switchProfile/etc

## Nav: OrgSwitcher (replaces ProfileSwitcher)
- 3-level breadcrumb dropdown: Org > Practice > Radiologist
- "Manage" links to new Organizations page
- Shows initials avatar of active radiologist

## New Page: Organizations.tsx (replaces Profiles.tsx)
- Left panel: list orgs + practices (tree view)
- Right panel: form for org/practice/radiologist
- CRUD all three levels
- Old Profiles.tsx page retired (redirect to Organizations)

## Data Filtering Rules
- Daily Pace: always scoped to activeProfile (radiologist level)
- Annual Dashboard: mode selector: "My" | "Practice" | "Organization"
  - My = profileId filter (current behavior)
  - Practice = all profileIds in activePractice
  - Organization = all profileIds in activeOrg
- History / LogStudy / Import: always radiologist-scoped (no change)
- ExamAlias / duplicates / credentials: radiologist-scoped (no change)

## Files to CREATE
- types/index.ts — add Organization, Practice types; add practiceId to RadiologistProfile
- db/database.ts — v4 migration, ensureDefaultOrg(), ensureDefaultPractice()
- contexts/OrgContext.tsx — full hierarchy context
- hooks/useOrg.ts — re-export
- components/OrgSwitcher.tsx — 3-level dropdown in nav
- pages/Organizations.tsx — CRUD management page

## Files to MODIFY
- hooks/useProfile.ts — keep backward compat, pull from OrgContext
- hooks/useAppInitialization.ts — call ensureDefaultOrg + ensureDefaultPractice
- app.tsx — swap ProfileProvider→OrgProvider, ProfileSwitcher→OrgSwitcher, add Organizations tab
- pages/Dashboard.tsx — add "My / Practice / Organization" mode toggle
- pages/Profiles.tsx — keep but show deprecation notice or redirect to Organizations

## Steps (in order)
1. types/index.ts — Organization, Practice, practiceId on RadiologistProfile
2. db/database.ts — v4 migration + seed helpers
3. OrgContext.tsx — full hierarchy state + CRUD
4. hooks/useOrg.ts + update hooks/useProfile.ts
5. OrgSwitcher.tsx component
6. app.tsx — wire OrgProvider + OrgSwitcher + Organizations tab
7. Dashboard.tsx — add My/Practice/Org mode
8. Organizations.tsx — full management page
9. useAppInitialization.ts — call new seed helpers
10. Build + fix TS + commit + push
