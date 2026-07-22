import { openAiVisionHealth } from '../../packages/web/src/api/openaiVisionExtraction';

export default function handler(): Response {
  const health = openAiVisionHealth();
  return Response.json(health, { status: health.ready ? 200 : 503 });
}
