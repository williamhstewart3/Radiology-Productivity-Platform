/**
 * OCRImportProvider.ts
 *
 * Extracts studies from a screenshot or image file using the configured
 * OCR backend, then normalizes the output into ImportedStudy[].
 *
 * Responsibilities of this provider:
 *   • Run OCR on the supplied image file
 *   • Parse structured fields (exam name, accession, datetime) from OCR lines
 *   • Return ImportedStudy[] — one per parsed line
 *
 * The provider does NOT perform alias lookup, CPT matching, or duplicate
 * detection. Those run in importPipeline.ts, identically for every source.
 */

import { parseOcrLinesWithDebug, type OcrParseDebugInfo } from '../utils/powerScribeParser';
import { getDefaultOcrProvider } from '../utils/ocrProvider';
import { PSM } from 'tesseract.js';
import { maybeEnhanceOcrWithLlm } from '../services/llmOcrExtractionService';
import { parseDateTimeFromDateColumn } from '../utils/studyDateParser';
import { normalizeOcrExamTextForMatching } from '../utils/ocrExamTextNormalization';
import { dedupeReasons } from '../utils/reviewReasons';
import {
  DEFAULT_POWERSCRIBE_STUDY_LIST_CROP,
  preprocessPowerScribeColumnsForOcr,
  type DetectedCrop,
  type PowerScribeColumnName,
  type RelativeCropRect,
} from '../utils/imageCrop';
import type { ImportProvider, ImportedStudy } from '../types/importProvider';
import type { ParsedLine } from '../utils/powerScribeParser';
import type { OcrPositionedLine, OcrResult } from '../utils/ocrProvider';
import type { PowerScribeOcrAccounting } from '../types/structuredOcr';

export interface OCRImportOptions {
  cropBeforeOcr?: boolean;
  cropRegion?: RelativeCropRect | null;
  autoDetectPowerScribeTable?: boolean;
}

export interface OCRImportDebugRow extends ParsedLine {
  matchResult?: {
    selectedCpts: string[];
    topCandidate: string | null;
    confidence: number | null;
    needsReview: boolean;
    reviewReason: string | null;
    duplicateKey?: string | null;
  };
}

export interface OCRImportDebugInfo {
  crop: DetectedCrop | null;
  threeColumnCrop?: DetectedCrop | null;
  columnCrops?: Array<{ name: PowerScribeColumnName; rect: RelativeCropRect }>;
  ocrProvider: string;
  ocrText: string;
  ocrLines: string[];
  rawLineCount: number;
  cleanedLineCount: number;
  columnLineCounts?: Record<PowerScribeColumnName, number>;
  reconstructedRowCount: number;
  parsedRowCount: number;
  rejectedRowCount: number;
  rejectedRows: OcrParseDebugInfo['rejectedRows'];
  duplicateSkippedCount?: number;
  finalReviewRowCount?: number;
  autoApprovedRowCount?: number;
  manuallyApprovedRowCount?: number;
  possibleDuplicateRowCount?: number;
  exactDuplicateSkippedCount?: number;
  excludedRowCount?: number;
  finalSavedRowCount?: number;
  columnText?: Record<PowerScribeColumnName, string>;
  detectedRows: OCRImportDebugRow[];
  ocrConfidence: number;
  accounting?: PowerScribeOcrAccounting | null;
  reconciliationWarning?: string | null;
}

type ColumnOcrResults = Record<PowerScribeColumnName, OcrResult>;

interface ReassembledColumnRow {
  line: string;
  rawProcedureColumnText: string;
  rawExamDateColumnText: string;
  rawModifiedDateColumnText: string;
}

const COLUMN_OCR_PARAMS: Record<PowerScribeColumnName, { pageSegMode: PSM; charWhitelist: string }> = {
  procedure: {
    pageSegMode: PSM.SINGLE_BLOCK,
    charWhitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 /&-.',
  },
  examDate: {
    pageSegMode: PSM.SINGLE_BLOCK,
    charWhitelist: '0123456789/: -TAPMapm',
  },
  modifiedDate: {
    pageSegMode: PSM.SINGLE_BLOCK,
    charWhitelist: '0123456789/: -TAPMapm',
  },
};

function lineCenterY(line: OcrPositionedLine): number | null {
  if (!line.bbox) return null;
  return (line.bbox.y0 + line.bbox.y1) / 2;
}

function lineHeight(line: OcrPositionedLine): number | null {
  if (!line.bbox) return null;
  return Math.max(1, line.bbox.y1 - line.bbox.y0);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function normalizeColumnLineText(text: string): string {
  return text
    .replace(/[|•·]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function nearestLine(lines: OcrPositionedLine[], y: number, tolerance: number): OcrPositionedLine | null {
  let best: { line: OcrPositionedLine; distance: number } | null = null;
  for (const line of lines) {
    const center = lineCenterY(line);
    if (center == null) continue;
    const distance = Math.abs(center - y);
    if (distance <= tolerance && (!best || distance < best.distance)) {
      best = { line, distance };
    }
  }
  return best?.line ?? null;
}

function nearbyColumnText(lines: OcrPositionedLine[], y: number, tolerance: number): string {
  const nearby = lines
    .map((line) => ({ line, center: lineCenterY(line) }))
    .filter((item): item is { line: OcrPositionedLine; center: number } => item.center != null && Math.abs(item.center - y) <= tolerance)
    .sort((a, b) => {
      const yDiff = (a.line.bbox?.y0 ?? 0) - (b.line.bbox?.y0 ?? 0);
      if (Math.abs(yDiff) > 4) return yDiff;
      return (a.line.bbox?.x0 ?? 0) - (b.line.bbox?.x0 ?? 0);
    });
  const parts: string[] = [];
  for (const item of nearby) {
    const text = normalizeColumnLineText(item.line.text);
    if (text && !parts.includes(text)) parts.push(text);
  }
  return parts.join(' ').replace(/\s{2,}/g, ' ').trim();
}

function reassembleColumnRowsWithDebug(results: ColumnOcrResults): ReassembledColumnRow[] {
  const procedureLines = results.procedure.positionedLines;
  const examLines = results.examDate.positionedLines;
  const modifiedLines = results.modifiedDate.positionedLines;
  const medianHeight = median([
    ...procedureLines,
    ...examLines,
    ...modifiedLines,
  ].map(lineHeight).filter((height): height is number => height != null));
  const tolerance = Math.max(22, Math.min(42, Math.round((medianHeight ?? 16) * 1.8)));
  const allCenters = [
    ...procedureLines,
    ...examLines,
    ...modifiedLines,
  ]
    .map(lineCenterY)
    .filter((y): y is number => y != null)
    .sort((a, b) => a - b);

  const rowCenters: number[] = [];
  for (const center of allCenters) {
    const existingIndex = rowCenters.findIndex((existing) => Math.abs(existing - center) <= tolerance);
    if (existingIndex >= 0) {
      rowCenters[existingIndex] = (rowCenters[existingIndex] + center) / 2;
    } else {
      rowCenters.push(center);
    }
  }

  if (rowCenters.length === 0) {
    const maxLength = Math.max(results.procedure.lines.length, results.examDate.lines.length, results.modifiedDate.lines.length);
    return Array.from({ length: maxLength }, (_, index) => {
      const rawProcedureColumnText = normalizeColumnLineText(results.procedure.lines[index] ?? 'UNCLEAR POWERSCRIBE ROW');
      const rawExamDateColumnText = normalizeColumnLineText(results.examDate.lines[index] ?? '');
      const rawModifiedDateColumnText = normalizeColumnLineText(results.modifiedDate.lines[index] ?? '');
      return {
        line: [rawProcedureColumnText, rawExamDateColumnText, rawModifiedDateColumnText].join(' ').trim(),
        rawProcedureColumnText,
        rawExamDateColumnText,
        rawModifiedDateColumnText,
      };
    });
  }

  return rowCenters
    .sort((a, b) => a - b)
    .map((center) => {
      const procedure = nearestLine(procedureLines, center, tolerance);
      const rawProcedureColumnText = normalizeColumnLineText(procedure?.text ?? 'UNCLEAR POWERSCRIBE ROW');
      const rawExamDateColumnText = nearbyColumnText(examLines, center, tolerance);
      const rawModifiedDateColumnText = nearbyColumnText(modifiedLines, center, tolerance);
      return {
        line: [
          rawProcedureColumnText,
          rawExamDateColumnText,
          rawModifiedDateColumnText,
        ].join(' ').replace(/\s{2,}/g, ' ').trim(),
        rawProcedureColumnText,
        rawExamDateColumnText,
        rawModifiedDateColumnText,
      };
    })
    .filter((row) => row.line.length > 0);
}

function reassembleColumnRows(results: ColumnOcrResults): string[] {
  return reassembleColumnRowsWithDebug(results).map((row) => row.line);
}

export function __testReassembleColumnRows(results: ColumnOcrResults): string[] {
  return reassembleColumnRows(results);
}

function reassembleColumnRowsByIndex(results: ColumnOcrResults): ReassembledColumnRow[] {
  const maxLength = Math.max(results.procedure.lines.length, results.examDate.lines.length, results.modifiedDate.lines.length);
  return Array.from({ length: maxLength }, (_, index) => {
    const rawProcedureColumnText = normalizeColumnLineText(results.procedure.lines[index] ?? 'UNCLEAR POWERSCRIBE ROW');
    const rawExamDateColumnText = normalizeColumnLineText(results.examDate.lines[index] ?? '');
    const rawModifiedDateColumnText = normalizeColumnLineText(results.modifiedDate.lines[index] ?? '');
    return {
      line: [rawProcedureColumnText, rawExamDateColumnText, rawModifiedDateColumnText].join(' ').replace(/\s{2,}/g, ' ').trim(),
      rawProcedureColumnText,
      rawExamDateColumnText,
      rawModifiedDateColumnText,
    };
  }).filter((row) => row.line.length > 0);
}

interface AnchorBand {
  lower: number;
  upper: number;
  anchor: OcrPositionedLine;
  gapFlagged: boolean;
}

function buildModifiedAnchorBands(modifiedLines: OcrPositionedLine[]): AnchorBand[] | null {
  const anchors = modifiedLines
    .map((line) => ({ line, center: lineCenterY(line) }))
    .filter((item): item is { line: OcrPositionedLine; center: number } =>
      item.center != null && Boolean(parseDateTimeFromDateColumn(normalizeColumnLineText(item.line.text))?.studyDateTime),
    )
    .sort((a, b) => a.center - b.center);

  if (anchors.length === 0) return null;

  const pitches: number[] = [];
  for (let i = 1; i < anchors.length; i++) pitches.push(anchors[i].center - anchors[i - 1].center);
  const medianPitch = pitches.length > 0 ? (median(pitches) ?? 40) : 40;

  return anchors.map((anchor, index) => ({
    lower: index === 0 ? -Infinity : (anchors[index - 1].center + anchor.center) / 2,
    upper: index === anchors.length - 1 ? Infinity : (anchor.center + anchors[index + 1].center) / 2,
    anchor: anchor.line,
    gapFlagged: index > 0 && anchor.center - anchors[index - 1].center > medianPitch * 1.6,
  }));
}

function linesInBand(lines: OcrPositionedLine[], band: AnchorBand): OcrPositionedLine[] {
  return lines
    .map((line) => ({ line, center: lineCenterY(line) }))
    .filter((item): item is { line: OcrPositionedLine; center: number } => item.center != null && item.center > band.lower && item.center <= band.upper)
    .sort((a, b) => a.center - b.center)
    .map((item) => item.line);
}

function joinedColumnText(lines: OcrPositionedLine[]): string {
  const parts: string[] = [];
  for (const line of lines) {
    const text = normalizeColumnLineText(line.text);
    if (text && !parts.includes(text)) parts.push(text);
  }
  return parts.join(' ').replace(/\s{2,}/g, ' ').trim();
}

function bandColumnRows(results: ColumnOcrResults): { rows: ReassembledColumnRow[]; gapFlags: Array<string | null> } | null {
  const bands = buildModifiedAnchorBands(results.modifiedDate.positionedLines);
  if (!bands) return null;

  const rows = bands.map((band) => {
    const rawProcedureColumnText = joinedColumnText(linesInBand(results.procedure.positionedLines, band));
    const rawExamDateColumnText = joinedColumnText(linesInBand(results.examDate.positionedLines, band));
    const rawModifiedDateColumnText = normalizeColumnLineText(band.anchor.text);
    return {
      line: [rawProcedureColumnText, rawExamDateColumnText, rawModifiedDateColumnText].filter(Boolean).join(' ').trim(),
      rawProcedureColumnText,
      rawExamDateColumnText,
      rawModifiedDateColumnText,
    };
  });
  const gapFlags = bands.map((band) => (band.gapFlagged ? 'Possible undetected row above this one' : null));

  return { rows, gapFlags };
}

export function __testBandColumnRows(results: ColumnOcrResults): { rows: ReassembledColumnRow[]; gapFlags: Array<string | null> } | null {
  return bandColumnRows(results);
}

const STANDALONE_DIGIT_TOKEN = /^\d+$/;
const VIEW_TOKEN = /^VIEWS?$/i;
const NUMERIC_CONTAMINATION_TOKEN = /^\d{3,}$/;

function stripProcedureDigitNoise(text: string): { text: string; contaminated: boolean } {
  if (!text) return { text, contaminated: false };
  const tokens = text.split(/\s+/).filter(Boolean);

  while (tokens.length > 0 && STANDALONE_DIGIT_TOKEN.test(tokens[0])) {
    if (tokens.length > 1 && VIEW_TOKEN.test(tokens[1])) break;
    tokens.shift();
  }
  while (tokens.length > 0 && STANDALONE_DIGIT_TOKEN.test(tokens[tokens.length - 1])) {
    if (tokens.length > 1 && VIEW_TOKEN.test(tokens[tokens.length - 2])) break;
    tokens.pop();
  }

  const contaminated = tokens.some((token) => NUMERIC_CONTAMINATION_TOKEN.test(token));
  return { text: tokens.join(' '), contaminated };
}

function applyProcedureDigitHygiene(procedureName: string): { text: string; contaminated: boolean } {
  const hygiene = stripProcedureDigitNoise(procedureName);
  const text = hygiene.text.length >= 2 ? hygiene.text : 'UNCLEAR POWERSCRIBE ROW';
  return { text, contaminated: hygiene.contaminated };
}

export function __testApplyProcedureDigitHygiene(procedureName: string): { text: string; contaminated: boolean } {
  return applyProcedureDigitHygiene(procedureName);
}

function buildParsedLineFromColumnTexts(
  rawProcedureColumnText: string,
  rawExamDateColumnText: string,
  rawModifiedDateColumnText: string,
  reviewReasonExtra: string | null = null,
): ParsedLine {
  const procedureText = rawProcedureColumnText || 'UNCLEAR POWERSCRIBE ROW';
  const cleanedExamNameRaw = normalizeOcrExamTextForMatching(procedureText);
  const cleanedExamNameBeforeHygiene = cleanedExamNameRaw.length >= 2 ? cleanedExamNameRaw : 'UNCLEAR POWERSCRIBE ROW';
  const digitHygiene = applyProcedureDigitHygiene(cleanedExamNameBeforeHygiene);
  const cleanedExamName = digitHygiene.text;

  const exam = parseDateTimeFromDateColumn(rawExamDateColumnText);
  const modified = parseDateTimeFromDateColumn(rawModifiedDateColumnText);

  let extractionConfidence = 0.25;
  if (cleanedExamName !== 'UNCLEAR POWERSCRIBE ROW') extractionConfidence += 0.35;
  if (exam?.studyDateTime) extractionConfidence += 0.2;
  if (modified?.studyDateTime) extractionConfidence += 0.2;
  extractionConfidence = Math.max(0, Math.min(1, extractionConfidence));

  const reviewReasons: string[] = [];
  if (cleanedExamName === 'UNCLEAR POWERSCRIBE ROW') reviewReasons.push('Unclear PowerScribe procedure text');
  if (!exam?.studyDateTime) reviewReasons.push('Missing or unclear Exam Date');
  if (!modified?.studyDateTime) reviewReasons.push('Missing or unclear Modified Date');
  if (digitHygiene.contaminated) reviewReasons.push('Numeric contamination in procedure text');
  if (reviewReasonExtra) reviewReasons.push(reviewReasonExtra);
  const needsReview = reviewReasons.length > 0 || extractionConfidence < 0.75;

  const rawText = [rawProcedureColumnText, rawExamDateColumnText, rawModifiedDateColumnText].filter(Boolean).join(' ').trim();

  return {
    rawText,
    rawProcedureColumnText,
    rawExamDateColumnText,
    rawModifiedDateColumnText,
    procedureName: cleanedExamName,
    examName: cleanedExamName,
    cleanedExamName,
    cleanedText: cleanedExamName,
    examDate: exam?.studyDate ?? null,
    examTime: exam?.studyTime ?? null,
    examDateTime: exam?.studyDateTime ?? null,
    studyDateTime: exam?.studyDateTime ?? null,
    studyDate: exam?.studyDate ?? null,
    modifiedDateTime: modified?.studyDateTime ?? null,
    modifiedDate: modified?.studyDate ?? null,
    modifiedTime: modified?.studyTime ?? null,
    accessionNumber: null,
    rowIndex: null,
    dateTimeConfidence: Math.max(exam?.confidence ?? 0, modified?.confidence ?? 0),
    extractionConfidence,
    needsReview,
    reviewReason: reviewReasons.length > 0 ? reviewReasons.join('; ') : null,
  };
}

export class OCRImportProvider implements ImportProvider {
  readonly name = 'OCR Screenshot';
  readonly sourceId = 'ocr' as const;

  private file: File | Blob;
  private studyDate: string;
  private options: OCRImportOptions;
  private debugInfo: OCRImportDebugInfo | null = null;

  constructor(file: File | Blob, studyDate: string, options: OCRImportOptions = {}) {
    this.file = file;
    this.studyDate = studyDate;
    this.options = options;
  }

  async importStudies(): Promise<ImportedStudy[]> {
    const provider = getDefaultOcrProvider();
    const preprocessed = this.options.cropBeforeOcr === false
      ? null
      : await preprocessPowerScribeColumnsForOcr(
          this.file,
          this.options.autoDetectPowerScribeTable === false
            ? this.options.cropRegion ?? DEFAULT_POWERSCRIBE_STUDY_LIST_CROP
            : this.options.cropRegion ?? null,
        );
    const result = preprocessed
      ? null
      : await provider.extractText(this.file);
    const columnResults = preprocessed
      ? {} as ColumnOcrResults
      : null;
    if (preprocessed && columnResults) {
      for (const column of preprocessed.columns) {
        columnResults[column.name] = await provider.extractText(column.blob, COLUMN_OCR_PARAMS[column.name]);
      }
    }
    let rowLines: string[];
    let regexParsed: Array<ParsedLine & { accessionNumber: string | null }>;
    let debugCounts: { rawLineCount: number; cleanedLineCount: number; parsedRowCount: number; rejectedRowCount: number; rejectedRows: OcrParseDebugInfo['rejectedRows'] };

    if (columnResults) {
      const banded = bandColumnRows(columnResults);
      let columnRows: ReassembledColumnRow[];
      let gapFlags: Array<string | null>;

      if (banded) {
        columnRows = banded.rows;
        gapFlags = banded.gapFlags;
      } else {
        columnRows = reassembleColumnRowsWithDebug(columnResults);
        if (columnRows.length === 0) {
          columnRows = reassembleColumnRowsByIndex(columnResults);
        }
        gapFlags = columnRows.map(() => null);
      }

      regexParsed = columnRows.map((row, index) => ({
        ...buildParsedLineFromColumnTexts(row.rawProcedureColumnText, row.rawExamDateColumnText, row.rawModifiedDateColumnText, gapFlags[index] ?? null),
        accessionNumber: null,
      }));
      rowLines = regexParsed.map((row) => row.rawText);
      debugCounts = {
        rawLineCount: columnResults.procedure.lines.length + columnResults.examDate.lines.length + columnResults.modifiedDate.lines.length,
        cleanedLineCount: rowLines.length,
        parsedRowCount: regexParsed.length,
        rejectedRowCount: 0,
        rejectedRows: [],
      };
    } else {
      rowLines = result?.lines ?? [];
      const parsedWithDebug = parseOcrLinesWithDebug(rowLines);
      regexParsed = parsedWithDebug.rows.map((row) => ({ ...row, accessionNumber: null }));
      debugCounts = {
        rawLineCount: parsedWithDebug.debug.rawLineCount,
        cleanedLineCount: parsedWithDebug.debug.cleanedLineCount,
        parsedRowCount: parsedWithDebug.debug.parsedRowCount,
        rejectedRowCount: parsedWithDebug.debug.rejectedRowCount,
        rejectedRows: parsedWithDebug.debug.rejectedRows,
      };
    }

    const now = new Date().toISOString();
    const ocrConfidence = columnResults
      ? (columnResults.procedure.confidence + columnResults.examDate.confidence + columnResults.modifiedDate.confidence) / 3
      : result?.confidence ?? 0;
    const ocrText = columnResults
      ? rowLines.join('\n')
      : result?.rawText ?? '';
    const ocrLines = rowLines;
    const parsed = await maybeEnhanceOcrWithLlm({
      rawText: ocrText,
      lines: ocrLines,
      regexParsed,
      fallbackStudyDate: this.studyDate,
      ocrProviderName: provider.constructor.name,
      ocrConfidence,
      enabled: false,
    });

    this.debugInfo = {
      crop: preprocessed?.tableCrop ?? null,
      threeColumnCrop: preprocessed?.threeColumnCrop ?? null,
      columnCrops: preprocessed?.columns.map((column) => ({ name: column.name, rect: column.rect })),
      ocrProvider: provider.constructor.name,
      ocrText,
      ocrLines,
      rawLineCount: debugCounts.rawLineCount,
      cleanedLineCount: debugCounts.cleanedLineCount,
      columnLineCounts: columnResults
        ? {
            procedure: columnResults.procedure.lines.length,
            examDate: columnResults.examDate.lines.length,
            modifiedDate: columnResults.modifiedDate.lines.length,
          }
        : undefined,
      reconstructedRowCount: rowLines.length,
      parsedRowCount: debugCounts.parsedRowCount,
      rejectedRowCount: debugCounts.rejectedRowCount,
      rejectedRows: debugCounts.rejectedRows,
      columnText: columnResults
        ? {
            procedure: columnResults.procedure.rawText,
            examDate: columnResults.examDate.rawText,
            modifiedDate: columnResults.modifiedDate.rawText,
          }
        : undefined,
      detectedRows: parsed,
      ocrConfidence,
    };

    return parsed.map((p) => {
      const productivityDate = p.modifiedDate ?? this.studyDate;
      const missingModifiedDate = !p.modifiedDateTime;

      return {
        examTitle: p.procedureName,
        procedureName: p.procedureName,
        canonicalExam: null,
        cpt: null,
        workRvu: null,
        studyDate: productivityDate,
        examDate: p.examDate,
        examTime: p.examTime,
        examDateTime: p.examDateTime,
        studyTime: p.examDateTime,
        modifiedDate: p.modifiedDate,
        modifiedDateTime: p.modifiedDateTime,
        modifiedTime: p.modifiedTime,
        modality: null,
        accessionNumber: null,
        patientMRN: null,
        rowIndex: p.rowIndex,
        cleanedExamName: p.cleanedExamName,
        cleanedText: p.cleanedText,
        extractionConfidence: p.extractionConfidence,
        parserNeedsReview: p.needsReview || missingModifiedDate,
        parserReviewReason: missingModifiedDate
          ? dedupeReasons(p.reviewReason, 'Missing Modified time/date - productivity date will use selected log date unless corrected.')
          : p.reviewReason,
        parserRawLine: p.rawText,
        ocrConfidence,
        source: 'ocr' as const,
        importedAt: now,
        dateTimeConfidence: p.dateTimeConfidence,
        dateTimeSource: p.modifiedDateTime ? 'ocr' : 'import_default',
      };
    });
  }

  getDebugInfo(): OCRImportDebugInfo | null {
    return this.debugInfo;
  }
}
