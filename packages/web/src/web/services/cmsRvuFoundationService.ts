import { db } from '../db/database';
import type { CptRvuRow } from '../types';
import { cptRvuUniqueKey, dedupeCptRvuRowsForBulkPut } from '../utils/cptRowDeduplication';
import { parseRvuFile, toCptRow, type ParsedRvuRow } from '../utils/rvuFileImporter';

export const CMS_RVU_FOUNDATION_URL = 'https://www.cms.gov/files/zip/rvu26c-updated-06-30-2026.zip';
export const CMS_RVU_FOUNDATION_FILENAME = 'rvu26c-updated-06-30-2026.zip';
export const CMS_RVU_FOUNDATION_VERSION = 'CMS_RVU26C_2026_07';
const CMS_RVU_FOUNDATION_EFFECTIVE_ISO = '2026-07-01T00:00:00.000Z';
const CMS_RVU_FOUNDATION_MIN_ROWS = 1_000;
const CMS_RVU_FOUNDATION_SENTINEL = '73221';

export function missingCmsFoundationRows(
  parsedRows: ParsedRvuRow[],
  existingRows: CptRvuRow[],
  nowIso = CMS_RVU_FOUNDATION_EFFECTIVE_ISO,
): CptRvuRow[] {
  const existingKeys = new Set(existingRows.map(cptRvuUniqueKey));
  return dedupeCptRvuRowsForBulkPut(
    parsedRows
      .map((row) => toCptRow(row, CMS_RVU_FOUNDATION_VERSION, undefined, nowIso))
      .filter((row) => !existingKeys.has(cptRvuUniqueKey(row))),
    'official CMS RVU foundation',
  );
}

async function hasCompleteFoundation(): Promise<boolean> {
  const [count, sentinelRows] = await Promise.all([
    db.cptRvuTable.count(),
    db.cptRvuTable.where('cptCode').equals(CMS_RVU_FOUNDATION_SENTINEL).toArray(),
  ]);
  return count >= CMS_RVU_FOUNDATION_MIN_ROWS && sentinelRows.some((row) => row.modifier === '26' && (row.workRvu ?? 0) > 0);
}

export async function ensureCmsRvuFoundation(fetchImpl: typeof fetch = fetch): Promise<{ added: number; total: number; source: string }> {
  if (await hasCompleteFoundation()) {
    return { added: 0, total: await db.cptRvuTable.count(), source: CMS_RVU_FOUNDATION_VERSION };
  }

  const response = await fetchImpl(CMS_RVU_FOUNDATION_URL);
  if (!response.ok) throw new Error(`CMS RVU foundation download failed (${response.status})`);
  const parsed = await parseRvuFile(await response.arrayBuffer(), CMS_RVU_FOUNDATION_FILENAME);
  const existingRows = await db.cptRvuTable.toArray();
  const missingRows = missingCmsFoundationRows(parsed.rows, existingRows);
  if (missingRows.length > 0) await db.cptRvuTable.bulkPut(missingRows);
  return {
    added: missingRows.length,
    total: existingRows.length + missingRows.length,
    source: parsed.sourceFilename,
  };
}
