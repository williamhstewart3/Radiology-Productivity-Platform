import { extractPowerScribeRowsFromImage } from '../packages/web/src/api/openaiVisionExtraction';

export const config = {
  runtime: 'edge',
};

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const result = await extractPowerScribeRowsFromImage(await request.json());
    return Response.json(result, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'OpenAI Vision extraction failed';
    return Response.json({
      error: message,
      diagnostics: {
        engine: 'OpenAI Vision',
        ocrUsed: 'No',
      },
    }, { status: 500 });
  }
}
