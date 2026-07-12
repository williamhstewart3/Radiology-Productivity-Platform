import { parseDateTimeFromOcr } from '../utils/studyDateParser';
import type { ImportProvider, ImportedStudy } from '../types/importProvider';
import type { PowerScribeStructuredOcrRow } from '../types/structuredOcr';

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

function compactRawLine(row: PowerScribeStructuredOcrRow): string {
  return JSON.stringify({
    procedure: row.rawProcedureText,
    examDate: row.rawExamDateText,
    modified: row.rawModifiedText,
  });
}

export class StructuredPowerScribeOcrImportProvider implements ImportProvider {
  readonly name = 'Windows PowerScribe OCR';
  readonly sourceId = 'ocr' as const;

  constructor(
    private readonly rows: PowerScribeStructuredOcrRow[],
    private readonly fallbackDate: string,
  ) {}

  async importStudies(): Promise<ImportedStudy[]> {
    const now = new Date().toISOString();

    return this.rows.map((row) => {
      const procedureName = row.procedureName.trim() || 'UNCLEAR POWERSCRIBE ROW';
      const exam = bestDateTime(row.examDateTime, row.rawExamDateText);
      const modified = bestDateTime(row.modifiedDateTime, row.rawModifiedText);
      const productivityDate = modified.date ?? this.fallbackDate;
      const parserNeedsReview = row.needsReview || procedureName === 'UNCLEAR POWERSCRIBE ROW' || !exam.dateTime || !modified.dateTime;
      const parserReviewReason =
        row.reviewReason ??
        (procedureName === 'UNCLEAR POWERSCRIBE ROW' ? 'Unclear PowerScribe procedure text' :
          !modified.dateTime ? 'Missing Modified time/date - productivity date will use selected log date unless corrected.' :
          !exam.dateTime ? 'Missing or unclear PowerScribe Exam Date column' :
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
        rowIndex: null,
        cleanedExamName: procedureName,
        cleanedText: procedureName,
        extractionConfidence: row.confidence,
        parserNeedsReview,
        parserReviewReason,
        parserRawLine: compactRawLine(row),
        ocrConfidence: row.confidence,
        source: 'ocr' as const,
        importedAt: now,
        dateTimeConfidence,
        dateTimeSource: dateTimeConfidence > 0 ? 'ocr' : 'import_default',
      };
    });
  }
}
