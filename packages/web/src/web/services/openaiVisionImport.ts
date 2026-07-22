import { z } from 'zod';
import type { PipelineResult } from '../pipeline/importPipeline';
import type { ImportedStudy } from '../types/importProvider';

export const DEFAULT_OPENAI_VISION_MODEL = 'gpt-5.6-terra';

export const visionRowSchema = z.object({
  rowNumber: z.number().int().positive(),
  procedure: z.string().trim().min(1),
  examDateTime: z.string().trim().min(1),
  modifiedDateTime: z.string().trim().min(1),
  confidence: z.number().min(0).max(1),
});

export const visionExtractionSchema = z.object({
  rows: z.array(visionRowSchema),
});

export type OpenAiVisionRow = z.infer<typeof visionRowSchema>;
export type OpenAiVisionExtraction = z.infer<typeof visionExtractionSchema>;

export interface OpenAiVisionDiagnostics {
  engine: 'OpenAI Vision';
  ocrUsed: 'No';
  model: string;
  rowsExtracted: number;
  validStructuredRows: number;
  unresolvedRows: number;
  downstreamReviewRows: number;
  exactDuplicatesSkipped: number;
  finalAccountedRows: number;
  extractionDurationSeconds: number;
}

export function validateVisionExtractionPayload(payload: unknown): OpenAiVisionExtraction {
  return visionExtractionSchema.parse(payload);
}

export function parsePowerScribeDateTime(value: string): { isoDateTime: string | null; date: string | null } {
  const normalized = value.trim();
  if (!normalized) return { isoDateTime: null, date: null };

  const slashMatch = normalized.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i,
  );
  if (slashMatch) {
    const month = Number(slashMatch[1]);
    const day = Number(slashMatch[2]);
    const rawYear = Number(slashMatch[3]);
    const year = rawYear < 100 ? 2000 + rawYear : rawYear;
    let hour = slashMatch[4] ? Number(slashMatch[4]) : 12;
    const minute = slashMatch[5] ? Number(slashMatch[5]) : 0;
    const second = slashMatch[6] ? Number(slashMatch[6]) : 0;
    const meridiem = slashMatch[7]?.toUpperCase();
    if (meridiem === 'PM' && hour < 12) hour += 12;
    if (meridiem === 'AM' && hour === 12) hour = 0;
    const date = toDateString(year, month, day);
    return { isoDateTime: `${date}T${pad(hour)}:${pad(minute)}:${pad(second)}`, date };
  }

  const parsed = new Date(normalized);
  if (!Number.isNaN(parsed.getTime())) {
    return {
      isoDateTime: parsed.toISOString(),
      date: parsed.toISOString().slice(0, 10),
    };
  }

  return { isoDateTime: null, date: null };
}

export function visionRowsToImportedStudies(
  rows: OpenAiVisionRow[],
  fallbackLogDate: string,
): ImportedStudy[] {
  const now = new Date().toISOString();
  return rows.map((row) => {
    const exam = parsePowerScribeDateTime(row.examDateTime);
    const modified = parsePowerScribeDateTime(row.modifiedDateTime);
    const productivityDate = modified.date ?? fallbackLogDate;

    return {
      examTitle: row.procedure,
      canonicalExam: null,
      cpt: null,
      workRvu: null,
      studyDate: productivityDate,
      studyTime: exam.isoDateTime,
      modality: null,
      accessionNumber: null,
      patientMRN: null,
      source: 'openai_vision',
      importedAt: now,
      dateTimeConfidence: row.confidence,
      dateTimeSource: 'openai_vision',
      procedureName: row.procedure,
      examDateTime: row.examDateTime,
      modifiedDateTime: row.modifiedDateTime,
      visionRowNumber: row.rowNumber,
      visionConfidence: row.confidence,
    };
  });
}

export function buildVisionDiagnostics(
  model: string,
  rowsExtracted: number,
  validStructuredRows: number,
  extractionDurationSeconds: number,
  pipelineResult: PipelineResult,
): OpenAiVisionDiagnostics {
  const allRows = [...pipelineResult.reviewRows, ...pipelineResult.skippedRows];
  const unresolvedRows = allRows.filter((row) => row.candidates.length === 0).length;
  const exactDuplicatesSkipped = pipelineResult.skippedRows.filter(
    (row) => row.duplicateStatus === 'exact',
  ).length;

  return {
    engine: 'OpenAI Vision',
    ocrUsed: 'No',
    model,
    rowsExtracted,
    validStructuredRows,
    unresolvedRows,
    downstreamReviewRows: pipelineResult.reviewRows.length,
    exactDuplicatesSkipped,
    finalAccountedRows: pipelineResult.reviewRows.length + pipelineResult.skippedRows.length,
    extractionDurationSeconds,
  };
}

function toDateString(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
