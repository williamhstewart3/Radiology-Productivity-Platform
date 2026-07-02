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

import { parseOcrLines } from '../utils/powerScribeParser';
import { getDefaultOcrProvider } from '../utils/ocrProvider';
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
  };
}

export interface OCRImportDebugInfo {
  crop: DetectedCrop | null;
  ocrText: string;
  ocrLines: string[];
  columnText?: Record<PowerScribeColumnName, string>;
  detectedRows: OCRImportDebugRow[];
  ocrConfidence: number;
}

type ColumnOcrResults = Record<PowerScribeColumnName, OcrResult>;

function lineCenterY(line: OcrPositionedLine): number | null {
  if (!line.bbox) return null;
  return (line.bbox.y0 + line.bbox.y1) / 2;
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

function reassembleColumnRows(results: ColumnOcrResults): string[] {
  const procedureLines = results.procedure.positionedLines;
  const examLines = results.examDate.positionedLines;
  const modifiedLines = results.modifiedDate.positionedLines;
  const allCenters = [
    ...procedureLines,
    ...examLines,
    ...modifiedLines,
  ]
    .map(lineCenterY)
    .filter((y): y is number => y != null)
    .sort((a, b) => a - b);

  const rowCenters: number[] = [];
  const tolerance = 22;
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
    return Array.from({ length: maxLength }, (_, index) => [
      results.procedure.lines[index] ?? 'UNCLEAR POWERSCRIBE ROW',
      results.examDate.lines[index] ?? '',
      results.modifiedDate.lines[index] ?? '',
    ].join(' ').trim());
  }

  return rowCenters
    .sort((a, b) => a - b)
    .map((center) => {
      const procedure = nearestLine(procedureLines, center, tolerance);
      const examDate = nearestLine(examLines, center, tolerance);
      const modifiedDate = nearestLine(modifiedLines, center, tolerance);
      return [
        normalizeColumnLineText(procedure?.text ?? 'UNCLEAR POWERSCRIBE ROW'),
        normalizeColumnLineText(examDate?.text ?? ''),
        normalizeColumnLineText(modifiedDate?.text ?? ''),
      ].join(' ').replace(/\s{2,}/g, ' ').trim();
    })
    .filter((line) => line.length > 0);
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
      ? Object.fromEntries(
          await Promise.all(preprocessed.columns.map(async (column) => [column.name, await provider.extractText(column.blob)])),
        ) as ColumnOcrResults
      : null;
    const rowLines = columnResults ? reassembleColumnRows(columnResults) : result?.lines ?? [];
    const parsed = parseOcrLines(rowLines);
    const now = new Date().toISOString();
    const ocrConfidence = columnResults
      ? (columnResults.procedure.confidence + columnResults.examDate.confidence + columnResults.modifiedDate.confidence) / 3
      : result?.confidence ?? 0;
    const ocrText = columnResults
      ? rowLines.join('\n')
      : result?.rawText ?? '';
    const ocrLines = rowLines;

    this.debugInfo = {
      crop: preprocessed?.tableCrop ?? null,
      ocrText,
      ocrLines,
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
      const productivityDate = p.modifiedDate ?? p.studyDate ?? this.studyDate;

      return {
        examTitle: p.examName,
        canonicalExam: null,
        cpt: null,
        workRvu: null,
        studyDate: p.studyDate ?? productivityDate,
        studyTime: p.modifiedDateTime ?? p.studyDateTime,
        modifiedDate: p.modifiedDate ?? productivityDate,
        modifiedDateTime: p.modifiedDateTime ?? p.studyDateTime,
        modality: null,
        accessionNumber: p.accessionNumber,
        patientMRN: null,
        rowIndex: p.rowIndex,
        cleanedExamName: p.cleanedExamName,
        extractionConfidence: p.extractionConfidence,
        parserNeedsReview: p.needsReview,
        parserReviewReason: p.reviewReason,
        parserRawLine: p.rawText,
        ocrConfidence,
        source: 'ocr' as const,
        importedAt: now,
        dateTimeConfidence: p.dateTimeConfidence,
        dateTimeSource: p.dateTimeConfidence > 0 ? 'ocr' : 'import_default',
      };
    });
  }

  getDebugInfo(): OCRImportDebugInfo | null {
    return this.debugInfo;
  }
}
