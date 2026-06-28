import type { CptRvuRow, Modality, PcTcIndicator, StatusCategory } from '../types';

/**
 * ============================================================================
 * IMPORTANT -- READ BEFORE EDITING THIS FILE
 * ============================================================================
 * This is a SEED file, not the real CMS RVU dataset. It exists only so the
 * app is usable immediately after install, before the real file is imported.
 *
 * Every row below has `isUserVerified: true` and a `verificationNote`
 * documenting exactly where the work RVU value was confirmed. As of
 * 2026-06-27, every row in this file has been checked directly against a
 * real CY2026 CMS PPRRVU CSV release (PPRRVU2026_Jan_nonQPP.csv, released
 * 2025-12-29, supplied by the app's user) -- not from memory, not from
 * secondary trade-press sources.
 *
 * Earlier in this app's development, one seed value (CPT 71046) was
 * estimated from a secondary source's reported percent-change figure rather
 * than the real file, and that estimate was WRONG (0.22 vs the real 0.21).
 * It has since been corrected against the real file. This is the exact
 * failure mode this file's seed-data policy exists to prevent going
 * forward -- only values confirmed against an actual CMS file belong here.
 *
 * ⚠️ CY2026 CHANGED A LOT OF RADIOLOGY CODES relative to CY2025:
 *   - CTA Head (70496) + CTA Neck (70498) were deleted and replaced by a
 *     single combined code for 2026.
 *   - Lower-extremity revascularization codes 37220-37235 were deleted and
 *     replaced with much more granular new codes.
 *   - A broad efficiency adjustment shifted many familiar work RVU values
 *     down slightly from 2025 across many non-time-based codes.
 * Do NOT assume any 2025 RVU value you remember is still correct for 2026.
 *
 * DO NOT add new rows here from memory or from secondary sources (blog
 * posts, trade press, forum threads). Only add a row here if you have
 * directly inspected the actual CMS PPRRVU file and copied the value byte
 * for byte. Otherwise, use Settings -> Import RVU File to load the real
 * file, which populates the full ~19,000-row table with
 * `isUserVerified: false` (meaning "trust the file, not human memory") and
 * overrides these seed rows wherever codes overlap.
 * ============================================================================
 */

interface SeedRow {
  cptCode: string;
  modifier: string | null;
  description: string;
  workRvu: number;
  statusCode: string;
  pcTcIndicator: PcTcIndicator;
  modality: Modality;
  verificationNote: string;
}

const SOURCE_NOTE =
  'Confirmed directly against PPRRVU2026_Jan_nonQPP.csv (CY2026 January release, ' +
  'released 2025-12-29), global (no-modifier) row, on 2026-06-27.';

const SEED_ROWS: SeedRow[] = [
  {
    cptCode: '71045',
    modifier: null,
    description: 'X-ray exam chest 1 view',
    workRvu: 0.18,
    statusCode: 'A',
    pcTcIndicator: 'global',
    modality: 'XR',
    verificationNote: SOURCE_NOTE,
  },
  {
    cptCode: '71046',
    modifier: null,
    description: 'X-ray exam chest 2 views',
    workRvu: 0.21,
    statusCode: 'A',
    pcTcIndicator: 'global',
    modality: 'XR',
    verificationNote:
      SOURCE_NOTE +
      ' Corrects an earlier seed value of 0.22 that was estimated from a secondary ' +
      'source rather than the real file -- that earlier estimate was wrong.',
  },
  {
    cptCode: '70450',
    modifier: null,
    description: 'Ct head/brain w/o dye',
    workRvu: 0.83,
    statusCode: 'A',
    pcTcIndicator: 'global',
    modality: 'CT',
    verificationNote: SOURCE_NOTE,
  },
  {
    cptCode: '71250',
    modifier: null,
    description: 'Ct thorax dx c-',
    workRvu: 1.05,
    statusCode: 'A',
    pcTcIndicator: 'global',
    modality: 'CT',
    verificationNote: SOURCE_NOTE,
  },
  {
    cptCode: '72125',
    modifier: null,
    description: 'Ct neck spine w/o dye',
    workRvu: 0.98,
    statusCode: 'A',
    pcTcIndicator: 'global',
    modality: 'CT',
    verificationNote: SOURCE_NOTE,
  },
  {
    cptCode: '74176',
    modifier: null,
    description: 'Ct abd & pelvis w/o contrast',
    workRvu: 1.70,
    statusCode: 'A',
    pcTcIndicator: 'global',
    modality: 'CT',
    verificationNote: SOURCE_NOTE,
  },
  {
    cptCode: '74177',
    modifier: null,
    description: 'Ct abd & pelvis w/contrast',
    workRvu: 1.77,
    statusCode: 'A',
    pcTcIndicator: 'global',
    modality: 'CT',
    verificationNote: SOURCE_NOTE,
  },
  {
    cptCode: '74178',
    modifier: null,
    description: 'Ct abd&plv wo cntr flwd cntr',
    workRvu: 1.96,
    statusCode: 'A',
    pcTcIndicator: 'global',
    modality: 'CT',
    verificationNote: SOURCE_NOTE,
  },
  {
    cptCode: '70551',
    modifier: null,
    description: 'Mri brain stem w/o dye',
    workRvu: 1.44,
    statusCode: 'A',
    pcTcIndicator: 'global',
    modality: 'MRI',
    verificationNote: SOURCE_NOTE,
  },
  {
    cptCode: '72141',
    modifier: null,
    description: 'Mri neck spine w/o dye',
    workRvu: 1.44,
    statusCode: 'A',
    pcTcIndicator: 'global',
    modality: 'MRI',
    verificationNote: SOURCE_NOTE,
  },
  {
    cptCode: '72148',
    modifier: null,
    description: 'Mri lumbar spine w/o dye',
    workRvu: 1.44,
    statusCode: 'A',
    pcTcIndicator: 'global',
    modality: 'MRI',
    verificationNote: SOURCE_NOTE,
  },
  {
    cptCode: '73721',
    modifier: null,
    description: 'Mri jnt of lwr extre w/o dye',
    workRvu: 1.32,
    statusCode: 'A',
    pcTcIndicator: 'global',
    modality: 'MRI',
    verificationNote: SOURCE_NOTE,
  },
  {
    cptCode: '76700',
    modifier: null,
    description: 'Us exam abdom complete',
    workRvu: 0.79,
    statusCode: 'A',
    pcTcIndicator: 'global',
    modality: 'US',
    verificationNote: SOURCE_NOTE,
  },
  {
    cptCode: '77067',
    modifier: null,
    description: 'Scr mammo bi incl cad',
    workRvu: 0.74,
    statusCode: 'A',
    pcTcIndicator: 'global',
    modality: 'MAMMO',
    verificationNote: SOURCE_NOTE,
  },
];

const STATUS_CATEGORY_MAP: Record<string, StatusCategory> = {
  A: 'active',
  R: 'restricted',
  T: 'restricted',
  B: 'excluded',
  C: 'excluded',
  N: 'excluded',
  X: 'excluded',
};

function nowIso() {
  return new Date().toISOString();
}

export function buildSeedCptRows(): CptRvuRow[] {
  const ts = nowIso();
  return SEED_ROWS.map((row) => ({
    id: `seed_${row.cptCode}_${row.modifier ?? 'none'}`,
    cptCode: row.cptCode,
    modifier: row.modifier,
    description: row.description,
    workRvu: row.workRvu,
    nonFacilityPeRvu: null,
    facilityPeRvu: null,
    malpracticeRvu: null,
    totalRvuNonFacility: null,
    totalRvuFacility: null,
    statusCode: row.statusCode,
    statusCategory: STATUS_CATEGORY_MAP[row.statusCode] ?? 'unknown',
    globalDays: null,
    pcTcIndicator: row.pcTcIndicator,
    modality: row.modality,
    rvuFileVersion: 'SEED_VERIFIED',
    effectiveDate: '2026-01-01',
    isUserVerified: true,
    createdAt: ts,
    updatedAt: ts,
  }));
}
