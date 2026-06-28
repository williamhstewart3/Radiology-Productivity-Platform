# Refactor: Org/Practice → Location

## Goal
Replace 3-level Org → Practice → Radiologist with 2-level Location → Radiologist.
DB stays backwards-compatible (Organization + Practice tables stay, just hidden from UI).
"Location" maps to what was "Practice" internally. Each practice still has an organizationId but
there's a single default org (hidden) used for all locations.

## Data model mapping
- `Practice` (DB) = "Location" (UI)
- `Organization` (DB) = hidden singleton, never shown in UI
- `RadiologistProfile.practiceId` = locationId (same field, same meaning)

## Types changes (types/index.ts)
- Add `Location` type alias for `Practice` (or rename fields for clarity)
- Keep `Practice` and `Organization` intact in DB layer
- Add `locationId` alias or just use `practiceId` in UI code

## Database (database.ts)
- Keep v4 schema unchanged (backward compat)
- Add v5 migration: NO schema change needed, just upgrade version to allow future migrations
- `ensureDefaultOrganization` → create hidden org "default" with name "My Practice" (never shown)
- `ensureDefaultPractice` → becomes `ensureDefaultLocation` 
- Remove "My Practice" as a name — instead seed nothing (let user create first location)
- Actually: keep seed so app doesn't crash on startup. Seed a default location if none exist.

## Context (OrgContext.tsx)
- Expose `locations` (= practices) and `activeLocation` (= activePractice) 
- Keep backward compat: `practices`, `activePractice` still work
- Add `createLocation`, `updateLocation`, `deleteLocation` aliases
- `locationRadiologists` = radiologists in active location
- Radiologists with no locationId = "unassigned" 

## OrgSwitcher.tsx
- Rename: "Manage Organizations" → "Manage Locations" (button label + icon)
- Breadcrumb: show Location name (was practice name), drop Org name
- Trigger: show [Location › Radiologist] not [Org › Practice › Radiologist]

## app.tsx
- Tab 'organizations' → rename to 'locations'
- Tab label: "Locations" instead of "Organizations"
- Tab icon: 📍 or 🏥
- Import `Locations` page instead of `Organizations`

## pages/Locations.tsx (replaces Organizations.tsx)
- Two-panel layout: left = location list, right = form
- NO org or practice tier in the tree — just flat location list + radiologists under each
- "New Location" button in header
- Location form: Name (required), Code/initials (optional, ≤4 chars, labeled "Location Code")
- Radiologist form: "Default Location" dropdown (searchable) replacing "Practice" selector
- No org-level CRUD at all

## pages/Profiles.tsx
- Keep mostly as-is (it's the profile management page)
- Add "Default Location" dropdown (replaces nothing — profiles don't currently show location in form)
- Actually: Profiles.tsx doesn't show practiceId at all currently. Leave for now.

## pages/Dashboard.tsx  
- Filter buttons: Me | My Location | All Locations
- Was: Me | My Practice | All
- Update labels only

## Dashboard filter logic
- "My Location" = radiologists.filter(r => r.practiceId === activeProfile.practiceId)
- "All Locations" = all radiologists

## OrgSwitcher dropdown
- Group radiologists by Location (was: by Org › Practice)
- Show location name as group header
- Unassigned radiologists shown under "No Location" group

## Cleanup
- Delete pages/Organizations.tsx (or rename)
- Add pages/Locations.tsx

## Steps
1. [x] Read all files ← done
2. [ ] Update types/index.ts — add Location alias
3. [ ] Update database.ts — clean up seed, no UI-visible org
4. [ ] Update OrgContext.tsx — expose locations API
5. [ ] Write pages/Locations.tsx
6. [ ] Update app.tsx — tab rename
7. [ ] Update OrgSwitcher.tsx — breadcrumb + manage label
8. [ ] Update Dashboard.tsx — filter labels
9. [ ] Build + fix errors
10. [ ] Commit
