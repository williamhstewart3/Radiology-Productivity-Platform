/**
 * CSVImportProvider.ts
 *
 * Parses a CSV or plain-text file of exam names/CPT codes and returns
 * ImportedStudy[] for the shared pipeline.
 *
 * Accepted CSV formats:
 *   • Single column of exam names or CPT codes (one per row)
 *   • Multi-column with headers: examTitle, cpt, studyDate, studyTime,
 *     accessionNumber, modality, workRvu, patientMRN (all optional except
 *     examTitle or cpt)
 *   • Legacy paste-style: comma or newline-separated exam names / CPT codes
 *
 * Header matching is case-insensitive. Unknown columns are ignored.
 * The pipeline handles alias lookup, CPT matching, and deduplication.
 */

import { parseBulkText } from '../utils/bulkTextParser';
import Papa from 'papaparse';
import type { ImportProvider, ImportedStudy } from '../types/importProvider';
import type { Modality } from '../types';
import { MODALITIES } from '../types';

// Known column aliases for flexible header matching
const HEADER_ALIASES: Record<string, string[]> = {
  examTitle:       ['examtitle', 'exam', 'exam name', 'examname', 'study', 'description'],
  cpt:             ['cpt', 'cptcode', 'cpt code', 'hcpcs'],
  workRvu:         ['wrvu', 'work rvu', 'workrvu', 'rvu'],
  studyDate:       ['studydate', 'study date', 'date', 'logdate', 'log date'],
  studyTime:       ['studytime', 'study time', 'datetime', 'study datetime'],
  accessionNumber: ['accession', 'accessionnumber', 'accession number', 'acc', 'acc#'],
  modality:        ['modality', 'mod'],
  patientMRN:      ['mrn', 'patientmrn', 'patient mrn', 'patient id'],
};

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
}

function buildHeaderMap(headers: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  const normalized = headers.map(normalizeHeader);
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    for (const alias of aliases) {
      const idx = normalized.indexOf(alias);
      if (idx !== -1) { map[field] = idx; break; }
    }
  }
  return map;
}

function parseDate(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  // Accept YYYY-MM-DD and M/D/YYYY
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const d = new Date(trimmed);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

function parseModality(raw: string | undefined): Modality | null {
  if (!raw?.trim()) return null;
  const upper = raw.trim().toUpperCase() as Modality;
  return MODALITIES.includes(upper) ? upper : null;
}

export class CSVImportProvider implements ImportProvider {
  readonly name = 'CSV / Text Import';
  readonly sourceId = 'csv' as const;

  private rawContent: string;
  private defaultStudyDate: string;

  /**
   * @param rawContent  Raw text content of the CSV/TXT file.
   * @param defaultStudyDate  YYYY-MM-DD date applied to rows that have no date column.
   */
  constructor(rawContent: string, defaultStudyDate: string) {
    this.rawContent = rawContent;
    this.defaultStudyDate = defaultStudyDate;
  }

  async importStudies(): Promise<ImportedStudy[]> {
    const now = new Date().toISOString();
    const parsed = Papa.parse<string[]>(this.rawContent, {
      skipEmptyLines: true,
    });
    const lines = parsed.data
      .filter((row) => row.some((cell) => cell.trim().length > 0));

    if (lines.length === 0) return [];

    // Detect if first line looks like a header row (has any known alias)
    const firstLineCells = lines[0].map((c) => c.trim());
    const headerMap = buildHeaderMap(firstLineCells);
    const hasHeader = Object.keys(headerMap).length > 0;

    // ── Multi-column CSV ────────────────────────────────────────────────────
    if (hasHeader) {
      const dataLines = lines.slice(1);
      return dataLines.flatMap((line) => {
        const cells = line.map((c) => c.trim());
        const title = headerMap.examTitle !== undefined ? cells[headerMap.examTitle] : null;
        const cptRaw = headerMap.cpt !== undefined ? cells[headerMap.cpt] : null;

        // Need at least one of exam title or CPT
        if (!title?.trim() && !cptRaw?.trim()) return [];

        const studyDateParsed = headerMap.studyDate !== undefined
          ? parseDate(cells[headerMap.studyDate]) ?? this.defaultStudyDate
          : this.defaultStudyDate;

        const workRvuRaw = headerMap.workRvu !== undefined ? cells[headerMap.workRvu] : null;
        const workRvuNum = workRvuRaw ? parseFloat(workRvuRaw) : null;

        const hasExplicitDate = headerMap.studyDate !== undefined && !!parseDate(cells[headerMap.studyDate]);
        return [{
          examTitle: title?.trim() || cptRaw?.trim() || '',
          canonicalExam: null,
          cpt: cptRaw?.trim() || null,
          workRvu: workRvuNum !== null && !isNaN(workRvuNum) ? workRvuNum : null,
          studyDate: studyDateParsed,
          studyTime: headerMap.studyTime !== undefined ? cells[headerMap.studyTime] || null : null,
          modality: parseModality(headerMap.modality !== undefined ? cells[headerMap.modality] : undefined),
          accessionNumber: headerMap.accessionNumber !== undefined ? cells[headerMap.accessionNumber] || null : null,
          patientMRN: headerMap.patientMRN !== undefined ? cells[headerMap.patientMRN] || null : null,
          source: 'csv' as const,
          importedAt: now,
          dateTimeConfidence: hasExplicitDate ? 0.85 : 0,
          dateTimeSource: hasExplicitDate ? 'import_default' : 'import_default',
        } satisfies ImportedStudy];
      });
    }

    // ── Single-column / paste-style fallback ────────────────────────────────
    // Re-use the existing bulkTextParser which handles:
    //   • One exam name per line
    //   • Comma-separated CPT codes
    //   • Mixed CPT / exam name input
    const entries = parseBulkText(this.rawContent);
    return entries.map((examName) => ({
      examTitle: examName,
      canonicalExam: null,
      cpt: null,
      workRvu: null,
      studyDate: this.defaultStudyDate,
      studyTime: null,
      modality: null,
      accessionNumber: null,
      patientMRN: null,
      source: 'csv' as const,
      importedAt: now,
      dateTimeConfidence: 0,
      dateTimeSource: 'import_default' as const,
    }));
  }
}
