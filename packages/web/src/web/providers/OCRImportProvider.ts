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
import { normalizeOcrExamTextForMatching } from '../utils/ocrExamTextNormalization';
import { findOrbitCmeSeedMapping } from '../data/orbitCmeSeedMappings';
import {
  DEFAULT_POWERSCRIBE_STUDY_LIST_CROP,
  preprocessPowerScribeColumnsForOcr,
  PowerScribeTableNotFoundError,
  type DetectedCrop,
  type PowerScribeCropAccounting,
  type PowerScribeColumnName,
  type PowerScribeManualColumnCrops,
  type PowerScribeRowBand,
  type PowerScribeRowSlot,
  type RelativeCropRect,
} from '../utils/imageCrop';
import type { ImportProvider, ImportedStudy } from '../types/importProvider';
import type { ParsedLine } from '../utils/powerScribeParser';
import type { OcrPositionedLine, OcrPositionedWord, OcrResult } from '../utils/ocrProvider';

export interface OCRImportOptions {
  cropBeforeOcr?: boolean;
  cropRegion?: RelativeCropRect | null;
  manualColumnCrops?: PowerScribeManualColumnCrops | null;
  manualRowBands?: PowerScribeRowBand[] | null;
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
  rowBands?: PowerScribeRowBand[];
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

const RADIOLOGY_PROCEDURE_SIGNAL = /\b(?:CT|CTA|MRI|MR|MRA|XR|X RAY|US|ULTRASOUND|SONOGRAM|NM|PET|MAMMO|FLUORO|IR|OB|ABDOMEN|PELVIS|CHEST|HEAD|NECK|BRAIN|SPINE|CERVICAL|THORACIC|LUMBAR|SACRUM|COCCYX|SHOULDER|CLAVICLE|SCAPULA|HUMERUS|ELBOW|FOREARM|WRIST|HAND|FINGER|HIP|FEMUR|KNEE|TIBIA|FIBULA|ANKLE|FOOT|TOE|CALCANEUS|HEEL|RENAL|KIDNEY|THYROID|BREAST|SCROTUM|TRANSVAGINAL|TRANSRECTAL|CAROTID|ARTERIAL|VENOUS|DUPLEX|DOPPLER|AORTA|IVC|ILIAC|DIALYSIS|FETAL|BIOPHYSICAL|MAMMOGRAM|BONE|SPECT|VQ|HIDA|GASTRIC|ESOPHAGRAM|BARIUM)\b/;

export function powerScribeRowGrammarFailure(row: Pick<ParsedLine, 'procedureName' | 'examDateTime' | 'modifiedDateTime'>): string | null {
  const procedure = row.procedureName.trim();
  if (/\d/.test(procedure)) return 'Procedure contains numeric date or row spillover';
  if (!/^[A-Z][A-Z /+&()\-.]{2,}$/.test(procedure) || !RADIOLOGY_PROCEDURE_SIGNAL.test(procedure)) {
    return 'Procedure is not a plausible all-caps RIS title';
  }
  if (!row.examDateTime) return 'Missing or unclear Exam Date';
  if (!row.modifiedDateTime) return 'Missing or unclear Modified date';
  return null;
}

function isProcedureGrammarFailure(failure: string | null): boolean {
  return failure?.startsWith('Procedure ') ?? false;
}

export function recoverPowerScribeProcedureName(
  row: Pick<ParsedLine, 'procedureName' | 'rawProcedureColumnText'>,
): string {
  for (const candidate of [row.rawProcedureColumnText, row.procedureName]) {
    if (!candidate?.trim()) continue;
    const firstDigit = candidate.search(/\d/);
    const withoutDateSpill = (firstDigit >= 0 ? candidate.slice(0, firstDigit) : candidate).trim();
    const normalized = normalizeOcrExamTextForMatching(withoutDateSpill);
    const orbitMapping = findOrbitCmeSeedMapping(normalized);
    if (orbitMapping) return normalizeOcrExamTextForMatching(orbitMapping.studyName).toUpperCase();
    if (/^[A-Z][A-Z /+&()\-.]{2,}$/.test(normalized) && RADIOLOGY_PROCEDURE_SIGNAL.test(normalized)) {
      return normalized;
    }
  }
  return row.procedureName.trim();
}

function isAuthoritativeOrbitRecovery(row: Pick<ParsedLine, 'procedureName' | 'rawProcedureColumnText'>): boolean {
  return [row.rawProcedureColumnText, row.procedureName].some((candidate) => {
    if (!candidate?.trim()) return false;
    const firstDigit = candidate.search(/\d/);
    const withoutDateSpill = (firstDigit >= 0 ? candidate.slice(0, firstDigit) : candidate).trim();
    return Boolean(findOrbitCmeSeedMapping(normalizeOcrExamTextForMatching(withoutDateSpill)));
  });
}

export function __testShouldUseUnreadablePowerScribeFallback(row: ParsedLine): boolean {
  const procedureName = recoverPowerScribeProcedureName(row);
  return isProcedureGrammarFailure(powerScribeRowGrammarFailure({ ...row, procedureName }));
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

function visibleRowNumber(text: string): number | null {
  const match = text.trim().match(/^[#|]?\s*(\d{1,4})[.:)]?$/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * Associates the narrow number gutter from the full-image precheck with the
 * geometric row bands. A sequence check is required before any number is
 * trusted, which keeps dates and unrelated UI numbers out of row identity.
 */
export function detectPowerScribeVisibleRowNumbers(
  words: OcrPositionedWord[],
  rowBands: PowerScribeRowBand[],
  procedureRect: RelativeCropRect,
  imageWidth: number,
  imageHeight: number,
): Array<string | null> {
  if (rowBands.length < 2 || imageWidth <= 0 || imageHeight <= 0) {
    return rowBands.map(() => null);
  }

  const gutterLeft = Math.max(0, procedureRect.x - Math.max(0.035, procedureRect.width * 0.08));
  const gutterRight = Math.min(1, procedureRect.x + Math.min(0.055, procedureRect.width * 0.16));
  const candidates = rowBands.map((band) => {
    const inBand = words
      .map((word) => {
        const value = visibleRowNumber(word.text);
        if (value == null || !word.bbox || word.confidence < 0.3) return null;
        const centerX = (word.bbox.x0 + word.bbox.x1) / 2 / imageWidth;
        const centerY = (word.bbox.y0 + word.bbox.y1) / 2 / imageHeight;
        const width = (word.bbox.x1 - word.bbox.x0) / imageWidth;
        if (centerX < gutterLeft || centerX > gutterRight || width > 0.04) return null;
        if (centerY < band.top || centerY > band.bottom) return null;
        return { value, distance: Math.abs(centerX - procedureRect.x) };
      })
      .filter((candidate): candidate is { value: number; distance: number } => candidate != null)
      .sort((a, b) => a.distance - b.distance);
    return inBand[0]?.value ?? null;
  });

  const visible = candidates
    .map((value, index) => value == null ? null : { value, index })
    .filter((candidate): candidate is { value: number; index: number } => candidate != null);
  if (visible.length < 2) return rowBands.map(() => null);

  const modelCounts = new Map<string, number>();
  for (const candidate of visible) {
    const ascending = `asc:${candidate.value - candidate.index}`;
    const descending = `desc:${candidate.value + candidate.index}`;
    modelCounts.set(ascending, (modelCounts.get(ascending) ?? 0) + 1);
    modelCounts.set(descending, (modelCounts.get(descending) ?? 0) + 1);
  }
  const best = [...modelCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  if (!best || best[1] < 2 || best[1] / visible.length < 0.75) return rowBands.map(() => null);

  const [direction, rawConstant] = best[0].split(':');
  const constant = Number(rawConstant);
  return rowBands.map((_, index) => {
    const value = direction === 'asc' ? constant + index : constant - index;
    return value > 0 && value <= 9999 ? String(value) : null;
  });
}

export function __testDetectPowerScribeVisibleRowNumbers(
  words: OcrPositionedWord[],
  rowBands: PowerScribeRowBand[],
  procedureRect: RelativeCropRect,
  imageWidth: number,
  imageHeight: number,
): Array<string | null> {
  return detectPowerScribeVisibleRowNumbers(words, rowBands, procedureRect, imageWidth, imageHeight);
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
  const examFallbackDate = parsedExam?.studyDate ?? row.examDate ?? fallbackStudyDate;
  const inferredExam = parsedExam?.studyDateTime ? null : parseVisibleTimeWithFallbackDate(debugRow.rawExamDateColumnText, examFallbackDate);
  const reliableParsedModified = parsedModified && parsedModified.confidence >= 0.8 ? parsedModified : null;
  const inferredModified = reliableParsedModified?.studyDateTime
    ? null
    : parseVisibleTimeWithFallbackDate(debugRow.rawModifiedDateColumnText, fallbackStudyDate);
  const exam = parsedExam?.studyDateTime ? parsedExam : inferredExam;
  const modified = reliableParsedModified?.studyDateTime ? reliableParsedModified : inferredModified;
  const recoveredDate = Boolean(inferredExam || inferredModified);
  const examDateTime = exam?.studyDateTime ?? row.examDateTime;
  const hasDistinctCombinedModified = Boolean(
    row.modifiedDateTime &&
    row.modifiedDateTime !== row.examDateTime,
  );
  const modifiedDateTime = modified?.studyDateTime ?? (hasDistinctCombinedModified ? row.modifiedDateTime : null);
  const modifiedDate = modified?.studyDate ??
    reliableParsedModified?.studyDate ??
    (hasDistinctCombinedModified ? row.modifiedDate : null) ??
    fallbackStudyDate;
  const assumedModifiedDate = !reliableParsedModified?.studyDate && !hasDistinctCombinedModified;

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
    modifiedDate,
    modifiedTime: modified?.studyTime ?? (hasDistinctCombinedModified ? row.modifiedTime : null),
    modifiedDateTime,
    dateTimeConfidence: Math.max(row.dateTimeConfidence, exam?.confidence ?? 0, modified?.confidence ?? 0),
    needsReview: row.needsReview || recoveredDate || assumedModifiedDate,
    reviewReason: recoveredDate || assumedModifiedDate
      ? [
          row.reviewReason,
          recoveredDate ? 'Date token was unclear; paired the visible time with the selected reading date' : null,
          assumedModifiedDate ? 'Modified date was unreadable; used the selected upload date' : null,
        ].filter(Boolean).join(' | ')
      : row.reviewReason,
  };
}

function textInRowSlot(result: OcrResult, slot: PowerScribeRowSlot): string {
  const positioned = result.positionedLines
    .filter((line) => {
      const center = lineCenterY(line);
      return center != null && center >= slot.compositeTop && center <= slot.compositeBottom;
    })
    .sort((a, b) => {
      const yDifference = (a.bbox?.y0 ?? 0) - (b.bbox?.y0 ?? 0);
      if (Math.abs(yDifference) > 3) return yDifference;
      return (a.bbox?.x0 ?? 0) - (b.bbox?.x0 ?? 0);
    })
    .map((line) => normalizeColumnLineText(line.text))
    .filter(Boolean);
  if (positioned.length > 0) return positioned.join(' ').replace(/\s{2,}/g, ' ').trim();
  return result.positionedLines.length === 0
    ? normalizeColumnLineText(result.lines[slot.index] ?? '')
    : '';
}

function reassembleColumnRowsBySlots(
  results: ColumnOcrResults,
  slots: PowerScribeRowSlot[],
  visibleRowNumbers: Array<string | null> = [],
): ReassembledColumnRow[] {
  return slots.map((slot) => {
    const rawProcedureColumnText = textInRowSlot(results.procedure, slot);
    const rawExamDateColumnText = textInRowSlot(results.examDate, slot);
    const rawModifiedDateColumnText = textInRowSlot(results.modifiedDate, slot);
    const combined = [rawProcedureColumnText, rawExamDateColumnText, rawModifiedDateColumnText].filter(Boolean).join(' ').trim();
    const line = combined || 'UNCLEAR POWERSCRIBE ROW';
    const visibleRowNumber = visibleRowNumbers[slot.index] ?? null;
    return {
      line: visibleRowNumber ? `${visibleRowNumber} ${line}` : line,
      rawProcedureColumnText,
      rawExamDateColumnText,
      rawModifiedDateColumnText,
    };
  });
}

export function __testReassembleColumnRowsBySlots(
  results: ColumnOcrResults,
  slots: PowerScribeRowSlot[],
  visibleRowNumbers: Array<string | null> = [],
): ReassembledColumnRow[] {
  return reassembleColumnRowsBySlots(results, slots, visibleRowNumbers);
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
            manualColumns: this.options.manualColumnCrops ?? null,
            manualRows: this.options.manualRowBands ?? null,
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
    const procedureRect = preprocessed?.columns.find((column) => column.name === 'procedure')?.rect ?? null;
    const visibleRowNumbers = preprocessed && procedureRect
      ? detectPowerScribeVisibleRowNumbers(
          passOne?.positionedWords ?? [],
          preprocessed.rowBands,
          procedureRect,
          preprocessed.accounting.imageWidth,
          preprocessed.accounting.imageHeight,
        )
      : [];
    let columnDebugRows = columnResults
      ? preprocessed?.rowSlots.length
        ? reassembleColumnRowsBySlots(columnResults, preprocessed.rowSlots, visibleRowNumbers)
        : reassembleColumnRowsWithDebug(columnResults)
      : [];
    let rowLines = columnResults ? columnDebugRows.map((row) => row.line) : result?.lines ?? [];
    let parsedWithDebug = parseOcrLinesWithDebug(rowLines);
    if (columnResults && !preprocessed?.rowSlots.length && parsedWithDebug.rows.length === 0) {
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
      rowBands: preprocessed?.rowBands ?? [],
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
      const procedureName = recoverPowerScribeProcedureName(p);
      const recoveredProcedure = procedureName !== p.procedureName;
      const recoveryNeedsReview = recoveredProcedure && !isAuthoritativeOrbitRecovery(p);
      const productivityDate = p.modifiedDate ?? this.studyDate;
      const missingModifiedTime = !p.modifiedDateTime;
      const powerScribeStatus = detectedStatuses[index] ?? 'unknown';
      const unsignedStatus = powerScribeStatus === 'arrow';
      const grammarFailure = powerScribeRowGrammarFailure({ ...p, procedureName });
      if (isProcedureGrammarFailure(grammarFailure)) {
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
        examTitle: procedureName,
        procedureName,
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
        cleanedExamName: procedureName,
        cleanedText: procedureName,
        extractionConfidence: p.extractionConfidence,
        parserNeedsReview: p.needsReview || Boolean(grammarFailure) || recoveryNeedsReview || unsignedStatus,
        parserReviewReason: unsignedStatus
          ? [p.reviewReason, grammarFailure, recoveryNeedsReview ? 'Procedure title recovered before numeric date spillover' : null, 'Not signed yet — count it?'].filter(Boolean).join(' | ')
          : missingModifiedTime
          ? [p.reviewReason, grammarFailure, recoveryNeedsReview ? 'Procedure title recovered before numeric date spillover' : null, 'Modified date uses the selected upload date; Modified time was not readable.'].filter(Boolean).join(' | ')
          : [p.reviewReason, grammarFailure, recoveryNeedsReview ? 'Procedure title recovered before numeric date spillover' : null].filter(Boolean).join(' | ') || null,
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
