import { runImportPipeline, type PipelineResult } from '../pipeline/importPipeline';
import { recordAuditEvent } from '../utils/audit';
import {
  buildVisionDiagnostics,
  DEFAULT_OPENAI_VISION_MODEL,
  validateVisionExtractionPayload,
  visionRowsToImportedStudies,
  type OpenAiVisionDiagnostics,
} from './openaiVisionImport';

interface WorkflowContext {
  profileId: string | null;
  siteId: string | null;
  sessionId: string | null;
  logDate: string;
}

export interface VisionCropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ProcessVisionOptions {
  model?: string | null;
  cropRect?: VisionCropRect | null;
  debugPreview?: boolean;
  filename?: string;
  size?: number | null;
}

export interface ProcessedVisionResult {
  result: PipelineResult;
  extractedCount: number;
  timelineLabel: string;
  diagnostics: OpenAiVisionDiagnostics;
  cropPreviewUrl: string | null;
}

const DEFAULT_PHI_EXCLUDING_WORKLIST_CROP: VisionCropRect = {
  x: 0.34,
  y: 0.10,
  width: 0.64,
  height: 0.86,
};

export async function processOpenAiVisionImport(
  source: Blob,
  context: WorkflowContext,
  options: ProcessVisionOptions = {},
): Promise<ProcessedVisionResult> {
  const startedAt = performance.now();
  const crop = options.cropRect ?? DEFAULT_PHI_EXCLUDING_WORKLIST_CROP;
  const cropped = await cropImageBlob(source, crop);
  const imageDataUrl = await blobToDataUrl(cropped.blob);
  const model = options.model?.trim() || DEFAULT_OPENAI_VISION_MODEL;

  const response = await fetch('/api/extract-powerscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageDataUrl, model }),
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const message = payload?.error || `OpenAI Vision extraction failed (${response.status})`;
    throw new Error(message);
  }

  const extraction = validateVisionExtractionPayload({ rows: payload?.rows });
  const studies = visionRowsToImportedStudies(extraction.rows, context.logDate);
  const result = await runImportPipeline(studies, context.logDate, context.profileId);
  const serverDuration = Number(payload?.diagnostics?.extractionDurationSeconds);
  const durationSeconds = Number.isFinite(serverDuration)
    ? serverDuration
    : (performance.now() - startedAt) / 1000;
  const diagnostics = buildVisionDiagnostics(
    model,
    extraction.rows.length,
    studies.length,
    durationSeconds,
    result,
  );

  await recordAuditEvent({
    profileId: context.profileId,
    siteId: context.siteId,
    sessionId: context.sessionId,
    logDate: context.logDate,
    action: 'ocr_completed',
    summary: `OpenAI Vision extracted ${diagnostics.rowsExtracted} visible studies`,
    detailsJson: JSON.stringify({
      engine: diagnostics.engine,
      ocrUsed: diagnostics.ocrUsed,
      model: diagnostics.model,
      reviewRows: result.reviewRows.length,
      skippedRows: result.skippedRows.length,
      filename: options.filename ?? null,
      size: options.size ?? null,
    }),
  });

  return {
    result,
    extractedCount: studies.length,
    timelineLabel: `OpenAI Vision completed (${studies.length} extracted, OCR used: No)`,
    diagnostics,
    cropPreviewUrl: options.debugPreview ? URL.createObjectURL(cropped.blob) : null,
  };
}

async function cropImageBlob(source: Blob, rect: VisionCropRect): Promise<{ blob: Blob }> {
  const bitmap = await createImageBitmap(source);
  try {
    const sx = Math.max(0, Math.round(rect.x * bitmap.width));
    const sy = Math.max(0, Math.round(rect.y * bitmap.height));
    const sw = Math.min(bitmap.width - sx, Math.round(rect.width * bitmap.width));
    const sh = Math.min(bitmap.height - sy, Math.round(rect.height * bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is not available for Vision crop');
    context.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((next) => {
        if (next) resolve(next);
        else reject(new Error('Unable to create cropped image for OpenAI Vision'));
      }, 'image/png');
    });
    return { blob };
  } finally {
    bitmap.close();
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Unable to read cropped image'));
    reader.readAsDataURL(blob);
  });
}
