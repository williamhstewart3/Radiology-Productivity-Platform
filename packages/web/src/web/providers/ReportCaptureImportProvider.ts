import type { ImportProvider, ImportedStudy } from '../types/importProvider';
import type { ParsedPowerScribeReportHeader } from '../utils/powerScribeReportHeader';

export interface ReportCaptureContext {
  profileId: string | null;
  siteId: string | null;
  captureTimestamp?: string;
  ocrConfidence: number;
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
    return [{
      examTitle: this.header.examTitleRaw,
      procedureName: this.header.examTitleNormalized,
      canonicalExam: null,
      cpt: null,
      workRvu: null,
      studyDate: this.header.examDate ?? importedAt.slice(0, 10),
      examDate: this.header.examDate,
      examTime: this.header.examTime,
      examDateTime: this.header.examDateTime,
      examTimeZone: this.header.timeZone,
      studyTime: null,
      modifiedDate: null,
      modifiedTime: null,
      modifiedDateTime: null,
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
