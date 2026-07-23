import { extractPowerScribeRowsFromImage, OpenAiVisionServerError } from '../src/api/openaiVisionExtraction';

export const maxDuration = 60;

type VercelRequest = { method?: string; body?: unknown; headers?: Record<string, string | string[] | undefined> };
type VercelResponse = {
  status: (statusCode: number) => VercelResponse;
  json: (body: unknown) => void;
};

export default async function handler(request: VercelRequest, response: VercelResponse): Promise<void> {
  if (request.method !== 'POST') {
    response.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const serializedBody = typeof request.body === 'string' ? request.body : JSON.stringify(request.body ?? null);
  let parsedBody: unknown = request.body;
  if (typeof request.body === 'string') {
    try { parsedBody = JSON.parse(request.body); } catch { parsedBody = request.body; }
  }
  const transportDiagnostics = {
    requestReceived: true,
    incomingContentType: headerValue(request.headers?.['content-type']) ?? 'unknown',
    incomingBodyBytes: Buffer.byteLength(serializedBody),
    imageFieldPresent: Boolean(
      parsedBody && typeof parsedBody === 'object' && 'imageDataUrl' in parsedBody,
    ),
  };
  console.info('[openai-vision] /api/extract-powerscribe request received');
  console.info('[openai-vision] request transport', transportDiagnostics);
  try {
    const result = await extractPowerScribeRowsFromImage(parsedBody);
    response.status(200).json({
      ...result,
      diagnostics: { ...result.diagnostics, transport: transportDiagnostics },
    });
  } catch (error) {
    console.error('[openai-vision] /api/extract-powerscribe failed', {
      error: error instanceof Error ? error.message : 'unknown error',
    });
    const upstream = sanitizedUpstreamError(error);
    response.status(statusForVisionError(error, upstream.status)).json({
      error: error instanceof Error ? error.message : 'OpenAI Vision extraction failed',
      errorCode: error instanceof OpenAiVisionServerError ? error.code : 'backend_error',
      errorType: upstream.type,
      openAiStatus: upstream.status,
      openAiCode: upstream.code,
      openAiRequestId: upstream.requestId,
      failureStage: error instanceof OpenAiVisionServerError && error.code !== 'request_failed'
        ? 'before_or_after_openai_response'
        : 'during_openai_call',
      transportDiagnostics,
      serverDiagnostics: error instanceof OpenAiVisionServerError ? error.diagnostics : null,
      diagnostics: {
        selectedEngine: 'openai_vision',
        actualEngine: 'openai_vision',
        ocrUsed: 'No',
        modelRequested: 'gpt-5.6-terra',
        modelReturned: error instanceof OpenAiVisionServerError ? error.diagnostics.actualModel : null,
        rowsReturnedDirectlyByVision: error instanceof OpenAiVisionServerError ? error.diagnostics.rowsAfterValidation : 0,
        rowsEnteringSharedPipeline: 0,
        openAiEndpointCalled: true,
        openAiResponseReceived: error instanceof OpenAiVisionServerError ? error.diagnostics.requestSucceeded : false,
      },
    });
  }
}

function headerValue(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function sanitizedUpstreamError(error: unknown) {
  if (error instanceof OpenAiVisionServerError && error.upstream) return error.upstream;
  const candidate = error as {
    status?: unknown; code?: unknown; type?: unknown; request_id?: unknown; requestID?: unknown;
    cause?: { status?: unknown; code?: unknown; type?: unknown; request_id?: unknown; requestID?: unknown };
  };
  const source = candidate?.cause ?? candidate;
  return {
    status: typeof source?.status === 'number' ? source.status : null,
    code: typeof source?.code === 'string' ? source.code : null,
    type: typeof source?.type === 'string' ? source.type : error instanceof Error ? error.name : 'unknown_error',
    requestId: typeof source?.request_id === 'string'
      ? source.request_id
      : typeof source?.requestID === 'string' ? source.requestID : null,
  };
}

function statusForVisionError(error: unknown, upstreamStatus: number | null): number {
  if (error instanceof OpenAiVisionServerError) {
    if (error.code === 'image_payload_rejected') return 400;
    if (error.code === 'schema_validation_failed' || error.code === 'no_structured_output' || error.code === 'empty_rows') return 422;
  }
  if (upstreamStatus === 401 || upstreamStatus === 403) return 502;
  if (upstreamStatus === 404) return 502;
  if (upstreamStatus && upstreamStatus >= 400 && upstreamStatus < 500) return 502;
  if (upstreamStatus && upstreamStatus >= 500) return 503;
  return 500;
}
