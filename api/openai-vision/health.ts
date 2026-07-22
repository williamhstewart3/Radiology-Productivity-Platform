import { openAiVisionHealth } from '../../packages/web/src/api/openaiVisionExtraction';

export const config = {
  runtime: 'edge',
};

export default function handler(): Response {
  const health = openAiVisionHealth();
  return Response.json(health, { status: health.ready ? 200 : 503 });
}
