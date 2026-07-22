import OpenAI from 'openai';
import { z } from 'zod';
import { DEFAULT_OPENAI_VISION_MODEL, validateVisionExtractionPayload } from '../web/services/openaiVisionImport';

const requestSchema = z.object({
  imageDataUrl: z.string().startsWith('data:image/').max(12_000_000),
  cropCoordinates: z.object({
    x: z.number().min(0).max(1), y: z.number().min(0).max(1),
    width: z.number().positive().max(1), height: z.number().positive().max(1),
  }).strict(),
}).strict();

const schema = {
  type: 'object', additionalProperties: false, required: ['rows'],
  properties: { rows: { type: 'array', items: {
    type: 'object', additionalProperties: false,
    required: ['rowNumber', 'procedure', 'examDateTime', 'modifiedDateTime', 'confidence'],
    properties: {
      rowNumber: { type: ['integer', 'null'], minimum: 1 },
      procedure: { type: ['string', 'null'], minLength: 1 },
      examDateTime: { type: ['string', 'null'], minLength: 1 },
      modifiedDateTime: { type: ['string', 'null'], minLength: 1 },
      confidence: { type: ['number', 'null'], minimum: 0, maximum: 1 },
    },
  } } },
} as const;

export function openAiVisionHealth() {
  const ready = Boolean(process.env.OPENAI_API_KEY);
  return { ready, status: ready ? 'OpenAI Vision ready' : 'OPENAI_API_KEY is not configured', model: DEFAULT_OPENAI_VISION_MODEL };
}

export async function extractPowerScribeRowsFromImage(payload: unknown) {
  const started = performance.now();
  const request = requestSchema.parse(payload);
  console.info('[openai-vision] image payload received', { modelRequested: DEFAULT_OPENAI_VISION_MODEL, hasImagePayload: true });
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured on the server');
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  console.info('[openai-vision] OpenAI request started', { modelRequested: DEFAULT_OPENAI_VISION_MODEL });
  let response;
  try {
    response = await client.responses.create({
    model: DEFAULT_OPENAI_VISION_MODEL,
    store: false,
    input: [{ role: 'user', content: [
      { type: 'input_text', text: 'Extract every visible PowerScribe table row exactly once. Return only row number, Procedure, Exam Date/time, Modified date/time, and confidence. Never assign CPT, RVU, or duplicate status. Keep uncertain rows with null fields and lower confidence; never silently omit them. The image is already the final table crop.' },
      { type: 'input_image', image_url: request.imageDataUrl, detail: 'original' },
    ] }],
    text: { format: { type: 'json_schema', name: 'powerscribe_rows', strict: true, schema } },
    });
  } catch (error) {
    console.error('[openai-vision] OpenAI request failed', { modelRequested: DEFAULT_OPENAI_VISION_MODEL, error: error instanceof Error ? error.message : 'unknown error' });
    throw error;
  }
  console.info('[openai-vision] OpenAI request succeeded', { modelRequested: DEFAULT_OPENAI_VISION_MODEL, modelReturned: response.model });
  if (!response.output_text) throw new Error('OpenAI Vision returned no structured output');
  const extraction = validateVisionExtractionPayload(JSON.parse(response.output_text));
  const validRows = extraction.rows.filter((row) => Boolean(row.procedure && row.modifiedDateTime)).length;
  console.info('[openai-vision] structured rows returned', { rowCount: extraction.rows.length });
  return { rows: extraction.rows, diagnostics: {
    buildCommit: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? 'local',
    selectedEngine: 'openai_vision' as const, actualEngine: 'openai_vision' as const, ocrUsed: 'No' as const,
    model: DEFAULT_OPENAI_VISION_MODEL, cropCoordinates: request.cropCoordinates,
    extractedRows: extraction.rows.length, validRows,
    extractionDurationSeconds: (performance.now() - started) / 1000,
    extractorProviderClass: 'OpenAiVisionExtractorProvider' as const,
    openAiEndpointCalled: true, openAiResponseReceived: true,
    ocrProviderCalled: false as const, tesseractCalled: false as const, ocrReconstructionCalled: false as const,
    modelRequested: DEFAULT_OPENAI_VISION_MODEL, modelReturned: response.model,
    cropSentToVision: true, rowsReturnedDirectlyByVision: extraction.rows.length,
    rowsEnteringSharedPipeline: extraction.rows.length, fallbackUsed: false as const, fallbackReason: null,
  } };
}
