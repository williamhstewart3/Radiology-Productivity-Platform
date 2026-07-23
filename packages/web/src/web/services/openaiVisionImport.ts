import { z } from 'zod';
import type { PipelineResult } from '../pipeline/importPipeline';
import type { ImportedStudy, StructuredStudyRow } from '../types/importProvider';

export const DEFAULT_OPENAI_VISION_MODEL = 'gpt-5.6-terra';

export const visionRowSchema = z.object({
  rowNumber: z.number().int().positive().nullable(),
  procedure: z.string().trim().min(1).nullable(),
  examDateTime: z.string().trim().min(1).nullable(),
  modifiedDateTime: z.string().trim().min(1).nullable(),
  confidence: z.number().min(0).max(1).nullable(),
}).strict();

export const visionExtractionSchema = z.object({ rows: z.array(visionRowSchema) }).strict();
export type OpenAiVisionExtraction = z.infer<typeof visionExtractionSchema>;

export interface OpenAiVisionDiagnostics {
  buildCommit: string;
  selectedEngine: 'openai_vision';
  actualEngine: 'openai_vision';
  ocrUsed: 'No';
  model: string;
  cropCoordinates: { x: number; y: number; width: number; height: number };
  extractedRows: number;
  validRows: number;
  unresolvedRows: number;
  downstreamAccountedRows: number;
  extractionDurationSeconds: number;
  extractorProviderClass: 'OpenAiVisionExtractorProvider';
  openAiEndpointCalled: boolean;
  openAiResponseReceived: boolean;
  ocrProviderCalled: false;
  tesseractCalled: false;
  ocrReconstructionCalled: false;
  modelRequested: string;
  modelReturned: string | null;
  cropSentToVision: boolean;
  rowsReturnedDirectlyByVision: number;
  rowsEnteringSharedPipeline: number;
  fallbackUsed: false;
  fallbackReason: null;
  failureCode: string | null;
  failureMessage: string | null;
  originalImageWidth: number | null;
  originalImageHeight: number | null;
  croppedImageWidth: number | null;
  croppedImageHeight: number | null;
  finalImageWidth: number | null;
  finalImageHeight: number | null;
  imageMimeType: string | null;
  encodedImageBytes: number;
  server: {
    requestSucceeded: boolean;
    actualModel: string | null;
    responseStatus: number | null;
    outputItems: number;
    outputTextLength: number;
    hasOutputText: boolean;
    hasStructuredPayload: boolean;
    parsedRowsPresent: boolean;
    rowsBeforeValidation: number;
    rowsAfterValidation: number;
    schemaValid: boolean;
    schemaValidationErrors: string[];
    imageMimeType: string | null;
    encodedImageBytes: number;
    dataUrlConstructed: boolean;
    imageAttachedToRequest: boolean;
  } | null;
}

export function validateVisionExtractionPayload(payload: unknown): OpenAiVisionExtraction {
  return visionExtractionSchema.parse(payload);
}

export function parsePowerScribeDateTime(value: string | null): { isoDateTime: string | null; date: string | null } {
  const normalized = value?.trim() ?? '';
  if (!normalized) return { isoDateTime: null, date: null };
  const match = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i);
  if (match) {
    const yearValue = Number(match[3]);
    const year = yearValue < 100 ? 2000 + yearValue : yearValue;
    let hour = match[4] ? Number(match[4]) : 0;
    const minute = match[5] ? Number(match[5]) : 0;
    const second = match[6] ? Number(match[6]) : 0;
    const meridiem = match[7]?.toUpperCase();
    if (meridiem === 'PM' && hour < 12) hour += 12;
    if (meridiem === 'AM' && hour === 12) hour = 0;
    const date = `${year}-${pad(Number(match[1]))}-${pad(Number(match[2]))}`;
    return { isoDateTime: `${date}T${pad(hour)}:${pad(minute)}:${pad(second)}`, date };
  }
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime())
    ? { isoDateTime: null, date: null }
    : { isoDateTime: parsed.toISOString(), date: parsed.toISOString().slice(0, 10) };
}

export class OpenAiVisionExtractorProvider {
  readonly name = 'OpenAI Vision — Experimental';
  readonly sourceId = 'openai_vision' as const;

  constructor(private readonly rows: StructuredStudyRow[], private readonly fallbackLogDate: string) {}

  async importStudies(): Promise<ImportedStudy[]> {
    const importedAt = new Date().toISOString();
    return this.rows.map((row, index) => {
      const exam = parsePowerScribeDateTime(row.examDateTime);
      const modified = parsePowerScribeDateTime(row.modifiedDateTime);
      const procedure = row.procedure ?? `[Unclear procedure — row ${row.rowNumber ?? index + 1}]`;
      const incomplete = !row.procedure || !exam.isoDateTime || !modified.isoDateTime || (row.confidence ?? 0) < 0.75;
      return {
        examTitle: procedure,
        procedureName: procedure,
        canonicalExam: null,
        cpt: null,
        workRvu: null,
        studyDate: modified.date ?? this.fallbackLogDate,
        examDate: exam.date,
        examDateTime: exam.isoDateTime,
        studyTime: exam.isoDateTime,
        modifiedDate: modified.date,
        modifiedDateTime: modified.isoDateTime,
        modality: null,
        accessionNumber: null,
        patientMRN: null,
        rowIndex: row.rowNumber == null ? null : String(row.rowNumber),
        extractionConfidence: row.confidence,
        parserNeedsReview: incomplete,
        parserReviewReason: incomplete ? 'OpenAI Vision returned an uncertain or incomplete visible row' : null,
        source: 'openai_vision',
        importedAt,
        dateTimeConfidence: row.confidence,
        dateTimeSource: 'api_future',
      };
    });
  }
}

export function buildVisionDiagnostics(
  server: Omit<OpenAiVisionDiagnostics, 'unresolvedRows' | 'downstreamAccountedRows'>,
  pipeline: PipelineResult,
): OpenAiVisionDiagnostics {
  return {
    ...server,
    unresolvedRows: pipeline.reviewRows.filter((row) => row.candidates.length === 0).length,
    downstreamAccountedRows: pipeline.reviewRows.length + pipeline.skippedRows.length,
  };
}

export function failedVisionDiagnostics(
  cropCoordinates: OpenAiVisionDiagnostics['cropCoordinates'],
  overrides: Partial<OpenAiVisionDiagnostics> = {},
): OpenAiVisionDiagnostics {
  return {
    buildCommit: typeof __BUILD_COMMIT_SHA__ === 'string' ? __BUILD_COMMIT_SHA__ : 'test', selectedEngine: 'openai_vision', actualEngine: 'openai_vision', ocrUsed: 'No',
    model: DEFAULT_OPENAI_VISION_MODEL, cropCoordinates, extractedRows: 0, validRows: 0, unresolvedRows: 0,
    downstreamAccountedRows: 0, extractionDurationSeconds: 0, extractorProviderClass: 'OpenAiVisionExtractorProvider',
    openAiEndpointCalled: false, openAiResponseReceived: false, ocrProviderCalled: false, tesseractCalled: false,
    ocrReconstructionCalled: false, modelRequested: DEFAULT_OPENAI_VISION_MODEL, modelReturned: null,
    cropSentToVision: false, rowsReturnedDirectlyByVision: 0, rowsEnteringSharedPipeline: 0,
    fallbackUsed: false, fallbackReason: null, failureCode: null, failureMessage: null,
    originalImageWidth: null, originalImageHeight: null, croppedImageWidth: null, croppedImageHeight: null,
    finalImageWidth: null, finalImageHeight: null, imageMimeType: null, encodedImageBytes: 0,
    server: null, ...overrides,
  };
}

function pad(value: number) { return String(value).padStart(2, '0'); }
