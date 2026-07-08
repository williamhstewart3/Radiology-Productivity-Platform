import { describe, expect, test } from 'bun:test';
import { __testValidateLlmEnhancedRows } from '../src/web/services/llmOcrExtractionService';
import type { ParsedLine } from '../src/web/utils/powerScribeParser';

function parsedLine(patch: Partial<ParsedLine>): ParsedLine {
  return {
    rawText: 'XR CHEST PORTABLE 7/7/26',
    procedureName: 'XR CHEST PORTABLE',
    examName: 'XR CHEST PORTABLE',
    cleanedExamName: 'XR CHEST PORTABLE',
    cleanedText: 'XR CHEST PORTABLE',
    examDate: '2026-07-07',
    examTime: null,
    examDateTime: null,
    studyDateTime: null,
    studyDate: '2026-07-07',
    modifiedDateTime: null,
    modifiedDate: null,
    modifiedTime: null,
    accessionNumber: null,
    rowIndex: null,
    dateTimeConfidence: 0.85,
    extractionConfidence: 0.9,
    needsReview: false,
    reviewReason: null,
    ...patch,
  };
}

describe('LLM OCR cleanup validation', () => {
  test('does not allow LLM cleanup to invent a time when OCR text only has a date', () => {
    const [row] = __testValidateLlmEnhancedRows([
      parsedLine({
        examTime: '08:14',
        examDateTime: '2026-07-07T08:14:00',
        studyDateTime: '2026-07-07T08:14:00',
        modifiedTime: '09:24',
        modifiedDateTime: '2026-07-07T09:24:00',
        dateTimeConfidence: 1,
      }),
    ], 'XR CHEST PORTABLE 7/7/26');

    expect(row.examTime).toBeNull();
    expect(row.examDateTime).toBeNull();
    expect(row.modifiedTime).toBeNull();
    expect(row.modifiedDateTime).toBeNull();
    expect(row.studyDateTime).toBeNull();
    expect(row.needsReview).toBe(true);
    expect(row.dateTimeConfidence).toBe(0.85);
  });
});
