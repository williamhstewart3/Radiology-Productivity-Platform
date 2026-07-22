import { Hono } from 'hono';
import { cors } from 'hono/cors';
import {
  extractPowerScribeRowsFromImage,
  openAiVisionHealth,
} from './openaiVisionExtraction';

const app = new Hono()
  .basePath('api')
  .use(cors({ origin: (origin) => origin ?? '*', credentials: true, exposeHeaders: ['set-auth-token'] }))
  .get('/ping', (c) => c.json({ message: `Pong! ${Date.now()}` }, 200))
  .get('/health', (c) => c.json({ status: 'ok' }, 200))
  .get('/openai-vision/health', (c) => {
    const health = openAiVisionHealth();
    return health.ready ? c.json(health, 200) : c.json(health, 503);
  })
  .post('/extract-powerscribe', async (c) => {
    try {
      return c.json(await extractPowerScribeRowsFromImage(await c.req.json()), 200);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'OpenAI Vision extraction failed';
      return c.json({
        error: message,
        diagnostics: {
          engine: 'OpenAI Vision',
          ocrUsed: 'No',
        },
      }, 500);
    }
  });

export type AppType = typeof app;
export default app;
