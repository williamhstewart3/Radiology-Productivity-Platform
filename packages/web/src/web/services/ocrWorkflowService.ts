import { CSVImportProvider } from '../providers/CSVImportProvider';
import { OCRImportProvider, type OCRImportDebugInfo } from '../providers/OCRImportProvider';
import { StructuredPowerScribeOcrImportProvider } from '../providers/StructuredPowerScribeOcrImportProvider';
import { runImportPipeline, type PipelineResult, type PipelineReviewRow } from '../pipeline/importPipeline';
import { recordAuditEvent } from '../utils/audit';
import { ensureUserSettings } from '../db/database';
import { db } from '../db/database';
import { buildFingerprint } from '../utils/duplicateDetection';
import type { ImportProvider } from '../types/importProvider';
import type { PowerScribeStructuredOcrRow } from '../types/structuredOcr';
import { getDefaultOcrEngine, type OcrEngine } from '../utils/ocrProvider';
import { PSM } from 'tesseract.js';
import { detectPowerScribeDatetimeLayout, detectPowerScribeHeaderLayout } from '../utils/powerScribeHeaderAnchors';
import type { PowerScribeManualColumnCrops, PowerScribeManualColumnGuides, PowerScribeRowBand, RelativeCropRect } from '../utils/imageCrop';

interface WorkflowContext {
  profileId: string | null;
  siteId: string | null;
  sessionId: string | null;
  logDate: string;
}

export interface ProcessedImportResult {
  result: PipelineResult;
  extractedCount: number;
  timelineLabel: string;
  ocrDebug?: OCRImportDebugInfo | null;
}

export interface PowerScribeCapturePrecheck {
  detected: boolean;
  method: 'headerAnchors' | 'datetimeColumns' | 'none';
  width: number;
  height: number;
  tableRect: RelativeCropRect | null;
  suggestedManualGuides: PowerScribeManualColumnGuides | null;
}

type SavedPowerScribeCrop = NonNullable<Awaited<ReturnType<typeof ensureUserSettings>>['savedPowerScribeCropRegions'][string]>;

export function isSavedPowerScribeCropCompatible(
  crop: SavedPowerScribeCrop | null | undefined,
  imageWidth: number,
  imageHeight: number,
): boolean {
  return Boolean(crop && crop.imageWidth === imageWidth && crop.imageHeight === imageHeight);
}

async function imageDimensions(source: Blob): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(source);
  try {
    return { width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}

function manualGuidesFromDetectedLayout(
  tableRect: RelativeCropRect,
  columns: {
    procedure: RelativeCropRect;
    examDate: RelativeCropRect;
    modifiedDate: RelativeCropRect;
  },
): PowerScribeManualColumnGuides {
  const absoluteX = (relativeX: number) => tableRect.x + tableRect.width * relativeX;
  return {
    left: absoluteX(columns.procedure.x),
    procedureEnd: absoluteX(columns.procedure.x + columns.procedure.width),
    examEnd: absoluteX(columns.examDate.x + columns.examDate.width),
    right: absoluteX(columns.modifiedDate.x + columns.modifiedDate.width),
    top: tableRect.y,
    bottom: tableRect.y + tableRect.height,
  };
}

export async function inspectPowerScribeCapture(
  source: Blob,
  engine: OcrEngine = getDefaultOcrEngine(),
  getDimensions: (source: Blob) => Promise<{ width: number; height: number }> = imageDimensions,
): Promise<PowerScribeCapturePrecheck> {
  const [result, dimensions] = await Promise.all([
    engine.extractText(source, { pageSegMode: PSM.AUTO, userDefinedDpi: 300 }),
    getDimensions(source),
  ]);
  const positionedRegions = result.positionedWords.length > 0
    ? result.positionedWords
    : result.positionedLines;
  const words = positionedRegions
    .filter((word) => word.bbox != null)
    .flatMap((word) => {
      const matches = Array.from(word.text.matchAll(/\S+/g));
      if (matches.length <= 1) return [{ text: word.text, confidence: word.confidence, bbox: word.bbox! }];

      const bbox = word.bbox!;
      const width = Math.max(1, bbox.x1 - bbox.x0);
      const textLength = Math.max(1, word.text.length);
      return matches.map((match) => {
        const start = match.index ?? 0;
        const end = start + match[0].length;
        return {
          text: match[0],
          confidence: word.confidence,
          bbox: {
            x0: bbox.x0 + width * (start / textLength),
            y0: bbox.y0,
            x1: bbox.x0 + width * (end / textLength),
            y1: bbox.y1,
          },
        };
      });
    });
  const headerLayout = detectPowerScribeHeaderLayout(words, dimensions.width, dimensions.height);
  if (headerLayout) {
    return {
      detected: true,
      method: 'headerAnchors',
      width: dimensions.width,
      height: dimensions.height,
      tableRect: headerLayout.tableRect,
      suggestedManualGuides: manualGuidesFromDetectedLayout(headerLayout.tableRect, headerLayout.columns),
    };
  }
  const datetimeLayout = detectPowerScribeDatetimeLayout(words, dimensions.width, dimensions.height);
  if (datetimeLayout) {
    return {
      detected: true,
      method: 'datetimeColumns',
      width: dimensions.width,
      height: dimensions.height,
      tableRect: datetimeLayout.tableRect,
      suggestedManualGuides: manualGuidesFromDetectedLayout(datetimeLayout.tableRect, datetimeLayout.columns),
    };
  }
  return {
    detected: false,
    method: 'none',
    width: dimensions.width,
    height: dimensions.height,
    tableRect: null,
    suggestedManualGuides: null,
  };
}

async function processProvider(
  provider: ImportProvider,
  context: WorkflowContext,
  timelineLabel: (extractedCount: number) => string,
): Promise<ProcessedImportResult> {
  const studies = await provider.importStudies();
  const result = await runImportPipeline(studies, context.logDate, context.profileId);
  return {
    result,
    extractedCount: studies.length,
    timelineLabel: timelineLabel(studies.length),
  };
}

function attachOcrMatchDebug(debugInfo: OCRImportDebugInfo | null, result: PipelineResult): OCRImportDebugInfo | null {
  if (!debugInfo) return null;

  const rowsByRawLine = new Map<string, PipelineReviewRow>();
  for (const row of [...result.reviewRows, ...result.skippedRows]) {
    const rawLine = row.source.parserRawLine;
    if (rawLine && !rowsByRawLine.has(rawLine)) rowsByRawLine.set(rawLine, row);
  }

  return {
    ...debugInfo,
    duplicateSkippedCount: result.skippedRows.length,
    finalReviewRowCount: result.reviewRows.length,
    autoApprovedRowCount: result.reviewRows.filter((row) => row.autoApproved || row.approvalStatus === 'auto_approved').length,
    manuallyApprovedRowCount: result.reviewRows.filter((row) => row.approvalStatus === 'manual_approved' || row.approvalStatus === 'approved_as_new').length,
    possibleDuplicateRowCount: result.reviewRows.filter((row) => row.duplicateStatus === 'possible').length,
    exactDuplicateSkippedCount: result.skippedRows.filter((row) => row.duplicateStatus === 'exact' || row.autoSkipped).length,
    excludedRowCount: result.reviewRows.filter((row) => !row.included).length,
    detectedRows: debugInfo.detectedRows.map((row) => {
      const matched = rowsByRawLine.get(row.rawText);
      if (!matched) return row;

      const selectedIndices = matched.selectedCandidateIndices.length
        ? matched.selectedCandidateIndices
        : matched.selectedCandidateIndex == null
          ? []
          : [matched.selectedCandidateIndex];
      const selected = selectedIndices
        .map((index) => matched.candidates[index])
        .filter(Boolean);
      const top = matched.candidates[0] ?? null;
      const duplicateKey = selected.length > 0
        ? buildFingerprint(
            matched.source.procedureName ?? matched.source.cleanedExamName ?? matched.source.examTitle,
            selected[0].cptCode,
            matched.source.modifiedDate ?? matched.source.modifiedDateTime?.slice(0, 10) ?? matched.source.studyDate,
            matched.source.modifiedDateTime ?? matched.source.studyTime,
            matched.source.accessionNumber,
            selected[0].modality,
            {
              cptCodes: selected.map((candidate) => candidate.cptCode),
              performedDateTime: matched.source.examDateTime ?? null,
              modifiedDateTime: matched.source.modifiedDateTime ?? matched.source.studyTime,
            },
          )
        : null;

      return {
        ...row,
        matchResult: {
          selectedCpts: selected.map((candidate) => `${candidate.cptCode}${candidate.modifier ? `-${candidate.modifier}` : ''}`),
          topCandidate: top ? `${top.cptCode}${top.modifier ? `-${top.modifier}` : ''}` : null,
          confidence: top?.confidence ?? null,
          needsReview: matched.needsReview,
          reviewReason: matched.reviewReason,
          duplicateKey,
        },
      };
    }),
  };
}

export async function processTextImport(
  rawText: string,
  context: WorkflowContext,
): Promise<ProcessedImportResult> {
  const processed = await processProvider(
    new CSVImportProvider(rawText, context.logDate),
    context,
    (count) => `Text import processed (${count} extracted)`,
  );
  await recordAuditEvent({
    profileId: context.profileId,
    siteId: context.siteId,
    sessionId: context.sessionId,
    logDate: context.logDate,
    action: 'ocr_completed',
    summary: `Text/CSV import processed ${processed.extractedCount} extracted studies`,
    detailsJson: JSON.stringify({
      source: 'csv',
      reviewRows: processed.result.reviewRows.length,
      skippedRows: processed.result.skippedRows.length,
    }),
  });
  return processed;
}

export async function processOcrImport(
  source: Blob,
  context: WorkflowContext,
  metadata?: {
    filename?: string;
    size?: number | null;
    cropAlreadyApplied?: boolean;
    manualColumnCrops?: PowerScribeManualColumnCrops | null;
    manualRowBands?: PowerScribeRowBand[] | null;
  },
): Promise<ProcessedImportResult> {
  const settings = await ensureUserSettings();
  const cropKey = context.profileId ?? 'default';
  const savedCrop = settings.savedPowerScribeCropRegions?.[cropKey] ?? null;
  const dimensions = await imageDimensions(source);
  const compatibleSavedCrop = isSavedPowerScribeCropCompatible(savedCrop, dimensions.width, dimensions.height)
    ? savedCrop
    : null;
  if (metadata?.filename) {
    await recordAuditEvent({
      profileId: context.profileId,
      siteId: context.siteId,
      sessionId: context.sessionId,
      logDate: context.logDate,
      action: 'screenshot_imported',
      summary: `Screenshot imported: ${metadata.filename}`,
      detailsJson: JSON.stringify({ filename: metadata.filename, size: metadata.size ?? null }),
    });
  }

  const provider = new OCRImportProvider(source, context.logDate, {
      cropBeforeOcr: !metadata?.cropAlreadyApplied && settings.requireCropBeforeOcr !== false,
      manualColumnCrops: metadata?.manualColumnCrops ?? null,
      manualRowBands: metadata?.manualRowBands ?? null,
      savedCropRegion: compatibleSavedCrop
        ? {
            x: compatibleSavedCrop.x,
            y: compatibleSavedCrop.y,
            width: compatibleSavedCrop.width,
            height: compatibleSavedCrop.height,
          }
        : null,
    });
  const processed = await processProvider(
    provider,
    context,
    (count) => `Screenshot OCR completed (${count} extracted)`,
  );
  const debug = attachOcrMatchDebug(provider.getDebugInfo(), processed.result);
  if (debug?.crop?.method === 'headerAnchors' && debug.accounting) {
    await db.userSettings.put({
      ...settings,
      savedPowerScribeCropRegions: {
        ...settings.savedPowerScribeCropRegions,
        [cropKey]: {
          ...debug.crop.rect,
          imageWidth: debug.accounting.imageWidth,
          imageHeight: debug.accounting.imageHeight,
        },
      },
      updatedAt: new Date().toISOString(),
    });
  }
  await recordAuditEvent({
    profileId: context.profileId,
    siteId: context.siteId,
    sessionId: context.sessionId,
    logDate: context.logDate,
    action: 'ocr_completed',
    summary: `OCR completed ${processed.extractedCount} extracted studies`,
    detailsJson: JSON.stringify({
      reviewRows: processed.result.reviewRows.length,
      skippedRows: processed.result.skippedRows.length,
      accounting: debug?.accounting ?? null,
    }),
  });
  return { ...processed, ocrDebug: debug };
}

export async function processStructuredPowerScribeOcrImport(
  rows: PowerScribeStructuredOcrRow[],
  context: WorkflowContext,
): Promise<ProcessedImportResult> {
  const processed = await processProvider(
    new StructuredPowerScribeOcrImportProvider(rows, context.logDate),
    context,
    (count) => `Windows PowerScribe OCR completed (${count} extracted)`,
  );
  await recordAuditEvent({
    profileId: context.profileId,
    siteId: context.siteId,
    sessionId: context.sessionId,
    logDate: context.logDate,
    action: 'ocr_completed',
    summary: `Windows PowerScribe OCR completed ${processed.extractedCount} extracted studies`,
    detailsJson: JSON.stringify({
      source: 'windows_structured_ocr',
      reviewRows: processed.result.reviewRows.length,
      skippedRows: processed.result.skippedRows.length,
    }),
  });
  return processed;
}
