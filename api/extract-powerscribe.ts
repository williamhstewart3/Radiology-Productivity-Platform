import { extractPowerScribeRowsFromImage, OpenAiVisionServerError } from '../packages/web/src/api/openaiVisionExtraction';

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 });
  console.info('[openai-vision] /api/extract-powerscribe request received');
  try {
    return Response.json(await extractPowerScribeRowsFromImage(await request.json()));
  } catch (error) {
    console.error('[openai-vision] /api/extract-powerscribe failed', { error: error instanceof Error ? error.message : 'unknown error' });
    return Response.json({
      error: error instanceof Error ? error.message : 'OpenAI Vision extraction failed',
      errorCode: error instanceof OpenAiVisionServerError ? error.code : 'backend_error',
      serverDiagnostics: error instanceof OpenAiVisionServerError ? error.diagnostics : null,
      diagnostics: { selectedEngine: 'openai_vision', actualEngine: 'openai_vision', ocrUsed: 'No' },
    }, { status: 500 });
  }
}
