import { CSVImportProvider } from '../providers/CSVImportProvider';
import { OCRImportProvider } from '../providers/OCRImportProvider';
import { runImportPipeline, type PipelineResult } from '../pipeline/importPipeline';
import { recordAuditEvent } from '../utils/audit';
import { ensureUserSettings } from '../db/database';
import type { ImportProvider } from '../types/importProvider';

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
  metadata?: { filename?: string; size?: number | null; cropAlreadyApplied?: boolean },
): Promise<ProcessedImportResult> {
  const settings = await ensureUserSettings();
  const savedCrop = settings.savedPowerScribeCropRegions?.default ?? null;
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

  const processed = await processProvider(
    new OCRImportProvider(source, context.logDate, {
      cropBeforeOcr: !metadata?.cropAlreadyApplied && settings.requireCropBeforeOcr !== false,
      cropRegion: savedCrop
        ? {
            x: savedCrop.x,
            y: savedCrop.y,
            width: savedCrop.width,
            height: savedCrop.height,
          }
        : null,
    }),
    context,
    (count) => `Screenshot OCR completed (${count} extracted)`,
  );
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
    }),
  });
  return processed;
}
