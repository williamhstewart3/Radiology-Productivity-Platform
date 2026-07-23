import OpenAI from 'openai';
import { z } from 'zod';
import { DEFAULT_OPENAI_VISION_MODEL, visionExtractionSchema } from '../web/services/openaiVisionImport';

const requestSchema = z.object({
  imageDataUrl: z.string().startsWith('data:image/').max(12_000_000),
  cropCoordinates: z.object({
    x: z.number().min(0).max(1), y: z.number().min(0).max(1),
    width: z.number().positive().max(1), height: z.number().positive().max(1),
  }).strict(),
}).strict();

export interface OpenAiServerDiagnostics {
  requestSucceeded: boolean;
  actualModel: string | null;
  responseStatus: number | null;
  outputItems: number;
  outputTextLength: number;
  hasOutputText: boolean;
  hasStructuredPayload: boolean;
  parsedRowsPresent: boolean;
  rowsBeforeValidation: number;
  rowsAfterValidation: number;
  schemaValid: boolean;
  schemaValidationErrors: string[];
  imageMimeType: string | null;
  encodedImageBytes: number;
  dataUrlConstructed: boolean;
  imageAttachedToRequest: boolean;
}

export class OpenAiVisionServerError extends Error {
  constructor(
    readonly code: 'request_failed' | 'no_structured_output' | 'empty_rows' | 'schema_validation_failed' | 'image_payload_rejected',
    message: string,
    readonly diagnostics: OpenAiServerDiagnostics,
    readonly upstream: { status: number | null; code: string | null; type: string | null; requestId: string | null } | null = null,
  ) {
    super(message);
    this.name = 'OpenAiVisionServerError';
  }
}

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
  return {
    ready,
    status: ready ? 'OpenAI Vision ready' : 'OpenAI API key not configured',
    reason: ready ? null : 'OPENAI_API_KEY is missing from this deployment environment',
    environment: process.env.VERCEL_ENV ?? 'unknown',
    model: DEFAULT_OPENAI_VISION_MODEL,
  };
}

export async function extractPowerScribeRowsFromImage(payload: unknown) {
  const started = performance.now();
  const initialDiagnostics: OpenAiServerDiagnostics = {
    requestSucceeded: false, actualModel: null, responseStatus: null, outputItems: 0,
    outputTextLength: 0, hasOutputText: false, hasStructuredPayload: false,
    parsedRowsPresent: false, rowsBeforeValidation: 0, rowsAfterValidation: 0,
    schemaValid: false, schemaValidationErrors: [], imageMimeType: null,
    encodedImageBytes: 0, dataUrlConstructed: false, imageAttachedToRequest: false,
  };
  const requestResult = requestSchema.safeParse(payload);
  if (!requestResult.success) {
    const diagnostics = {
      ...initialDiagnostics,
      schemaValidationErrors: requestResult.error.issues.map((issue) => `${issue.path.join('.') || 'request'}: ${issue.message}`),
    };
    console.error('[openai-vision] image payload rejected', diagnostics);
    throw new OpenAiVisionServerError('image_payload_rejected', 'Image payload rejected before the OpenAI request', diagnostics);
  }
  const request = requestResult.data;
  const imageMatch = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(request.imageDataUrl);
  const imageMimeType = imageMatch?.[1] ?? null;
  const encodedImageBytes = imageMatch ? Buffer.byteLength(imageMatch[2].replace(/\s/g, ''), 'base64') : 0;
  const imageDiagnostics = {
    ...initialDiagnostics, imageMimeType, encodedImageBytes,
    dataUrlConstructed: Boolean(imageMatch), imageAttachedToRequest: Boolean(imageMatch && encodedImageBytes > 0),
  };
  if (!imageDiagnostics.imageAttachedToRequest) {
    console.error('[openai-vision] image payload rejected', imageDiagnostics);
    throw new OpenAiVisionServerError('image_payload_rejected', 'The final crop did not contain a valid non-empty image', imageDiagnostics);
  }
  console.info('[openai-vision] image payload received', {
    modelRequested: DEFAULT_OPENAI_VISION_MODEL, imageMimeType, encodedImageBytes,
    dataUrlConstructed: true, imageAttachedToRequest: true,
  });
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured on the server');
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 45_000, maxRetries: 0 });
  console.info('[openai-vision] OpenAI request started', { modelRequested: DEFAULT_OPENAI_VISION_MODEL });
  let response;
  let responseStatus: number | null = null;
  try {
    const result = await client.responses.create({
    model: DEFAULT_OPENAI_VISION_MODEL,
    store: false,
    input: [{ role: 'user', content: [
      { type: 'input_text', text: 'Extract every visible PowerScribe table row exactly once. Return only row number, Procedure, Exam Date/time, Modified date/time, and confidence. Never assign CPT, RVU, or duplicate status. Keep uncertain rows with null fields and lower confidence; never silently omit them. The image is already the final table crop.' },
      { type: 'input_image', image_url: request.imageDataUrl, detail: 'original' },
    ] }],
    text: { format: { type: 'json_schema', name: 'powerscribe_rows', strict: true, schema } },
    }).withResponse();
    response = result.data;
    responseStatus = result.response.status;
  } catch (error) {
    const diagnostics = { ...imageDiagnostics, responseStatus };
    const message = error instanceof Error ? error.message : 'Unknown OpenAI request error';
    const upstream = sanitizeOpenAiError(error);
    console.error('[openai-vision] OpenAI request failed', {
      ...diagnostics, modelRequested: DEFAULT_OPENAI_VISION_MODEL, error: message, ...upstream,
    });
    throw new OpenAiVisionServerError('request_failed', `OpenAI request failed: ${message}`, diagnostics, upstream);
  }
  const responseDiagnostics = {
    ...imageDiagnostics,
    requestSucceeded: true,
    actualModel: response.model,
    responseStatus,
    outputItems: response.output.length,
    outputTextLength: response.output_text?.length ?? 0,
    hasOutputText: Boolean(response.output_text),
  };
  console.info('[openai-vision] OpenAI request succeeded', {
    modelRequested: DEFAULT_OPENAI_VISION_MODEL, ...responseDiagnostics,
  });
  if (!response.output_text) {
    throw new OpenAiVisionServerError('no_structured_output', 'OpenAI returned no structured output', responseDiagnostics);
  }
  let structuredPayload: unknown;
  try {
    structuredPayload = JSON.parse(response.output_text);
  } catch {
    const diagnostics = {
      ...responseDiagnostics, schemaValidationErrors: ['output_text: response was not valid JSON'],
    };
    throw new OpenAiVisionServerError('schema_validation_failed', 'OpenAI structured output was not valid JSON', diagnostics);
  }
  const rowsBeforeValidation = Array.isArray((structuredPayload as { rows?: unknown })?.rows)
    ? (structuredPayload as { rows: unknown[] }).rows.length
    : 0;
  const validation = visionExtractionSchema.safeParse(structuredPayload);
  if (!validation.success) {
    const diagnostics = {
      ...responseDiagnostics, hasStructuredPayload: true,
      parsedRowsPresent: Array.isArray((structuredPayload as { rows?: unknown })?.rows),
      rowsBeforeValidation,
      schemaValidationErrors: validation.error.issues.map((issue) => `${issue.path.join('.') || 'output'}: ${issue.message}`),
    };
    console.error('[openai-vision] structured output validation failed', diagnostics);
    throw new OpenAiVisionServerError('schema_validation_failed', 'OpenAI structured output failed schema validation', diagnostics);
  }
  const extraction = validation.data;
  const finalDiagnostics = {
    ...responseDiagnostics, hasStructuredPayload: true, parsedRowsPresent: true,
    rowsBeforeValidation, rowsAfterValidation: extraction.rows.length, schemaValid: true,
  };
  if (extraction.rows.length === 0) {
    console.warn('[openai-vision] structured output contained zero rows', finalDiagnostics);
    throw new OpenAiVisionServerError('empty_rows', 'OpenAI returned structured output with 0 rows', finalDiagnostics);
  }
  const validRows = extraction.rows.filter((row) => Boolean(row.procedure && row.modifiedDateTime)).length;
  console.info('[openai-vision] structured rows returned', finalDiagnostics);
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
    server: finalDiagnostics,
  } };
}

function sanitizeOpenAiError(error: unknown) {
  const candidate = error as {
    status?: unknown; code?: unknown; type?: unknown; request_id?: unknown; requestID?: unknown;
  };
  return {
    status: typeof candidate?.status === 'number' ? candidate.status : null,
    code: typeof candidate?.code === 'string' ? candidate.code : null,
    type: typeof candidate?.type === 'string' ? candidate.type : error instanceof Error ? error.name : null,
    requestId: typeof candidate?.request_id === 'string'
      ? candidate.request_id
      : typeof candidate?.requestID === 'string' ? candidate.requestID : null,
  };
}
