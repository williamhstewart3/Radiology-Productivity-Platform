import Papa from 'papaparse';
import { unzipSync } from 'fflate';
import { db } from '../db/database';
import type { CptRvuRow, StatusCategory, PcTcIndicator } from '../types';
import { classifyModality } from '../data/modalityClassifier';

/**
 * Importer for the official CMS PFS Relative Value File (e.g. RVU26A).
 *
 * CMS distributes this as a ZIP containing several files. The one this app
 * needs is "PPRRVU" -- e.g. PPRRVU2026_Jan_nonQPP.csv or
 * PPRRVU2026_Jan_QPP.csv -- which contains the RVUs and policy indicators.
 * (The QPP/non-QPP versions differ only in the payment conversion factor
 * column, which this app doesn't use; either works for work-RVU tracking.)
 *
 * IMPORTANT, verified directly against a real CY2026 release on 2026-06-27:
 * the CSV's header is NOT a single clean row of column names. CMS spreads
 * the labels across four stacked rows -- for example "WORK" appears on one
 * row and "RVU" appears directly below it in the same column, two separate
 * cells that only make sense combined. A header-matcher that looks for a
 * single cell containing the string "work rvu" will never find a match in
 * the real file. This importer instead uses a verified fixed column-index
 * map for the current layout, with a single-row alias-based fallback kept
 * for resilience against a possible future format change.
 */

export interface ImportResult {
  success: boolean;
  fileVersion: string;
  rowsAdded: number;
  rowsUpdated: number;
  rowsUnchanged: number;
  rowsSkippedNoWorkRvu: number;
  significantChanges: Array<{
    cptCode: string;
    modifier: string | null;
    oldWorkRvu: number | null;
    newWorkRvu: number | null;
    percentChange: number | null;
  }>;
  errors: string[];
}

/**
 * VERIFIED column layout for the real CY2026 PPRRVU CSV release
 * (PPRRVU2026_Jan_nonQPP.csv / PPRRVU2026_Jan_QPP.csv, released 12/29/2025).
 * Confirmed byte-for-byte against the actual file and cross-checked against
 * known sample rows (71045, 71046, 74178, 70450, etc.).
 *
 * Column index : field
 *   0  HCPCS code
 *   1  Modifier
 *   2  Description
 *   3  Status code
 *   4  ("NOT USED FOR MEDICARE PAYMENT" column -- blank in this release)
 *   5  Work RVU
 *   6  Non-facility PE RVU
 *   7  Non-facility NA indicator
 *   8  Facility PE RVU
 *   9  Facility NA indicator
 *  10  Malpractice RVU
 *  11  Total non-facility RVU
 *  12  Total facility RVU
 *  13  PC/TC indicator
 *  14  Global days
 *  (columns 15+ are payment-adjustment indicators not used by this app)
 */
const KNOWN_LAYOUT_2026: Record<string, number> = {
  hcpcs: 0,
  modifier: 1,
  description: 2,
  statusCode: 3,
  workRvu: 5,
  nonFacilityPeRvu: 6,
  facilityPeRvu: 8,
  malpracticeRvu: 10,
  nonFacilityTotal: 11,
  facilityTotal: 12,
  pcTcIndicator: 13,
  globalDays: 14,
};

// Fallback single-row header aliases, tried only if the known fixed layout
// doesn't verify against this particular file (e.g. a future CMS reformat).
const HEADER_ALIASES: Record<string, string[]> = {
  hcpcs: ['hcpcs', 'cpt', 'cpt/hcpcs code', 'hcpcs code'],
  modifier: ['mod', 'modifier'],
  description: ['description', 'short description', 'descriptor'],
  statusCode: ['status code', 'status', 'stat'],
  workRvu: ['work rvu', 'wrvu', 'work_rvu'],
  nonFacilityPeRvu: ['non-fac pe rvu', 'non facility pe rvu', 'pe rvu (non-fac)', 'nonfac pe rvu'],
  facilityPeRvu: ['fac pe rvu', 'facility pe rvu', 'pe rvu (fac)'],
  malpracticeRvu: ['mp rvu', 'malpractice rvu'],
  nonFacilityTotal: ['non-fac total', 'non facility total', 'total (non-fac)', 'nonfac total'],
  facilityTotal: ['fac total', 'facility total', 'total (fac)'],
  pcTcIndicator: ['pctc ind', 'pctc indicator', 'pc/tc indicator'],
  globalDays: ['glob days', 'global days', 'globalperiod'],
};

function normalizeHeader(h: string | undefined): string {
  return (h ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function buildHeaderMapFromSingleRow(headers: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  const normalizedHeaders = headers.map(normalizeHeader);

  for (const [canonical, aliases] of Object.entries(HEADER_ALIASES)) {
    for (const alias of aliases) {
      const idx = normalizedHeaders.indexOf(alias);
      if (idx !== -1) {
        map[canonical] = idx;
        break;
      }
    }
  }
  return map;
}

/**
 * Checks whether the known fixed 2026 layout is actually correct for this
 * file before trusting it: column 0 of the candidate header row must say
 * "HCPCS", column 2 must say "DESCRIPTION", and the row directly above the
 * header (where CMS puts the stacked "WORK" label) must say "WORK" at the
 * work RVU column. This guards against silently importing wrong values if
 * CMS ever shifts columns in a future release.
 */
function verifyKnownLayout(allRows: string[][], headerRowIndex: number): boolean {
  const headerRow = allRows[headerRowIndex];
  if (!headerRow) return false;
  if (normalizeHeader(headerRow[KNOWN_LAYOUT_2026.hcpcs]) !== 'hcpcs') return false;
  if (normalizeHeader(headerRow[KNOWN_LAYOUT_2026.description]) !== 'description') return false;

  const workLabelRow = allRows[headerRowIndex - 1];
  if (!workLabelRow) return false;
  if (normalizeHeader(workLabelRow[KNOWN_LAYOUT_2026.workRvu]) !== 'work') return false;

  return true;
}

const STATUS_CATEGORY_MAP: Record<string, StatusCategory> = {
  A: 'active',
  R: 'restricted',
  T: 'restricted',
  B: 'excluded',
  C: 'excluded',
  N: 'excluded',
  X: 'excluded',
};

function mapPcTc(raw: string | undefined): PcTcIndicator {
  if (!raw) return 'na';
  const v = raw.trim();
  if (v === '0') return 'global';
  if (v === '1') return 'professional';
  if (v === '2') return 'professional';
  if (v === '3') return 'technical';
  return 'na';
}

function parseNumericCell(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed.toUpperCase() === 'NA') return null;
  const num = parseFloat(trimmed.replace(/,/g, ''));
  return Number.isNaN(num) ? null : num;
}

/** Extracts the first CSV/TXT file from a CMS RVU zip that looks like the PPRRVU data file. */
function extractRvuCsvFromZip(zipBytes: Uint8Array): { filename: string; content: string } {
  const files = unzipSync(zipBytes);
  const candidates = Object.keys(files).filter((name) => {
    const lower = name.toLowerCase();
    return lower.includes('pprrvu') && (lower.endsWith('.csv') || lower.endsWith('.txt'));
  });

  if (candidates.length === 0) {
    const fallback = Object.keys(files).filter((name) => {
      const lower = name.toLowerCase();
      return lower.startsWith('rvu') && (lower.endsWith('.csv') || lower.endsWith('.txt'));
    });
    if (fallback.length === 0) {
      const allNames = Object.keys(files).join(', ');
      throw new Error(
        `Could not find a PPRRVU data file inside the zip. Files found: ${allNames || '(none)'}`,
      );
    }
    candidates.push(...fallback);
  }

  // Prefer non-QPP over QPP if both exist (arbitrary but consistent default;
  // work RVU values are identical between the two -- only the payment
  // conversion factor column differs, which this app doesn't use).
  candidates.sort((a, b) => {
    const aIsNonQpp = a.toLowerCase().includes('nonqpp') ? -1 : 0;
    const bIsNonQpp = b.toLowerCase().includes('nonqpp') ? -1 : 0;
    if (aIsNonQpp !== bIsNonQpp) return aIsNonQpp - bIsNonQpp;
    return a.endsWith('.csv') ? -1 : 1;
  });

  const filename = candidates[0];
  const bytes = files[filename];
  const content = new TextDecoder('utf-8').decode(bytes);
  return { filename, content };
}

export interface ParsedRvuRow {
  cptCode: string;
  modifier: string | null;
  description: string;
  statusCode: string;
  workRvu: number | null;
  nonFacilityPeRvu: number | null;
  facilityPeRvu: number | null;
  malpracticeRvu: number | null;
  totalRvuNonFacility: number | null;
  totalRvuFacility: number | null;
  pcTcIndicator: PcTcIndicator;
  globalDays: string | null;
}

export async function parseRvuFile(
  fileBuffer: ArrayBuffer,
  filename: string,
): Promise<{ rows: ParsedRvuRow[]; sourceFilename: string; errors: string[] }> {
  const errors: string[] = [];
  let csvContent: string;
  let sourceFilename = filename;

  if (filename.toLowerCase().endsWith('.zip')) {
    const zipBytes = new Uint8Array(fileBuffer);
    const extracted = extractRvuCsvFromZip(zipBytes);
    csvContent = extracted.content;
    sourceFilename = extracted.filename;
  } else {
    // Strip a UTF-8 BOM if present (CMS's CSVs are saved with one from Excel).
    const decoded = new TextDecoder('utf-8').decode(fileBuffer);
    csvContent = decoded.charCodeAt(0) === 0xfeff ? decoded.slice(1) : decoded;
  }

  const parsed = Papa.parse<string[]>(csvContent, {
    skipEmptyLines: true,
  });

  if (parsed.errors.length > 0) {
    for (const e of parsed.errors.slice(0, 5)) {
      errors.push(`CSV parse warning (row ${e.row}): ${e.message}`);
    }
  }

  const allRows = parsed.data;
  if (allRows.length === 0) {
    throw new Error('File parsed but contained no rows.');
  }

  let headerRowIndex = -1;
  let headerMap: Record<string, number> = {};
  let usedFallback = false;

  // First, try the verified fixed layout for the current CMS format. The
  // real header row sits a few rows into the file (after title/copyright
  // lines), so scan for it rather than assuming a fixed row number -- but
  // once found, verify it actually matches the known layout before trusting it.
  for (let i = 0; i < Math.min(allRows.length, 20); i++) {
    if (normalizeHeader(allRows[i]?.[KNOWN_LAYOUT_2026.hcpcs]) === 'hcpcs') {
      if (verifyKnownLayout(allRows, i)) {
        headerRowIndex = i;
        headerMap = KNOWN_LAYOUT_2026;
      }
      break;
    }
  }

  // Fallback: single-row alias matching, for a possible future CMS layout
  // that combines labels into one row again.
  if (headerRowIndex === -1) {
    usedFallback = true;
    for (let i = 0; i < Math.min(allRows.length, 20); i++) {
      const candidateMap = buildHeaderMapFromSingleRow(allRows[i]);
      if (candidateMap.hcpcs !== undefined && candidateMap.workRvu !== undefined) {
        headerRowIndex = i;
        headerMap = candidateMap;
        break;
      }
    }
  }

  if (headerRowIndex === -1) {
    throw new Error(
      'Could not locate a recognizable header row (expected an "HCPCS" column with a ' +
        '"WORK"/"RVU" work-RVU column nearby). This file may not be in the expected CMS ' +
        'PPRRVU format. Aborting import rather than guessing column positions.',
    );
  }

  if (usedFallback) {
    errors.push(
      'Note: used fallback single-row header detection instead of the verified fixed ' +
        'layout -- double check imported values look correct, since CMS may have changed ' +
        'their file format.',
    );
  }

  const dataRows = allRows.slice(headerRowIndex + 1);
  const rows: ParsedRvuRow[] = [];

  for (const cells of dataRows) {
    const hcpcs = cells[headerMap.hcpcs]?.trim();
    if (!hcpcs || !/^[0-9A-Z]{4,5}$/i.test(hcpcs)) continue;

    const statusCodeRaw =
      (headerMap.statusCode !== undefined ? cells[headerMap.statusCode] : 'A')?.trim() || 'A';

    rows.push({
      cptCode: hcpcs.toUpperCase(),
      modifier: headerMap.modifier !== undefined ? cells[headerMap.modifier]?.trim() || null : null,
      description:
        headerMap.description !== undefined ? cells[headerMap.description]?.trim() || '' : '',
      statusCode: statusCodeRaw.toUpperCase(),
      workRvu: parseNumericCell(cells[headerMap.workRvu]),
      nonFacilityPeRvu: parseNumericCell(cells[headerMap.nonFacilityPeRvu]),
      facilityPeRvu: parseNumericCell(cells[headerMap.facilityPeRvu]),
      malpracticeRvu: parseNumericCell(cells[headerMap.malpracticeRvu]),
      totalRvuNonFacility: parseNumericCell(cells[headerMap.nonFacilityTotal]),
      totalRvuFacility: parseNumericCell(cells[headerMap.facilityTotal]),
      pcTcIndicator: mapPcTc(
        headerMap.pcTcIndicator !== undefined ? cells[headerMap.pcTcIndicator] : undefined,
      ),
      globalDays: headerMap.globalDays !== undefined ? cells[headerMap.globalDays]?.trim() || null : null,
    });
  }

  if (rows.length === 0) {
    throw new Error('Header row was found but no valid data rows were parsed.');
  }

  return { rows, sourceFilename, errors };
}

/** Upserts parsed rows into cpt_rvu_table, tracking what changed for the diff report. */
export async function importRvuRows(
  rows: ParsedRvuRow[],
  fileVersion: string,
): Promise<ImportResult> {
  const result: ImportResult = {
    success: false,
    fileVersion,
    rowsAdded: 0,
    rowsUpdated: 0,
    rowsUnchanged: 0,
    rowsSkippedNoWorkRvu: 0,
    significantChanges: [],
    errors: [],
  };

  const nowIso = new Date().toISOString();

  await db.transaction('rw', db.cptRvuTable, async () => {
    for (const row of rows) {
      if (row.workRvu === null) {
        result.rowsSkippedNoWorkRvu++;
      }

      const existingRow = await db.cptRvuTable
        .where('cptCode')
        .equals(row.cptCode)
        .filter((r) => (r.modifier ?? null) === (row.modifier ?? null))
        .first();

      const statusCategory = STATUS_CATEGORY_MAP[row.statusCode] ?? 'unknown';
      const modality = classifyModality(row.cptCode);

      const newRow: CptRvuRow = {
        id: existingRow?.id ?? crypto.randomUUID(),
        cptCode: row.cptCode,
        modifier: row.modifier,
        description: row.description,
        workRvu: row.workRvu,
        nonFacilityPeRvu: row.nonFacilityPeRvu,
        facilityPeRvu: row.facilityPeRvu,
        malpracticeRvu: row.malpracticeRvu,
        totalRvuNonFacility: row.totalRvuNonFacility,
        totalRvuFacility: row.totalRvuFacility,
        statusCode: row.statusCode,
        statusCategory,
        globalDays: row.globalDays,
        pcTcIndicator: row.pcTcIndicator,
        modality: existingRow?.modality ?? modality,
        rvuFileVersion: fileVersion,
        effectiveDate: nowIso.slice(0, 10),
        isUserVerified: false,
        createdAt: existingRow?.createdAt ?? nowIso,
        updatedAt: nowIso,
      };

      if (!existingRow) {
        await db.cptRvuTable.put(newRow);
        result.rowsAdded++;
      } else {
        const oldWrvu = existingRow.workRvu;
        const newWrvu = newRow.workRvu;
        const unchanged =
          oldWrvu === newWrvu &&
          existingRow.description === newRow.description &&
          existingRow.statusCode === newRow.statusCode;

        if (unchanged) {
          result.rowsUnchanged++;
        } else {
          await db.cptRvuTable.put(newRow);
          result.rowsUpdated++;

          if (oldWrvu !== null && newWrvu !== null && oldWrvu !== 0) {
            const percentChange = ((newWrvu - oldWrvu) / oldWrvu) * 100;
            if (Math.abs(percentChange) >= 5) {
              result.significantChanges.push({
                cptCode: row.cptCode,
                modifier: row.modifier,
                oldWorkRvu: oldWrvu,
                newWorkRvu: newWrvu,
                percentChange,
              });
            }
          } else if (oldWrvu !== newWrvu) {
            result.significantChanges.push({
              cptCode: row.cptCode,
              modifier: row.modifier,
              oldWorkRvu: oldWrvu,
              newWorkRvu: newWrvu,
              percentChange: null,
            });
          }
        }
      }
    }
  });

  result.success = true;
  return result;
}

/** Convenience wrapper: parse + import in one call, for the Settings UI. */
export async function importRvuFile(
  fileBuffer: ArrayBuffer,
  filename: string,
  fileVersionLabel: string,
): Promise<ImportResult> {
  const { rows, errors: parseErrors } = await parseRvuFile(fileBuffer, filename);
  const result = await importRvuRows(rows, fileVersionLabel);
  result.errors = [...parseErrors, ...result.errors];
  return result;
}
