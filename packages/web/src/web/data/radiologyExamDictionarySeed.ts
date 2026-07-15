import Papa from 'papaparse';
import curatedDictionaryCsv from '../../../../../data/reference/radiology_exam_dictionary.csv?raw';
import { db } from '../db/database';
import { ACR_CY2026_MPFS_IMPACT_TABLE_SOURCE, isRadiologyActiveCpt } from './acrRadiologyActiveCptSet';
import { normalizeRadiologyDescription } from '../utils/radiologyDescriptionNormalization';
import { cptRvuUniqueKey, dedupeCptRvuRowsForBulkPut, normalizeCptModifier } from '../utils/cptRowDeduplication';
import { buildOrbitCmeSeedCptRows } from './orbitCmeSeedMappings';
import type { CptRvuRow, ExamDictionaryEntry, Modality } from '../types';

interface CuratedDictionaryCsvRow {
  friendly_exam_name?: string;
  normalized_exam_name?: string;
  cpt_codes?: string;
  primary_cpt_code?: string;
  modifier?: string;
  modifier_26_wrvu?: string;
  modality?: string;
  body_region?: string;
  cms_official_description?: string;
  common_aliases?: string;
  powerscribe_aliases?: string;
  hospital_site_aliases?: string;
  typical_combinations?: string;
  active?: string;
}

const VALID_MODALITIES = new Set<Modality>(['CT', 'MRI', 'US', 'XR', 'NM_PET', 'MAMMO', 'FLUORO', 'PROCEDURE', 'OTHER']);

function parseJsonList(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.map((item) => String(item).trim()).filter(Boolean)
      : [];
  } catch {
    return value.split('|').map((item) => item.trim()).filter(Boolean);
  }
}

function parseModality(value: string | undefined): Modality {
  const normalized = value?.trim().toUpperCase() as Modality | undefined;
  return normalized && VALID_MODALITIES.has(normalized) ? normalized : 'OTHER';
}

function parseNumber(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseCpt(serialized: string): { cptCode: string; modifier: string | null } {
  const [cptCode, modifier] = serialized.split('-').map((part) => part.trim());
  return { cptCode, modifier: normalizeCptModifier(modifier) };
}

function stableId(prefix: string, ...parts: Array<string | null | undefined>): string {
  return `${prefix}_${parts
    .filter(Boolean)
    .join('_')
    .replace(/[^a-z0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()}`;
}

export function buildCuratedRadiologyDictionarySeed(): ExamDictionaryEntry[] {
  const parsed = Papa.parse<CuratedDictionaryCsvRow>(curatedDictionaryCsv, {
    header: true,
    skipEmptyLines: true,
  });
  const now = new Date().toISOString();

  return parsed.data
    .filter((row) => row.active !== 'false')
    .map((row) => {
      const displayName = row.friendly_exam_name?.trim() || row.normalized_exam_name?.trim() || 'Unknown exam';
      const normalizedKey = normalizeRadiologyDescription(row.normalized_exam_name?.trim() || displayName);
      const cptCodes = parseJsonList(row.cpt_codes).length
        ? parseJsonList(row.cpt_codes)
        : row.primary_cpt_code
          ? [`${row.primary_cpt_code}${row.modifier ? `-${row.modifier}` : ''}`]
          : [];

      return {
        id: stableId('curated_dictionary', normalizedKey, row.primary_cpt_code),
        canonicalDisplayName: displayName,
        normalizedKey,
        commonSynonyms: Array.from(new Set([displayName, row.normalized_exam_name?.trim(), ...parseJsonList(row.common_aliases)].filter(Boolean) as string[])),
        hospitalAliases: parseJsonList(row.hospital_site_aliases),
        powerScribeNames: parseJsonList(row.powerscribe_aliases),
        cmsDescription: row.cms_official_description?.trim() || null,
        cptCodes,
        modifier26Wrvu: parseNumber(row.modifier_26_wrvu),
        modality: parseModality(row.modality),
        bodyRegion: row.body_region?.trim() || null,
        typicalCombinations: parseJsonList(row.typical_combinations),
        timesUsed: 0,
        createdAt: now,
        updatedAt: now,
      };
    })
    .filter((entry) => entry.cptCodes.length > 0);
}

export function buildCuratedDictionaryCptRows(entries = buildCuratedRadiologyDictionarySeed()): CptRvuRow[] {
  const now = new Date().toISOString();
  const rows: CptRvuRow[] = [];

  for (const entry of entries) {
    for (const serialized of entry.cptCodes) {
      const { cptCode, modifier } = parseCpt(serialized);
      if (!cptCode) continue;
      const includeInAutoMatch = isRadiologyActiveCpt(cptCode);
      rows.push({
        id: stableId('curated_dictionary_cpt', cptCode, modifier),
        cptCode,
        modifier,
        description: entry.cmsDescription || entry.canonicalDisplayName,
        workRvu: modifier === '26' || normalizeCptModifier(modifier) === '' ? entry.modifier26Wrvu : null,
        nonFacilityPeRvu: null,
        facilityPeRvu: null,
        malpracticeRvu: null,
        totalRvuNonFacility: null,
        totalRvuFacility: null,
        statusCode: 'A',
        statusCategory: 'active',
        globalDays: null,
        pcTcIndicator: modifier === '26' ? 'professional' : 'na',
        modality: entry.modality,
        rvuFileVersion: 'CURATED_RADIOLOGY_DICTIONARY',
        effectiveDate: '2026-01-01',
        includeInAutoMatch,
        autoMatchSource: includeInAutoMatch ? ACR_CY2026_MPFS_IMPACT_TABLE_SOURCE : null,
        isUserVerified: true,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  return dedupeCptRvuRowsForBulkPut(rows, 'curated dictionary CPT rows');
}

export function buildOrbitModalityRepairs(
  existingRows: CptRvuRow[],
  orbitRows = buildOrbitCmeSeedCptRows(),
  nowIso = new Date().toISOString(),
): CptRvuRow[] {
  const orbitByKey = new Map(orbitRows.map((row) => [cptRvuUniqueKey(row), row]));
  return existingRows
    .filter((row) => {
      const reference = orbitByKey.get(cptRvuUniqueKey(row));
      return Boolean(reference && reference.modality !== 'OTHER' && row.modality !== reference.modality && !row.isUserVerified);
    })
    .map((row) => ({
      ...row,
      modality: orbitByKey.get(cptRvuUniqueKey(row))!.modality,
      updatedAt: nowIso,
    }));
}

export async function ensureCuratedRadiologyDictionarySeed(): Promise<void> {
  const entries = buildCuratedRadiologyDictionarySeed();
  if (entries.length === 0) return;

  const existingIds = new Set((await db.examDictionary.toArray()).map((entry) => entry.id));
  const missingEntries = entries.filter((entry) => !existingIds.has(entry.id));
  if (missingEntries.length > 0) {
    await db.examDictionary.bulkPut(missingEntries);
  }

  const existingCptRows = await db.cptRvuTable.toArray();
  const existingCptKeys = new Set(existingCptRows.map(cptRvuUniqueKey));
  const orbitRows = buildOrbitCmeSeedCptRows();
  const modalityRepairs = buildOrbitModalityRepairs(existingCptRows, orbitRows);
  if (modalityRepairs.length > 0) await db.cptRvuTable.bulkPut(modalityRepairs);
  const missingCptRows = dedupeCptRvuRowsForBulkPut(
    [
      ...buildCuratedDictionaryCptRows(entries),
      ...orbitRows,
    ],
    'curated/Orbit CPT seed',
  ).filter((row) => !existingCptKeys.has(cptRvuUniqueKey(row)));
  if (missingCptRows.length > 0) {
    await db.cptRvuTable.bulkPut(missingCptRows);
  }
}
