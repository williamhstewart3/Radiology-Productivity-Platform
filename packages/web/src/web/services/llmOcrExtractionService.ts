import type { ParsedLine } from '../utils/powerScribeParser';

export interface LlmOcrEnhancementInput {
  rawText: string;
  lines: string[];
  regexParsed: ParsedLine[];
  fallbackStudyDate: string;
  ocrProviderName: string;
  ocrConfidence: number;
  enabled?: boolean;
}

function containsTimeEvidence(text: string): boolean {
  return /\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?\b/.test(text);
}

function hasInventedTime(row: ParsedLine, rawText: string): boolean {
  const hasOcrTime = containsTimeEvidence(rawText);
  return !hasOcrTime && Boolean(row.examTime || row.modifiedTime || row.examDateTime || row.modifiedDateTime);
}

function validateEnhancedRows(rows: ParsedLine[], rawText: string): ParsedLine[] {
  return rows.map((row) => {
    if (!hasInventedTime(row, rawText)) return row;
    return {
      ...row,
      examTime: null,
      examDateTime: null,
      modifiedTime: null,
      modifiedDateTime: null,
      studyDateTime: null,
      dateTimeConfidence: Math.min(row.dateTimeConfidence, 0.85),
      needsReview: true,
      reviewReason: row.reviewReason ?? 'LLM cleanup omitted unsupported time values',
    };
  });
}

export async function maybeEnhanceOcrWithLlm(input: LlmOcrEnhancementInput): Promise<ParsedLine[]> {
  if (!input.enabled) return input.regexParsed;
  // LLM cleanup is intentionally disabled until a local policy, provider, and
  // settings UI are configured. Keep the validated no-op path in place so the
  // OCR pipeline has a stable insertion point.
  return validateEnhancedRows(input.regexParsed, input.rawText);
}

export const __testValidateLlmEnhancedRows = validateEnhancedRows;
