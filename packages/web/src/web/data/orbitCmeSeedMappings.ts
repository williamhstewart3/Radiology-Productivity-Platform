import Papa from 'papaparse';
import orbitCmeSeedCsv from '../../../../../data/orbit_cme_seed_mappings.csv?raw';
import { ACR_CY2026_MPFS_IMPACT_TABLE_SOURCE, isRadiologyActiveCpt } from './acrRadiologyActiveCptSet';
import { normalizeRadiologyDescription } from '../utils/radiologyDescriptionNormalization';
import { spacelessKey } from '../utils/textMatching';
import type { CptRvuRow, Modality } from '../types';

export interface OrbitCmeSeedMapping {
  studyName: string;
  normalizedKey: string;
  cptCode: string;
  workRvu: number;
  category: string;
  source: 'orbit_cme_seed';
}

interface OrbitCmeSeedCsvRow {
  study_name?: string;
  cpt?: string;
  wrvu?: string;
  category?: string;
  source?: string;
}

const CATEGORY_MODALITY_HINTS: Array<[RegExp, Modality]> = [
  [/^(?:CTA|CT\b|ABDOMEN\/PELVIS|EXTREMITY|CARDIAC)$/i, 'CT'],
  [/^(?:MRA|BRAIN|MSK)$/i, 'MRI'],
  [/^(?:US|OB|PELVIS|THYROID\/NECK|CAROTID|ARTERIAL|VENOUS|VISCERAL|PEDIATRIC)$/i, 'US'],
  [/^(?:PET|SPECT|OTHER NM|BONE|LUNG|THYROID|GI|RENAL)$/i, 'NM_PET'],
  [/^(?:SCREENING|DIAGNOSTIC|BREAST)$/i, 'MAMMO'],
  [/^(?:GENERAL|FLUORO)$/i, 'FLUORO'],
  [/^(?:GUIDANCE|ANGIO|IR|NEURO IR|ARTERIAL ACCESS|ARTERIAL CATH|VENOUS ACCESS|CENTRAL LINES|THROMBECTOMY|THROMBOLYSIS|EMBOLIZATION|ANGIOPLASTY\/STENT|IVC FILTER|VEIN ABLATION|DIALYSIS|TIPS|DRAINAGE\/ACCESS|BIOPSY|BREAST INTERVENTION|ASPIRATION\/DRAINAGE|BILIARY|RENAL\/GU|MSK INTERVENTION|ARTHROGRAPHY|CAROTID STENTING|DIAGNOSTIC ANGIOGRAPHY)$/i, 'PROCEDURE'],
];

function parseNumber(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stableId(prefix: string, ...parts: Array<string | null | undefined>): string {
  return `${prefix}_${parts
    .filter(Boolean)
    .join('_')
    .replace(/[^a-z0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()}`;
}

function modalityFor(row: OrbitCmeSeedMapping): Modality {
  const name = row.studyName.toUpperCase();
  if (name.startsWith('XR ')) return 'XR';
  if (name.startsWith('CT ') || name.startsWith('CTA ')) return 'CT';
  if (name.startsWith('MRI ') || name.startsWith('MRA ') || name.startsWith('CARDIAC MRI')) return 'MRI';
  if (name.startsWith('US ') || name.includes('DUPLEX') || name.includes('DOPPLER')) return 'US';
  if (name.includes('MAMMOGRAM') || name.includes('BREAST TOMOSYNTHESIS') || name.includes('MAMMARY DUCTOGRAM')) return 'MAMMO';
  if (name.includes('PET') || name.includes('SPECT') || name.includes('SCAN') || name.includes('MUGA')) return 'NM_PET';
  if (name.includes('FLUORO') || name.includes('ESOPHAGRAM') || name.includes('BARIUM') || name.includes('CYSTOGRAM')) return 'FLUORO';
  return CATEGORY_MODALITY_HINTS.find(([pattern]) => pattern.test(row.category))?.[1] ?? 'OTHER';
}

export function getOrbitCmeSeedMappings(): OrbitCmeSeedMapping[] {
  const parsed = Papa.parse<OrbitCmeSeedCsvRow>(orbitCmeSeedCsv, {
    header: true,
    skipEmptyLines: true,
  });

  return parsed.data
    .map((row) => {
      const studyName = row.study_name?.trim() ?? '';
      const cptCode = row.cpt?.trim() ?? '';
      const workRvu = parseNumber(row.wrvu);
      if (!studyName || !/^\d{5}$/.test(cptCode) || workRvu == null) return null;
      return {
        studyName,
        normalizedKey: normalizeRadiologyDescription(studyName),
        cptCode,
        workRvu,
        category: row.category?.trim() ?? 'OTHER',
        source: 'orbit_cme_seed' as const,
      };
    })
    .filter((row): row is OrbitCmeSeedMapping => Boolean(row));
}

let orbitCmeSpacelessIndex: Map<string, OrbitCmeSeedMapping> | null = null;
let orbitCmeSemanticIndex: Map<string, OrbitCmeSeedMapping | null> | null = null;

export function orbitCmeSemanticTitleKey(value: string): string {
  return normalizeRadiologyDescription(value)
    .replace(/\b(?:XR|X RAY|RADIOGRAPH|CTA|CT|MRA|MRI|MR|US|U S|ULTRASOUND|SONOGRAM|NM|PET|MAMMO|FLUORO)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getOrbitCmeSpacelessIndex(): Map<string, OrbitCmeSeedMapping> {
  if (!orbitCmeSpacelessIndex) {
    orbitCmeSpacelessIndex = new Map(
      getOrbitCmeSeedMappings().map((row) => [spacelessKey(row.studyName), row]),
    );
  }
  return orbitCmeSpacelessIndex;
}

function getOrbitCmeSemanticIndex(): Map<string, OrbitCmeSeedMapping | null> {
  if (!orbitCmeSemanticIndex) {
    orbitCmeSemanticIndex = new Map();
    for (const row of getOrbitCmeSeedMappings()) {
      const key = orbitCmeSemanticTitleKey(row.studyName);
      if (!key) continue;
      const existing = orbitCmeSemanticIndex.get(key);
      if (existing === undefined) orbitCmeSemanticIndex.set(key, row);
      else if (existing?.cptCode !== row.cptCode) orbitCmeSemanticIndex.set(key, null);
    }
  }
  return orbitCmeSemanticIndex;
}

export function findOrbitCmeSeedMapping(rawInput: string): OrbitCmeSeedMapping | null {
  const normalized = normalizeRadiologyDescription(rawInput);
  return getOrbitCmeSeedMappings().find((row) => row.normalizedKey === normalized) ??
    getOrbitCmeSpacelessIndex().get(spacelessKey(rawInput)) ??
    getOrbitCmeSemanticIndex().get(orbitCmeSemanticTitleKey(rawInput)) ??
    null;
}

export function buildOrbitCmeSeedCptRows(rows = getOrbitCmeSeedMappings()): CptRvuRow[] {
  const now = new Date().toISOString();
  const byKey = new Map<string, CptRvuRow>();

  for (const row of rows) {
    const key = `${row.cptCode}-26`;
    if (byKey.has(key)) continue;
    const includeInAutoMatch = isRadiologyActiveCpt(row.cptCode);
    byKey.set(key, {
      id: stableId('orbit_cme_seed_cpt', row.cptCode, '26'),
      cptCode: row.cptCode,
      modifier: '26',
      description: row.studyName,
      workRvu: row.workRvu,
      nonFacilityPeRvu: null,
      facilityPeRvu: null,
      malpracticeRvu: null,
      totalRvuNonFacility: null,
      totalRvuFacility: null,
      statusCode: 'A',
      statusCategory: 'active',
      globalDays: null,
      pcTcIndicator: 'professional',
      modality: modalityFor(row),
      rvuFileVersion: 'ORBIT_CME_SEED',
      effectiveDate: '2026-01-01',
      includeInAutoMatch,
      autoMatchSource: includeInAutoMatch ? ACR_CY2026_MPFS_IMPACT_TABLE_SOURCE : null,
      isUserVerified: true,
      createdAt: now,
      updatedAt: now,
    });
  }

  return Array.from(byKey.values());
}
