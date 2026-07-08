import { strFromU8, unzipSync } from 'fflate';
import { db } from '../db/database';
import { normalizeRadiologyDescription } from './radiologyDescriptionNormalization';
import type { ExamDictionaryEntry, Modality } from '../types';

export interface InstitutionProcedureMappingSummary {
  totalRows: number;
  mappedRows: number;
  skippedBlankCptRows: number;
  multiCptRows: number;
  modalityCounts: Record<string, number>;
  importedEntries: number;
  replacedEntries: number;
  warnings: string[];
}

interface ParsedWorkbookRow {
  sheetName: string;
  modality: Modality;
  procedureType: string;
  cptCodes: string[];
}

const TARGET_SHEETS: Record<string, Modality> = {
  MR: 'MRI',
  US: 'US',
  CT: 'CT',
};

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

function attr(xml: string, name: string): string | null {
  const match = xml.match(new RegExp(`\\b${name}="([^"]*)"`, 'i'));
  return match ? decodeXml(match[1]) : null;
}

function normalizeZipPath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}

function readXml(files: Record<string, Uint8Array>, path: string): string {
  const file = files[path];
  if (!file) throw new Error(`Missing workbook part: ${path}`);
  return strFromU8(file);
}

function parseSharedStrings(xml: string): string[] {
  const values: string[] = [];
  for (const si of xml.matchAll(/<si\b[\s\S]*?<\/si>/gi)) {
    const parts = Array.from(si[0].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)).map((match) => decodeXml(match[1]));
    values.push(parts.join(''));
  }
  return values;
}

function parseWorkbookSheets(workbookXml: string, relsXml: string): Array<{ name: string; path: string }> {
  const rels = new Map<string, string>();
  for (const rel of relsXml.matchAll(/<Relationship\b[^>]*>/gi)) {
    const id = attr(rel[0], 'Id');
    const target = attr(rel[0], 'Target');
    if (id && target) rels.set(id, normalizeZipPath(target.startsWith('/') ? target.slice(1) : `xl/${target}`));
  }

  const sheets: Array<{ name: string; path: string }> = [];
  for (const sheet of workbookXml.matchAll(/<sheet\b[^>]*>/gi)) {
    const name = attr(sheet[0], 'name');
    const relationshipId = attr(sheet[0], 'r:id');
    const path = relationshipId ? rels.get(relationshipId) : null;
    if (name && path) sheets.push({ name, path });
  }
  return sheets;
}

function columnIndex(cellRef: string): number {
  const letters = cellRef.match(/[A-Z]+/i)?.[0]?.toUpperCase() ?? 'A';
  let value = 0;
  for (const letter of letters) value = value * 26 + letter.charCodeAt(0) - 64;
  return value - 1;
}

function parseCellValue(cellXml: string, sharedStrings: string[]): string {
  const type = attr(cellXml, 't');
  const value = cellXml.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i)?.[1] ?? '';
  if (type === 's') return sharedStrings[Number(value)] ?? '';
  if (type === 'inlineStr') {
    return Array.from(cellXml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)).map((match) => decodeXml(match[1])).join('');
  }
  return decodeXml(value);
}

function parseSheetRows(sheetXml: string, sharedStrings: string[]): string[][] {
  const rows: string[][] = [];
  for (const rowXml of sheetXml.matchAll(/<row\b[^>]*>[\s\S]*?<\/row>/gi)) {
    const row: string[] = [];
    let nextIndex = 0;
    for (const cell of rowXml[0].matchAll(/<c\b[^>]*>[\s\S]*?<\/c>/gi)) {
      const ref = attr(cell[0], 'r');
      const index = ref ? columnIndex(ref) : nextIndex;
      row[index] = parseCellValue(cell[0], sharedStrings);
      nextIndex = index + 1;
    }
    rows.push(row.map((value) => (value ?? '').trim()));
  }
  return rows;
}

function parseCptCodes(value: string): string[] {
  return Array.from(new Set(
    value
      .split(/[\/,;|]+/)
      .map((part) => part.trim().replace(/\.0$/, ''))
      .filter((part) => /^\d{5}$/.test(part)),
  ));
}

function stableInstitutionId(sheetName: string, normalizedKey: string): string {
  return `institution_${sheetName}_${normalizedKey}`
    .replace(/[^a-z0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

export function parseInstitutionProcedureWorkbook(buffer: ArrayBuffer): { rows: ParsedWorkbookRow[]; summary: InstitutionProcedureMappingSummary } {
  const files = unzipSync(new Uint8Array(buffer));
  const workbookXml = readXml(files, 'xl/workbook.xml');
  const relsXml = readXml(files, 'xl/_rels/workbook.xml.rels');
  const sharedStrings = files['xl/sharedStrings.xml'] ? parseSharedStrings(readXml(files, 'xl/sharedStrings.xml')) : [];
  const sheets = parseWorkbookSheets(workbookXml, relsXml);
  const rows: ParsedWorkbookRow[] = [];
  const summary: InstitutionProcedureMappingSummary = {
    totalRows: 0,
    mappedRows: 0,
    skippedBlankCptRows: 0,
    multiCptRows: 0,
    modalityCounts: {},
    importedEntries: 0,
    replacedEntries: 0,
    warnings: [],
  };

  for (const sheet of sheets) {
    const modality = TARGET_SHEETS[sheet.name.trim().toUpperCase()];
    if (!modality) continue;
    const sheetRows = parseSheetRows(readXml(files, sheet.path), sharedStrings);
    const headerIndex = sheetRows.findIndex((row) =>
      row.some((cell) => cell.trim().toLowerCase() === 'procedure type') &&
      row.some((cell) => cell.trim().toLowerCase() === 'cpt code'),
    );
    if (headerIndex < 0) {
      summary.warnings.push(`${sheet.name}: missing Procedure Type/CPT Code header`);
      continue;
    }
    const header = sheetRows[headerIndex].map((cell) => cell.trim().toLowerCase());
    const procedureIndex = header.indexOf('procedure type');
    const cptIndex = header.indexOf('cpt code');
    for (const row of sheetRows.slice(headerIndex + 1)) {
      const procedureType = row[procedureIndex]?.trim() ?? '';
      if (!procedureType) continue;
      const cptCodes = parseCptCodes(row[cptIndex] ?? '');
      summary.totalRows++;
      summary.modalityCounts[modality] = (summary.modalityCounts[modality] ?? 0) + 1;
      if (cptCodes.length === 0) summary.skippedBlankCptRows++;
      else summary.mappedRows++;
      if (cptCodes.length > 1) summary.multiCptRows++;
      rows.push({ sheetName: sheet.name, modality, procedureType, cptCodes });
    }
  }

  return { rows, summary };
}

export async function importInstitutionProcedureMappings(
  buffer: ArrayBuffer,
  fileName: string,
  options: { replaceExisting?: boolean } = {},
): Promise<InstitutionProcedureMappingSummary> {
  const { rows, summary } = parseInstitutionProcedureWorkbook(buffer);
  const now = new Date().toISOString();
  const replaceExisting = options.replaceExisting !== false;

  if (replaceExisting) {
    const existing = (await db.examDictionary.toArray()).filter((entry) => entry.source === 'institution');
    summary.replacedEntries = existing.length;
    await db.examDictionary.bulkDelete(existing.map((entry) => entry.id));
  }

  const entries: ExamDictionaryEntry[] = rows.map((row) => {
    const normalizedKey = normalizeRadiologyDescription(row.procedureType);
    return {
      id: stableInstitutionId(row.sheetName, normalizedKey),
      canonicalDisplayName: row.procedureType,
      normalizedKey,
      commonSynonyms: [row.procedureType],
      hospitalAliases: [row.procedureType],
      powerScribeNames: [row.procedureType],
      cmsDescription: null,
      cptCodes: row.cptCodes,
      modifier26Wrvu: null,
      modality: row.modality,
      bodyRegion: null,
      typicalCombinations: [],
      timesUsed: 0,
      source: 'institution',
      institutionSheet: row.sheetName,
      institutionProcedureName: row.procedureType,
      sourceFileName: fileName,
      createdAt: now,
      updatedAt: now,
    };
  });

  if (entries.length > 0) await db.examDictionary.bulkPut(entries);
  summary.importedEntries = entries.length;
  return summary;
}
