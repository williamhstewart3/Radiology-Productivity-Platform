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
import { getDefaultOcrEngine } from '../utils/ocrProvider';
import { PSM } from 'tesseract.js';
import { maybeEnhanceOcrWithLlm } from '../services/llmOcrExtractionService';
import { parseDateTimeFromOcr, parseVisibleTimeWithFallbackDate } from '../utils/studyDateParser';
import {
  DEFAULT_POWERSCRIBE_STUDY_LIST_CROP,
  preprocessPowerScribeColumnsForOcr,
  PowerScribeTableNotFoundError,
  type DetectedCrop,
  type PowerScribeCropAccounting,
  type PowerScribeColumnName,
  type RelativeCropRect,
} from '../utils/imageCrop';
import type { ImportProvider, ImportedStudy } from '../types/importProvider';
import type { ParsedLine } from '../utils/powerScribeParser';
import type { OcrPositionedLine, OcrResult } from '../utils/ocrProvider';

export interface OCRImportOptions {
  cropBeforeOcr?: boolean;
  cropRegion?: RelativeCropRect | null;
  savedCropRegion?: RelativeCropRect | null;
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
  accounting?: PowerScribeCropAccounting;
}

type ColumnOcrResults = Record<PowerScribeColumnName, OcrResult>;

interface ReassembledColumnRow {
  line: string;
  rawProcedureColumnText: string;
  rawExamDateColumnText: string;
  rawModifiedDateColumnText: string;
}

const COLUMN_OCR_PARAMS = {
  procedure: {
    pageSegMode: PSM.SINGLE_BLOCK,
    charWhitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 /+&()-.',
    preserveInterwordSpaces: true,
    dictionaryCorrection: false,
    userDefinedDpi: 300,
  },
  examDate: {
    pageSegMode: PSM.SINGLE_BLOCK,
    charWhitelist: '0123456789/: APM',
    preserveInterwordSpaces: true,
    dictionaryCorrection: false,
    userDefinedDpi: 300,
  },
  modifiedDate: {
    pageSegMode: PSM.SINGLE_BLOCK,
    charWhitelist: '0123456789/: APM',
    preserveInterwordSpaces: true,
    dictionaryCorrection: false,
    userDefinedDpi: 300,
  },
} satisfies Record<PowerScribeColumnName, Parameters<ReturnType<typeof getDefaultOcrEngine>['extractText']>[1]>;

export function __testColumnOcrParams() {
  return COLUMN_OCR_PARAMS;
}

export function powerScribeRowGrammarFailure(row: Pick<ParsedLine, 'procedureName' | 'examDateTime' | 'modifiedDateTime'>): string | null {
  const procedure = row.procedureName.trim();
  if (/\d/.test(procedure)) return 'Procedure contains numeric date or row spillover';
  if (!/^(?:CT|CTA|MRI|MR|MRA|XR|US|NM|PET|MAMMO|FL|IR)\b[A-Z /+&()\-.]{2,}$/.test(procedure)) {
    return 'Procedure is not a plausible all-caps RIS title';
  }
  if (!row.examDateTime) return 'Missing or unclear Exam Date';
  if (!row.modifiedDateTime) return 'Missing or unclear Modified date';
  return null;
}

export function classifyPowerScribeStatusText(text: string): 'check' | 'arrow' | 'unknown' {
  if (/[✓✔☑]/u.test(text) || /^CHECK(?:ED)?$/i.test(text.trim())) return 'check';
  if (/[➜➡→]/u.test(text) || /^ARROW$/i.test(text.trim())) return 'arrow';
  return 'unknown';
}

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

function normalizeProcedureColumnText(text: string): string {
  const normalized = normalizeColumnLineText(text);
  const firstDigit = normalized.search(/\d/);
  return (firstDigit >= 0 ? normalized.slice(0, firstDigit) : normalized)
    .replace(/[-–—:;,./|\s]+$/g, '')
    .replace(/\s+[ATF]$/i, '')
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
  const modifiedCentersForPitch = modifiedLines
    .map(lineCenterY)
    .filter((y): y is number => y != null)
    .sort((a, b) => a - b);
  const heightTolerance = Math.max(12, Math.min(36, Math.round((medianHeight ?? 16) * 1.25)));
  const preliminaryModifiedCenters: number[] = [];
  for (const center of modifiedCentersForPitch) {
    const previous = preliminaryModifiedCenters.at(-1);
    if (previous != null && center - previous <= heightTolerance) {
      preliminaryModifiedCenters[preliminaryModifiedCenters.length - 1] = (previous + center) / 2;
    } else {
      preliminaryModifiedCenters.push(center);
    }
  }
  const modifiedPitch = preliminaryModifiedCenters.length >= 3
    ? median(preliminaryModifiedCenters
        .slice(1)
        .map((center, index) => center - preliminaryModifiedCenters[index])
        .filter((pitch) => pitch > 4))
    : null;
  const tolerance = modifiedPitch == null
    ? heightTolerance
    : Math.min(heightTolerance, Math.max(8, Math.floor(modifiedPitch * 0.45)));
  const allCenters = [
    ...procedureLines,
    ...examLines,
    ...modifiedLines,
  ]
    .map(lineCenterY)
    .filter((y): y is number => y != null)
    .sort((a, b) => a - b);
  const modifiedCenters = modifiedLines
    .map(lineCenterY)
    .filter((y): y is number => y != null)
    .sort((a, b) => a - b);
  const anchorCenters = modifiedCenters.length > 0 ? modifiedCenters : allCenters;

  const rowCenters: number[] = [];
  for (const center of anchorCenters) {
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
      const rawProcedureColumnText = normalizeProcedureColumnText(results.procedure.lines[index] ?? 'UNCLEAR POWERSCRIBE ROW');
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
      const rawProcedureColumnText = normalizeProcedureColumnText(procedure?.text ?? 'UNCLEAR POWERSCRIBE ROW');
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
    normalizeProcedureColumnText(results.procedure.lines[index] ?? 'UNCLEAR POWERSCRIBE ROW'),
    results.examDate.lines[index] ?? '',
    results.modifiedDate.lines[index] ?? '',
  ].join(' ').replace(/\s{2,}/g, ' ').trim()).filter(Boolean);
}

function applyColumnDateOverrides(row: ParsedLine, debugRow: ReassembledColumnRow | undefined, fallbackStudyDate: string): ParsedLine {
  if (!debugRow) return row;
  const parsedExam = parseDateTimeFromOcr(debugRow.rawExamDateColumnText);
  const parsedModified = parseDateTimeFromOcr(debugRow.rawModifiedDateColumnText);
  const knownDate = parsedExam?.studyDate ?? parsedModified?.studyDate ?? row.examDate ?? row.modifiedDate ?? fallbackStudyDate;
  const inferredExam = parsedExam?.studyDateTime ? null : parseVisibleTimeWithFallbackDate(debugRow.rawExamDateColumnText, knownDate);
  const inferredModified = parsedModified?.studyDateTime ? null : parseVisibleTimeWithFallbackDate(debugRow.rawModifiedDateColumnText, knownDate);
  const exam = parsedExam?.studyDateTime ? parsedExam : inferredExam;
  const modified = parsedModified?.studyDateTime ? parsedModified : inferredModified;
  const recoveredDate = Boolean(inferredExam || inferredModified);
  const examDateTime = exam?.studyDateTime ?? row.examDateTime;
  const modifiedDateTime = modified?.studyDateTime ?? row.modifiedDateTime;

  return {
    ...row,
    rawProcedureColumnText: debugRow.rawProcedureColumnText,
    rawExamDateColumnText: debugRow.rawExamDateColumnText,
    rawModifiedDateColumnText: debugRow.rawModifiedDateColumnText,
    examDate: exam?.studyDate ?? row.examDate,
    examTime: exam?.studyTime ?? row.examTime,
    examDateTime,
    studyDate: exam?.studyDate ?? row.studyDate,
    studyDateTime: examDateTime,
    modifiedDate: modified?.studyDate ?? row.modifiedDate,
    modifiedTime: modified?.studyTime ?? row.modifiedTime,
    modifiedDateTime,
    dateTimeConfidence: Math.max(row.dateTimeConfidence, exam?.confidence ?? 0, modified?.confidence ?? 0),
    needsReview: row.needsReview || recoveredDate,
    reviewReason: recoveredDate
      ? [row.reviewReason, 'Date token was unclear; paired the visible time with the selected reading date'].filter(Boolean).join(' | ')
      : row.reviewReason,
  };
}

export function __testApplyColumnDateOverrides(
  row: ParsedLine,
  debugRow: ReassembledColumnRow | undefined,
  fallbackStudyDate: string,
): ParsedLine {
  return applyColumnDateOverrides(row, debugRow, fallbackStudyDate);
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
    const provider = getDefaultOcrEngine();
    const passOne = this.options.cropBeforeOcr === false
      ? null
      : await provider.extractText(this.file, { pageSegMode: PSM.AUTO, userDefinedDpi: 300 });
    const detectedStatuses = (passOne?.positionedWords ?? [])
      .map((word) => ({ status: classifyPowerScribeStatusText(word.text), y: word.bbox?.y0 ?? Number.POSITIVE_INFINITY }))
      .filter((item) => item.status !== 'unknown')
      .sort((a, b) => a.y - b.y)
      .map((item) => item.status);
    let preprocessed = null;
    try {
      preprocessed = this.options.cropBeforeOcr === false
        ? null
        : await preprocessPowerScribeColumnsForOcr(this.file, {
            manualCrop: this.options.autoDetectPowerScribeTable === false
              ? this.options.cropRegion ?? DEFAULT_POWERSCRIBE_STUDY_LIST_CROP
              : this.options.cropRegion ?? null,
            savedCrop: this.options.savedCropRegion ?? null,
            headerWords: (passOne?.positionedWords ?? [])
              .filter((word) => word.bbox != null)
              .map((word) => ({ text: word.text, confidence: word.confidence, bbox: word.bbox! })),
          });
    } catch (error) {
      if (!(error instanceof PowerScribeTableNotFoundError)) throw error;
      const now = new Date().toISOString();
      this.debugInfo = {
        crop: null,
        ocrProvider: provider.name,
        ocrText: passOne?.rawText ?? '',
        ocrLines: [],
        rawLineCount: passOne?.lines.length ?? 0,
        cleanedLineCount: 0,
        reconstructedRowCount: 1,
        parsedRowCount: 1,
        rejectedRowCount: 0,
        rejectedRows: [],
        detectedRows: [],
        ocrConfidence: passOne?.confidence ?? 0,
      };
      return [{
        examTitle: "COULDN'T FIND POWERSCRIBE TABLE",
        procedureName: "COULDN'T FIND POWERSCRIBE TABLE",
        canonicalExam: null,
        cpt: null,
        workRvu: null,
        studyDate: this.studyDate,
        examDate: null,
        examTime: null,
        examDateTime: null,
        studyTime: null,
        modifiedDate: null,
        modifiedDateTime: null,
        modifiedTime: null,
        modality: null,
        accessionNumber: null,
        patientMRN: null,
        rowIndex: null,
        powerScribeStatus: 'unknown',
        cleanedExamName: "COULDN'T FIND POWERSCRIBE TABLE",
        cleanedText: "COULDN'T FIND POWERSCRIBE TABLE",
        extractionConfidence: 0,
        parserNeedsReview: true,
        parserReviewReason: error.message,
        parserRawLine: '',
        ocrConfidence: passOne?.confidence ?? 0,
        source: 'ocr',
        importedAt: now,
        dateTimeConfidence: 0,
        dateTimeSource: 'import_default',
      }];
    }
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
        ...applyColumnDateOverrides(row, debugRow, this.studyDate),
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
      ocrProviderName: provider.name,
      ocrConfidence,
      enabled: false,
    });

    this.debugInfo = {
      crop: preprocessed?.tableCrop ?? null,
      threeColumnCrop: preprocessed?.threeColumnCrop ?? null,
      columnCrops: preprocessed?.columns.map((column) => ({ name: column.name, rect: column.rect })),
      ocrProvider: provider.name,
      ocrText,
      ocrLines,
      rawLineCount: parsedWithDebug.debug.rawLineCount,
      cleanedLineCount: parsedWithDebug.debug.cleanedLineCount,
      columnLineCounts: columnResults
        ? {
            procedure: columnResults.procedure.lines.length,
            examDate: columnResults.examDate.lines.length,
            modifiedDate: columnResults.modifiedDate.lines.length,
          }
        : undefined,
      reconstructedRowCount: rowLines.length,
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
      accounting: preprocessed
          ? {
            ...preprocessed.accounting,
            engine: provider.name,
            inputRowCount: rowLines.length,
            outputRowCount: parsed.length + parsedWithDebug.debug.rejectedRows.length,
          }
        : undefined,
    };

    const parsedStudies: ImportedStudy[] = parsed.map((p, index): ImportedStudy => {
      const productivityDate = p.modifiedDate ?? this.studyDate;
      const missingModifiedDate = !p.modifiedDateTime;
      const powerScribeStatus = detectedStatuses[index] ?? 'unknown';
      const unsignedStatus = powerScribeStatus === 'arrow';
      const grammarFailure = powerScribeRowGrammarFailure(p);
      if (grammarFailure) {
        return {
          examTitle: "COULDN'T READ POWERSCRIBE ROW",
          procedureName: "COULDN'T READ POWERSCRIBE ROW",
          canonicalExam: null,
          cpt: null,
          workRvu: null,
          studyDate: this.studyDate,
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
          powerScribeStatus,
          cleanedExamName: "COULDN'T READ POWERSCRIBE ROW",
          cleanedText: "COULDN'T READ POWERSCRIBE ROW",
          extractionConfidence: 0,
          parserNeedsReview: true,
          parserReviewReason: `${grammarFailure}. Review the captured row before counting it.`,
          parserRawLine: p.rawText,
          ocrConfidence,
          source: 'ocr' as const,
          importedAt: now,
          dateTimeConfidence: p.dateTimeConfidence,
          dateTimeSource: 'ocr' as const,
        };
      }

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
        powerScribeStatus,
        cleanedExamName: p.cleanedExamName,
        cleanedText: p.cleanedText,
        extractionConfidence: p.extractionConfidence,
        parserNeedsReview: p.needsReview || missingModifiedDate || unsignedStatus,
        parserReviewReason: unsignedStatus
          ? [p.reviewReason, 'Not signed yet — count it?'].filter(Boolean).join(' | ')
          : missingModifiedDate
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
    const rejectedStudies: ImportedStudy[] = parsedWithDebug.debug.rejectedRows.map((rejected) => ({
      examTitle: "COULDN'T READ POWERSCRIBE ROW",
      procedureName: "COULDN'T READ POWERSCRIBE ROW",
      canonicalExam: null,
      cpt: null,
      workRvu: null,
      studyDate: this.studyDate,
      examDate: null,
      examTime: null,
      examDateTime: null,
      studyTime: null,
      modifiedDate: null,
      modifiedDateTime: null,
      modifiedTime: null,
      modality: null,
      accessionNumber: null,
      patientMRN: null,
      rowIndex: null,
      powerScribeStatus: 'unknown',
      cleanedExamName: "COULDN'T READ POWERSCRIBE ROW",
      cleanedText: "COULDN'T READ POWERSCRIBE ROW",
      extractionConfidence: 0,
      parserNeedsReview: true,
      parserReviewReason: `${rejected.reason}. Review the captured row before counting it.`,
      parserRawLine: rejected.rawText,
      ocrConfidence,
      source: 'ocr',
      importedAt: now,
      dateTimeConfidence: 0,
      dateTimeSource: 'ocr',
    }));
    return [...parsedStudies, ...rejectedStudies];
  }

  getDebugInfo(): OCRImportDebugInfo | null {
    return this.debugInfo;
  }
}
