import { runImportPipeline, type PipelineResult } from '../pipeline/importPipeline';
import { cropImageBlob, type RelativeCropRect } from '../utils/imageCrop';
import { buildVisionDiagnostics, OpenAiVisionExtractorProvider, validateVisionExtractionPayload, type OpenAiVisionDiagnostics } from './openaiVisionImport';

interface WorkflowContext { profileId: string | null; siteId: string | null; sessionId: string | null; logDate: string }
export interface ProcessedVisionResult { result: PipelineResult; extractedCount: number; timelineLabel: string; diagnostics: OpenAiVisionDiagnostics }

export async function processOpenAiVisionImport(source: Blob, context: WorkflowContext, cropRect: RelativeCropRect): Promise<ProcessedVisionResult> {
  const cropped = await cropImageBlob(source, cropRect);
  const imageDataUrl = await blobToDataUrl(cropped);
  const response = await fetch('/api/extract-powerscribe', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageDataUrl, cropCoordinates: cropRect }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error || `OpenAI Vision extraction failed (${response.status})`);
  const extraction = validateVisionExtractionPayload({ rows: payload?.rows });
  const provider = new OpenAiVisionExtractorProvider(extraction.rows, context.logDate);
  const studies = await provider.importStudies();
  const result = await runImportPipeline(studies, context.logDate, context.profileId);
  const diagnostics = buildVisionDiagnostics(payload.diagnostics, result);
  return { result, extractedCount: studies.length, timelineLabel: `OpenAI Vision completed (${studies.length} extracted, OCR used: No)`, diagnostics };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Unable to read the final PowerScribe crop'));
    reader.readAsDataURL(blob);
  });
}
