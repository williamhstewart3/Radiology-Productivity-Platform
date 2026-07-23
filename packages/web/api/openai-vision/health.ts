type VercelResponse = {
  status: (statusCode: number) => VercelResponse;
  setHeader: (name: string, value: string) => void;
  json: (body: unknown) => void;
};

export default function handler(_request: unknown, response: VercelResponse): void {
  const ready = Boolean(process.env.OPENAI_API_KEY);
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  response.status(ready ? 200 : 503).json({
    ready,
    configured: ready,
    provider: 'openai',
    status: ready ? 'OpenAI Vision ready' : 'OpenAI API key not configured',
    reason: ready ? null : 'OPENAI_API_KEY is missing from this deployment environment',
    environment: process.env.VERCEL_ENV ?? 'unknown',
    model: 'gpt-5.6-terra',
  });
}
