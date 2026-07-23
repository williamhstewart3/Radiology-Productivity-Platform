import { openAiVisionHealth } from '../../src/api/openaiVisionExtraction';

export default function handler(): Response {
  const health = openAiVisionHealth();
  return Response.json(health, {
    status: health.ready ? 200 : 503,
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  });
}
