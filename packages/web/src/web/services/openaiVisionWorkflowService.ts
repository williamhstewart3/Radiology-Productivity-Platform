import { runImportPipeline, type PipelineResult } from '../pipeline/importPipeline';
import { cropImageBlob, type RelativeCropRect } from '../utils/imageCrop';
import { buildVisionDiagnostics, failedVisionDiagnostics, OpenAiVisionExtractorProvider, validateVisionExtractionPayload, type OpenAiVisionDiagnostics } from './openaiVisionImport';

interface WorkflowContext { profileId: string | null; siteId: string | null; sessionId: string | null; logDate: string }
export interface ProcessedVisionResult { result: PipelineResult; extractedCount: number; timelineLabel: string; diagnostics: OpenAiVisionDiagnostics }
export class VisionExecutionError extends Error {
  constructor(message: string, readonly diagnostics: OpenAiVisionDiagnostics) { super(message); this.name = 'VisionExecutionError'; }
}

interface FinalCropDebug {
  imageDataUrl: string;
  originalWidth: number;
  originalHeight: number;
  croppedWidth: number;
  croppedHeight: number;
  mimeType: string;
  encodedBytes: number;
}

export async function processOpenAiVisionImport(
  source: Blob,
  context: WorkflowContext,
  cropRect: RelativeCropRect,
  onFinalCrop?: (crop: FinalCropDebug) => void,
): Promise<ProcessedVisionResult> {
  const started = performance.now();
  let diagnostics = failedVisionDiagnostics(cropRect);
  try {
    const originalDimensions = await blobDimensions(source);
    const cropped = await cropImageBlob(source, cropRect);
    const croppedDimensions = await blobDimensions(cropped);
    diagnostics = failedVisionDiagnostics(cropRect, {
      cropSentToVision: true,
      originalImageWidth: originalDimensions.width, originalImageHeight: originalDimensions.height,
      croppedImageWidth: croppedDimensions.width, croppedImageHeight: croppedDimensions.height,
      finalImageWidth: croppedDimensions.width, finalImageHeight: croppedDimensions.height,
      imageMimeType: cropped.type || 'image/png', encodedImageBytes: cropped.size,
    });
    const imageDataUrl = await blobToDataUrl(cropped);
    onFinalCrop?.({
      imageDataUrl, originalWidth: originalDimensions.width, originalHeight: originalDimensions.height,
      croppedWidth: croppedDimensions.width, croppedHeight: croppedDimensions.height,
      mimeType: cropped.type || 'image/png', encodedBytes: cropped.size,
    });
    diagnostics = failedVisionDiagnostics(cropRect, { ...diagnostics, cropSentToVision: true, openAiEndpointCalled: true });
    const response = await fetch('/api/extract-powerscribe', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageDataUrl, cropCoordinates: cropRect }),
    });
    const payload = await response.json().catch(() => null);
    diagnostics = failedVisionDiagnostics(cropRect, {
      ...diagnostics, cropSentToVision: true, openAiEndpointCalled: true,
      openAiResponseReceived: Boolean(payload?.serverDiagnostics?.requestSucceeded ?? payload?.diagnostics?.server?.requestSucceeded),
      extractionDurationSeconds: (performance.now() - started) / 1000,
      ...(payload?.diagnostics ?? {}),
      server: payload?.serverDiagnostics ?? payload?.diagnostics?.server ?? null,
      failureCode: payload?.errorCode ?? null,
      failureMessage: payload?.error ? formatPayloadError(payload.error) : null,
    });
    if (!response.ok) throw new Error(payload?.error ? formatPayloadError(payload.error) : `OpenAI Vision extraction failed (${response.status})`);
    const extraction = validateVisionExtractionPayload({ rows: payload?.rows });
    const provider = new OpenAiVisionExtractorProvider(extraction.rows, context.logDate);
    const studies = await provider.importStudies();
    if (studies.some((row) => row.source !== 'openai_vision')) throw new Error('Vision source assertion failed');
    diagnostics = { ...diagnostics, rowsReturnedDirectlyByVision: extraction.rows.length, rowsEnteringSharedPipeline: studies.length };
    const result = await runImportPipeline(studies, context.logDate, context.profileId);
    diagnostics = buildVisionDiagnostics(diagnostics, result);
    return { result, extractedCount: studies.length, timelineLabel: `OpenAI Vision completed (${studies.length} extracted, OCR used: No)`, diagnostics };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'OpenAI Vision failed for an unknown reason';
    throw new VisionExecutionError(message, {
      ...diagnostics,
      failureMessage: diagnostics.failureMessage ?? message,
      extractionDurationSeconds: diagnostics.extractionDurationSeconds || (performance.now() - started) / 1000,
    });
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Unable to read the final PowerScribe crop'));
    reader.readAsDataURL(blob);
  });
}

async function blobDimensions(blob: Blob): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(blob);
  const dimensions = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return dimensions;
}

function formatPayloadError(value: unknown): string {
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}
