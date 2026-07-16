import type { ImportProvider, ImportedStudy } from '../types/importProvider';
import type { ParsedPowerScribeReportHeader } from '../utils/powerScribeReportHeader';

export interface ReportCaptureContext {
  profileId: string | null;
  siteId: string | null;
  captureTimestamp?: string;
  ocrConfidence: number;
}

function localCaptureDateTime(timestamp: string): { date: string; time: string; dateTime: string } {
  const parsed = new Date(timestamp);
  const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  const pad = (value: number) => String(value).padStart(2, '0');
  const localDate = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const localTime = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return {
    date: localDate,
    time: localTime,
    dateTime: `${localDate}T${localTime}:${pad(date.getSeconds())}`,
  };
}

/** Converts already-cropped, local header OCR into the shared study contract. */
export class ReportCaptureImportProvider implements ImportProvider {
  readonly name = 'PowerScribe Report Capture';
  readonly sourceId = 'report_capture' as const;

  constructor(
    private readonly header: ParsedPowerScribeReportHeader,
    private readonly context: ReportCaptureContext,
  ) {}

  async importStudies(): Promise<ImportedStudy[]> {
    if (!this.header.matched || !this.header.examTitleRaw) return [];
    const importedAt = this.context.captureTimestamp ?? new Date().toISOString();
    const captured = localCaptureDateTime(importedAt);
    return [{
      examTitle: this.header.examTitleRaw,
      procedureName: this.header.examTitleNormalized,
      canonicalExam: null,
      cpt: null,
      workRvu: null,
      studyDate: captured.date,
      examDate: this.header.examDate,
      examTime: this.header.examTime,
      examDateTime: this.header.examDateTime,
      examTimeZone: this.header.timeZone,
      studyTime: captured.dateTime,
      modifiedDate: captured.date,
      modifiedTime: captured.time,
      modifiedDateTime: captured.dateTime,
      modality: null,
      accessionNumber: null,
      patientMRN: null,
      cleanedExamName: this.header.examTitleNormalized,
      cleanedText: this.header.examTitleNormalized,
      extractionConfidence: this.context.ocrConfidence,
      parserNeedsReview: this.header.needsReview,
      parserReviewReason: this.header.reviewReason,
      parserRawLine: this.header.rawLine,
      ocrConfidence: this.context.ocrConfidence,
      source: 'report_capture',
      captureProfileId: this.context.profileId,
      captureSiteId: this.context.siteId,
      importedAt,
      dateTimeConfidence: this.header.examDateTime ? 1 : 0,
      dateTimeSource: this.header.examDateTime ? 'ocr' : 'import_default',
    }];
  }
}
