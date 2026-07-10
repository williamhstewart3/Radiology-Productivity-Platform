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
import { parseDateTimeFromOcr } from '../utils/studyDateParser';
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
  ocrProvider: string;
  ocrText: string;
  ocrLines: string[];
  rawLineCount: number;
  cleanedLineCount: number;
  parsedRowCount: number;
  rejectedRowCount: number;
  rejectedRows: OcrParseDebugInfo['rejectedRows'];
  duplicateSkippedCount?: number;
  finalReviewRowCount?: number;
  columnText?: Record<PowerScribeColumnName, string>;
  detectedRows: OCRImportDebugRow[];
  ocrConfidence: number;
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

function reassembleColumnRowsByIndex(results: ColumnOcrResults): string[] {
  const maxLength = Math.max(results.procedure.lines.length, results.examDate.lines.length, results.modifiedDate.lines.length);
  return Array.from({ length: maxLength }, (_, index) => [
    results.procedure.lines[index] ?? 'UNCLEAR POWERSCRIBE ROW',
    results.examDate.lines[index] ?? '',
    results.modifiedDate.lines[index] ?? '',
  ].join(' ').replace(/\s{2,}/g, ' ').trim()).filter(Boolean);
}

function applyColumnDateOverrides(row: ParsedLine, debugRow: ReassembledColumnRow | undefined): ParsedLine {
  if (!debugRow) return row;
  const exam = parseDateTimeFromOcr(debugRow.rawExamDateColumnText);
  const modified = parseDateTimeFromOcr(debugRow.rawModifiedDateColumnText);
  const examDateTime = exam?.studyDateTime ?? null;
  const modifiedDateTime = modified?.studyDateTime ?? null;

  return {
    ...row,
    rawProcedureColumnText: debugRow.rawProcedureColumnText,
    rawExamDateColumnText: debugRow.rawExamDateColumnText,
    rawModifiedDateColumnText: debugRow.rawModifiedDateColumnText,
    examDate: exam?.studyDate ?? null,
    examTime: exam?.studyTime ?? null,
    examDateTime,
    studyDate: exam?.studyDate ?? null,
    studyDateTime: examDateTime,
    modifiedDate: modified?.studyDate ?? null,
    modifiedTime: modified?.studyTime ?? null,
    modifiedDateTime,
    dateTimeConfidence: Math.max(row.dateTimeConfidence, exam?.confidence ?? 0, modified?.confidence ?? 0),
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
    let columnDebugRows = columnResults ? reassembleColumnRowsWithDebug(columnResults) : [];
    let rowLines = columnResults ? columnDebugRows.map((row) => row.line) : result?.lines ?? [];
    let parsedWithDebug = parseOcrLinesWithDebug(rowLines);
    if (columnResults && parsedWithDebug.rows.length === 0) {
      const fallbackLines = reassembleColumnRowsByIndex(columnResults);
      const fallbackParsed = parseOcrLinesWithDebug(fallbackLines);
      if (fallbackParsed.rows.length > 0 || fallbackLines.length > rowLines.length) {
        rowLines = fallbackLines;
        columnDebugRows = fallbackLines.map((line) => ({
          line,
          rawProcedureColumnText: '',
          rawExamDateColumnText: '',
          rawModifiedDateColumnText: '',
        }));
        parsedWithDebug = fallbackParsed;
      }
    }
    const columnDebugByLine = new Map(columnDebugRows.map((row) => [row.line, row]));
    const regexParsed = parsedWithDebug.rows.map((row) => {
      const debugRow = columnDebugByLine.get(row.rawText);
      return {
        ...applyColumnDateOverrides(row, debugRow),
        accessionNumber: null,
      };
    });
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
      ocrProvider: provider.constructor.name,
      ocrText,
      ocrLines,
      rawLineCount: parsedWithDebug.debug.rawLineCount,
      cleanedLineCount: parsedWithDebug.debug.cleanedLineCount,
      parsedRowCount: parsedWithDebug.debug.parsedRowCount,
      rejectedRowCount: parsedWithDebug.debug.rejectedRowCount,
      rejectedRows: parsedWithDebug.debug.rejectedRows,
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
        studyTime: p.modifiedDateTime,
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
          ? [p.reviewReason, 'Missing Modified time/date - productivity date will use selected log date unless corrected.'].filter(Boolean).join(' | ')
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
