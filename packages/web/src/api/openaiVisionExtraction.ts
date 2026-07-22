import OpenAI from 'openai';
import { z } from 'zod';
import {
  DEFAULT_OPENAI_VISION_MODEL,
  validateVisionExtractionPayload,
  visionExtractionSchema,
} from '../web/services/openaiVisionImport';

export const extractPowerScribeRequestSchema = z.object({
  imageDataUrl: z.string().startsWith('data:image/').max(12_000_000),
  model: z.string().trim().min(1).max(80).optional(),
});

const powerscribeExtractionJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['rows'],
  properties: {
    rows: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['rowNumber', 'procedure', 'examDateTime', 'modifiedDateTime', 'confidence'],
        properties: {
          rowNumber: { type: 'integer', minimum: 1 },
          procedure: { type: 'string', minLength: 1 },
          examDateTime: { type: 'string', minLength: 1 },
          modifiedDateTime: { type: 'string', minLength: 1 },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
  },
} as const;

export function openAiVisionHealth() {
  const configured = Boolean(process.env.OPENAI_API_KEY);
  return {
    ready: configured,
    status: configured ? 'OpenAI Vision ready' : 'OpenAI API not configured',
    model: DEFAULT_OPENAI_VISION_MODEL,
  };
}

export async function extractPowerScribeRowsFromImage(payload: unknown) {
  const startedAt = performance.now();
  const request = extractPowerScribeRequestSchema.parse(payload);
  const model = request.model ?? DEFAULT_OPENAI_VISION_MODEL;
  const client = getOpenAIClient();
  if (!client) {
    throw new Error('OPENAI_API_KEY is not configured on the server');
  }

  const response = await client.responses.create({
    model,
    store: false,
    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: [
              'This is a Nuance PowerScribe radiology worklist screenshot.',
              'Read only the visible study table. Each table row is one study.',
              'Relevant columns: Procedure, Exam Date, Modified.',
              'Return every visible study row exactly once.',
              'Preserve Procedure, Exam Date/time, and Modified date/time exactly as shown.',
              'Do not assign CPT codes. Do not assign RVUs.',
              'Do not infer studies that are not visible.',
              'Do not merge adjacent rows.',
              'Do not omit a row because text is uncertain; include it with lower confidence.',
              'The image has been cropped to exclude PHI-containing columns.',
            ].join('\n'),
          },
          {
            type: 'input_image',
            image_url: request.imageDataUrl,
            detail: 'high',
          },
        ],
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'powerscribe_rows',
        strict: true,
        schema: powerscribeExtractionJsonSchema,
      },
    },
  });

  if (!response.output_text) {
    throw new Error('OpenAI returned no structured output text');
  }

  const extraction = validateVisionExtractionPayload(JSON.parse(response.output_text));
  const validated = visionExtractionSchema.parse(extraction);
  const extractionDurationSeconds = (performance.now() - startedAt) / 1000;

  return {
    rows: validated.rows,
    diagnostics: {
      engine: 'OpenAI Vision',
      ocrUsed: 'No',
      model,
      rowsExtracted: validated.rows.length,
      validStructuredRows: validated.rows.length,
      extractionDurationSeconds,
    },
  };
}

function getOpenAIClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  return apiKey ? new OpenAI({ apiKey }) : null;
}
