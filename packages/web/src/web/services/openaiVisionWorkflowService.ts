import { runImportPipeline, type PipelineResult } from '../pipeline/importPipeline';
import { cropImageBlob, type RelativeCropRect } from '../utils/imageCrop';
import { buildVisionDiagnostics, failedVisionDiagnostics, OpenAiVisionExtractorProvider, validateVisionExtractionPayload, type OpenAiVisionDiagnostics } from './openaiVisionImport';

interface WorkflowContext { profileId: string | null; siteId: string | null; sessionId: string | null; logDate: string }
export interface ProcessedVisionResult { result: PipelineResult; extractedCount: number; timelineLabel: string; diagnostics: OpenAiVisionDiagnostics }
export class VisionExecutionError extends Error {
  constructor(message: string, readonly diagnostics: OpenAiVisionDiagnostics) { super(message); this.name = 'VisionExecutionError'; }
}

export async function processOpenAiVisionImport(source: Blob, context: WorkflowContext, cropRect: RelativeCropRect): Promise<ProcessedVisionResult> {
  const started = performance.now();
  let diagnostics = failedVisionDiagnostics(cropRect);
  try {
    const cropped = await cropImageBlob(source, cropRect);
    diagnostics = failedVisionDiagnostics(cropRect, { cropSentToVision: true });
    const imageDataUrl = await blobToDataUrl(cropped);
    diagnostics = failedVisionDiagnostics(cropRect, { cropSentToVision: true, openAiEndpointCalled: true });
    const response = await fetch('/api/extract-powerscribe', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageDataUrl, cropCoordinates: cropRect }),
    });
    const payload = await response.json().catch(() => null);
    diagnostics = failedVisionDiagnostics(cropRect, {
      cropSentToVision: true, openAiEndpointCalled: true, openAiResponseReceived: true,
      extractionDurationSeconds: (performance.now() - started) / 1000,
      ...(payload?.diagnostics ?? {}),
    });
    if (!response.ok) throw new Error(payload?.error || `OpenAI Vision extraction failed (${response.status})`);
    const extraction = validateVisionExtractionPayload({ rows: payload?.rows });
    const provider = new OpenAiVisionExtractorProvider(extraction.rows, context.logDate);
    const studies = await provider.importStudies();
    if (studies.some((row) => row.source !== 'openai_vision')) throw new Error('Vision source assertion failed');
    diagnostics = { ...diagnostics, rowsReturnedDirectlyByVision: extraction.rows.length, rowsEnteringSharedPipeline: studies.length };
    const result = await runImportPipeline(studies, context.logDate, context.profileId);
    diagnostics = buildVisionDiagnostics(diagnostics, result);
    return { result, extractedCount: studies.length, timelineLabel: `OpenAI Vision completed (${studies.length} extracted, OCR used: No)`, diagnostics };
  } catch (error) {
    throw new VisionExecutionError('OpenAI Vision did not run. No OCR fallback was used.', {
      ...diagnostics,
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
