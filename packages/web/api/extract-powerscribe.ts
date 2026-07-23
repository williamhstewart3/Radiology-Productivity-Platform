import { extractPowerScribeRowsFromImage, OpenAiVisionServerError } from '../src/api/openaiVisionExtraction';

type VercelRequest = { method?: string; body?: unknown };
type VercelResponse = {
  status: (statusCode: number) => VercelResponse;
  json: (body: unknown) => void;
};

export default async function handler(request: VercelRequest, response: VercelResponse): Promise<void> {
  if (request.method !== 'POST') {
    response.status(405).json({ error: 'Method not allowed' });
    return;
  }

  console.info('[openai-vision] /api/extract-powerscribe request received');
  try {
    const payload = typeof request.body === 'string' ? JSON.parse(request.body) : request.body;
    response.status(200).json(await extractPowerScribeRowsFromImage(payload));
  } catch (error) {
    console.error('[openai-vision] /api/extract-powerscribe failed', {
      error: error instanceof Error ? error.message : 'unknown error',
    });
    response.status(500).json({
      error: error instanceof Error ? error.message : 'OpenAI Vision extraction failed',
      errorCode: error instanceof OpenAiVisionServerError ? error.code : 'backend_error',
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
