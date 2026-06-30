import Papa from 'papaparse';
import { unzipSync } from 'fflate';
import { db } from '../db/database';
import { supabasePersistence } from '../services/supabasePersistence';
import type { CptRvuRow, StatusCategory, PcTcIndicator } from '../types';
import { classifyModality } from '../data/modalityClassifier';

export interface ImportResult {
  success: boolean;
  fileVersion: string;
  year: number;
  sourceFilename: string;
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
  confirmationMessage: string;
  savedToSupabase: boolean;
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

const STATUS_CATEGORY_MAP: Record<string, StatusCategory> = {
  A: 'active',
  R: 'restricted',
  T: 'restricted',
  B: 'excluded',
  C: 'excluded',
  N: 'excluded',
  X: 'excluded',
};

function normalizeHeader(value: string | undefined): string {
  return (value ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function buildHeaderMapFromSingleRow(headers: string[]): Record<string, number> {
  const normalizedHeaders = headers.map(normalizeHeader);
  const map: Record<string, number> = {};
  for (const [canonical, aliases] of Object.entries(HEADER_ALIASES)) {
    for (const alias of aliases) {
      const index = normalizedHeaders.indexOf(alias);
      if (index !== -1) {
        map[canonical] = index;
        break;
      }
    }
  }
  return map;
}

function verifyKnownLayout(allRows: string[][], headerRowIndex: number): boolean {
  const headerRow = allRows[headerRowIndex];
  const workLabelRow = allRows[headerRowIndex - 1];
  return Boolean(
    headerRow &&
    workLabelRow &&
    normalizeHeader(headerRow[KNOWN_LAYOUT_2026.hcpcs]) === 'hcpcs' &&
    normalizeHeader(headerRow[KNOWN_LAYOUT_2026.description]) === 'description' &&
    normalizeHeader(workLabelRow[KNOWN_LAYOUT_2026.workRvu]) === 'work',
  );
}

function mapPcTc(raw: string | undefined): PcTcIndicator {
  const value = raw?.trim();
  if (value === '0') return 'global';
  if (value === '1' || value === '2') return 'professional';
  if (value === '3') return 'technical';
  return 'na';
}

function parseNumericCell(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed.toUpperCase() === 'NA') return null;
  const num = parseFloat(trimmed.replace(/,/g, ''));
  return Number.isNaN(num) ? null : num;
}

function extractRvuCsvFromZip(zipBytes: Uint8Array): { filename: string; content: string } {
  const files = unzipSync(zipBytes);
  const candidates = Object.keys(files).filter((name) => {
    const lower = name.toLowerCase();
    return lower.includes('pprrvu') && (lower.endsWith('.csv') || lower.endsWith('.txt'));
  });

  if (candidates.length === 0) {
    throw new Error(`Could not find a PPRRVU CSV/TXT file inside the zip. Files found: ${Object.keys(files).join(', ') || '(none)'}`);
  }

  candidates.sort((a, b) => {
    const aNonQpp = a.toLowerCase().includes('nonqpp') ? -1 : 0;
    const bNonQpp = b.toLowerCase().includes('nonqpp') ? -1 : 0;
    if (aNonQpp !== bNonQpp) return aNonQpp - bNonQpp;
    return a.endsWith('.csv') ? -1 : 1;
  });

  const filename = candidates[0];
  return { filename, content: new TextDecoder('utf-8').decode(files[filename]) };
}

function inferYear(filename: string, fallbackLabel: string): number {
  const match = `${filename} ${fallbackLabel}`.match(/20\d{2}/);
  return match ? Number(match[0]) : new Date().getFullYear();
}

export async function parseRvuFile(
  fileBuffer: ArrayBuffer,
  filename: string,
): Promise<{ rows: ParsedRvuRow[]; sourceFilename: string; year: number; errors: string[] }> {
  const errors: string[] = [];
  let csvContent: string;
  let sourceFilename = filename;

  if (filename.toLowerCase().endsWith('.zip')) {
    const extracted = extractRvuCsvFromZip(new Uint8Array(fileBuffer));
    csvContent = extracted.content;
    sourceFilename = extracted.filename;
  } else {
    const decoded = new TextDecoder('utf-8').decode(fileBuffer);
    csvContent = decoded.charCodeAt(0) === 0xfeff ? decoded.slice(1) : decoded;
  }

  const parsed = Papa.parse<string[]>(csvContent, { skipEmptyLines: true });
  for (const error of parsed.errors.slice(0, 5)) {
    errors.push(`CSV parse warning (row ${error.row}): ${error.message}`);
  }

  const allRows = parsed.data;
  if (allRows.length === 0) throw new Error('File parsed but contained no rows.');

  let headerRowIndex = -1;
  let headerMap: Record<string, number> = {};

  for (let i = 0; i < Math.min(allRows.length, 20); i++) {
    if (normalizeHeader(allRows[i]?.[KNOWN_LAYOUT_2026.hcpcs]) === 'hcpcs' && verifyKnownLayout(allRows, i)) {
      headerRowIndex = i;
      headerMap = KNOWN_LAYOUT_2026;
      break;
    }
  }

  if (headerRowIndex === -1) {
    for (let i = 0; i < Math.min(allRows.length, 20); i++) {
      const candidateMap = buildHeaderMapFromSingleRow(allRows[i]);
      if (candidateMap.hcpcs !== undefined && candidateMap.workRvu !== undefined) {
        headerRowIndex = i;
        headerMap = candidateMap;
        errors.push('Used fallback header detection; confirm imported values look correct.');
        break;
      }
    }
  }

  if (headerRowIndex === -1) {
    throw new Error('Could not locate a recognizable PPRRVU header row. Aborting import rather than guessing column positions.');
  }

  const rows: ParsedRvuRow[] = [];
  for (const cells of allRows.slice(headerRowIndex + 1)) {
    const hcpcs = cells[headerMap.hcpcs]?.trim();
    if (!hcpcs || !/^[0-9A-Z]{4,5}$/i.test(hcpcs)) continue;

    const statusCode = (headerMap.statusCode !== undefined ? cells[headerMap.statusCode] : 'A')?.trim() || 'A';
    rows.push({
      cptCode: hcpcs.toUpperCase(),
      modifier: headerMap.modifier !== undefined ? cells[headerMap.modifier]?.trim() || null : null,
      description: headerMap.description !== undefined ? cells[headerMap.description]?.trim() || '' : '',
      statusCode: statusCode.toUpperCase(),
      workRvu: parseNumericCell(cells[headerMap.workRvu]),
      nonFacilityPeRvu: parseNumericCell(cells[headerMap.nonFacilityPeRvu]),
      facilityPeRvu: parseNumericCell(cells[headerMap.facilityPeRvu]),
      malpracticeRvu: parseNumericCell(cells[headerMap.malpracticeRvu]),
      totalRvuNonFacility: parseNumericCell(cells[headerMap.nonFacilityTotal]),
      totalRvuFacility: parseNumericCell(cells[headerMap.facilityTotal]),
      pcTcIndicator: mapPcTc(headerMap.pcTcIndicator !== undefined ? cells[headerMap.pcTcIndicator] : undefined),
      globalDays: headerMap.globalDays !== undefined ? cells[headerMap.globalDays]?.trim() || null : null,
    });
  }

  if (rows.length === 0) throw new Error('Header row was found but no valid data rows were parsed.');
  return { rows, sourceFilename, year: inferYear(sourceFilename, filename), errors };
}

function toCptRow(row: ParsedRvuRow, fileVersion: string, existingRow: CptRvuRow | undefined, nowIso: string): CptRvuRow {
  return {
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
    statusCategory: STATUS_CATEGORY_MAP[row.statusCode] ?? 'unknown',
    globalDays: row.globalDays,
    pcTcIndicator: row.pcTcIndicator,
    modality: existingRow?.modality ?? classifyModality(row.cptCode),
    rvuFileVersion: fileVersion,
    effectiveDate: nowIso.slice(0, 10),
    isUserVerified: false,
    createdAt: existingRow?.createdAt ?? nowIso,
    updatedAt: nowIso,
  };
}

export async function importRvuRows(
  rows: ParsedRvuRow[],
  fileVersion: string,
): Promise<{ result: ImportResult; cptRows: CptRvuRow[] }> {
  const nowIso = new Date().toISOString();
  const result: ImportResult = {
    success: false,
    fileVersion,
    year: inferYear(fileVersion, fileVersion),
    sourceFilename: fileVersion,
    rowsAdded: 0,
    rowsUpdated: 0,
    rowsUnchanged: 0,
    rowsSkippedNoWorkRvu: 0,
    significantChanges: [],
    errors: [],
    confirmationMessage: '',
    savedToSupabase: false,
  };
  const cptRows: CptRvuRow[] = [];

  await db.transaction('rw', db.cptRvuTable, async () => {
    for (const row of rows) {
      if (row.workRvu === null || row.workRvu === 0) result.rowsSkippedNoWorkRvu++;

      const existingRow = await db.cptRvuTable
        .where('cptCode')
        .equals(row.cptCode)
        .filter((r) => (r.modifier ?? null) === (row.modifier ?? null))
        .first();

      const newRow = toCptRow(row, fileVersion, existingRow, nowIso);
      cptRows.push(newRow);

      if (!existingRow) {
        await db.cptRvuTable.put(newRow);
        result.rowsAdded++;
        continue;
      }

      const unchanged =
        existingRow.workRvu === newRow.workRvu &&
        existingRow.description === newRow.description &&
        existingRow.statusCode === newRow.statusCode;

      if (unchanged) {
        result.rowsUnchanged++;
      } else {
        await db.cptRvuTable.put(newRow);
        result.rowsUpdated++;
        const oldWrvu = existingRow.workRvu;
        const newWrvu = newRow.workRvu;
        if (oldWrvu !== null && newWrvu !== null && oldWrvu !== 0) {
          const percentChange = ((newWrvu - oldWrvu) / oldWrvu) * 100;
          if (Math.abs(percentChange) >= 5) {
            result.significantChanges.push({ cptCode: row.cptCode, modifier: row.modifier, oldWorkRvu: oldWrvu, newWorkRvu: newWrvu, percentChange });
          }
        } else if (oldWrvu !== newWrvu) {
          result.significantChanges.push({ cptCode: row.cptCode, modifier: row.modifier, oldWorkRvu: oldWrvu, newWorkRvu: newWrvu, percentChange: null });
        }
      }
    }
  });

  result.success = true;
  return { result, cptRows };
}

export async function importRvuFile(
  fileBuffer: ArrayBuffer,
  filename: string,
  fileVersionLabel: string,
): Promise<ImportResult> {
  const parsed = await parseRvuFile(fileBuffer, filename);
  const { result, cptRows } = await importRvuRows(parsed.rows, fileVersionLabel);
  result.year = parsed.year;
  result.sourceFilename = parsed.sourceFilename;
  result.errors = [...parsed.errors, ...result.errors];
  result.confirmationMessage = `Imported ${cptRows.length.toLocaleString()} CPT/RVU rows for ${parsed.year}.`;

  if (supabasePersistence.isConfigured()) {
    await supabasePersistence.replaceActiveRvuDataset({
      year: parsed.year,
      filename,
      sourceFilename: parsed.sourceFilename,
      rows: cptRows,
    });
    result.savedToSupabase = true;
  } else {
    result.errors.push('Supabase is not configured; import is cached locally and will not persist across Vercel redeploys.');
  }

  return result;
}
