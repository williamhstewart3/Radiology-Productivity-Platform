import { parseDateTimeFromOcr } from '../utils/studyDateParser';
import type { ImportProvider, ImportedStudy } from '../types/importProvider';
import type { PowerScribeVisionRow } from '../types/structuredOcr';

function splitIsoMinute(value: string | null): { date: string | null; time: string | null; dateTime: string | null } {
  if (!value) return { date: null, time: null, dateTime: null };
  const normalized = value.length === 16 ? `${value}:00` : value;
  const match = normalized.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2})?$/);
  if (!match) return { date: null, time: null, dateTime: null };
  return { date: match[1], time: match[2], dateTime: normalized };
}

function bestDateTime(value: string | null, rawText: string): { date: string | null; time: string | null; dateTime: string | null; confidence: number } {
  const fromIso = splitIsoMinute(value);
  if (fromIso.dateTime) return { ...fromIso, confidence: 1 };
  const parsed = parseDateTimeFromOcr(rawText);
  return {
    date: parsed?.studyDate ?? null,
    time: parsed?.studyTime ?? null,
    dateTime: parsed?.studyDateTime ?? null,
    confidence: parsed?.confidence ?? 0,
  };
}

function compactRawLine(row: PowerScribeVisionRow): string {
  return JSON.stringify({
    provider: 'ollama_vision',
    rowIndex: row.rowIndex,
    procedure: row.rawProcedureText,
    examDate: row.rawExamDateText,
    modified: row.rawModifiedText,
  });
}

export class PowerScribeVisionImportProvider implements ImportProvider {
  readonly name = 'Ollama PowerScribe Vision';
  readonly sourceId = 'vision' as const;

  constructor(
    private readonly rows: PowerScribeVisionRow[],
    private readonly fallbackDate: string,
  ) {}

  async importStudies(): Promise<ImportedStudy[]> {
    const now = new Date().toISOString();

    return this.rows.map((row) => {
      const procedureName = row.procedureName.trim() || 'UNCLEAR POWERSCRIBE ROW';
      const exam = bestDateTime(row.examDateTime, row.rawExamDateText);
      const modified = bestDateTime(row.modifiedDateTime, row.rawModifiedText);
      const productivityDate = modified.date ?? this.fallbackDate;
      const missingModifiedDate = !modified.dateTime;
      const missingExamDate = !exam.dateTime;
      const parserNeedsReview = row.needsReview || procedureName === 'UNCLEAR POWERSCRIBE ROW' || missingModifiedDate || missingExamDate;
      const parserReviewReason =
        row.reviewReason ??
        (procedureName === 'UNCLEAR POWERSCRIBE ROW' ? 'Unclear PowerScribe procedure text from Vision extraction' :
          missingModifiedDate ? 'Vision extraction did not return a complete Modified/Read datetime.' :
          missingExamDate ? 'Vision extraction did not return a complete Exam Date datetime.' :
          null);
      const dateTimeConfidence = Math.max(exam.confidence, modified.confidence);

      return {
        examTitle: procedureName,
        procedureName,
        canonicalExam: null,
        cpt: null,
        workRvu: null,
        studyDate: productivityDate,
        examDate: exam.date,
        examTime: exam.time,
        examDateTime: exam.dateTime,
        studyTime: modified.dateTime,
        modifiedDate: modified.date,
        modifiedDateTime: modified.dateTime,
        modifiedTime: modified.time,
        modality: null,
        accessionNumber: null,
        patientMRN: null,
        rowIndex: row.rowIndex,
        cleanedExamName: procedureName,
        cleanedText: procedureName,
        extractionConfidence: row.confidence,
        parserNeedsReview,
        parserReviewReason,
        parserRawLine: compactRawLine(row),
        ocrConfidence: null,
        source: 'vision' as const,
        importedAt: now,
        dateTimeConfidence,
        dateTimeSource: dateTimeConfidence > 0 ? 'vision' : 'import_default',
      };
    });
  }
}
