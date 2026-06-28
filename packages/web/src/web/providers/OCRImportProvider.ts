/**
 * OCRImportProvider.ts
 *
 * Extracts studies from a screenshot or image file using the configured
 * OCR backend, then normalizes the output into ImportedStudy[].
 *
 * Responsibilities of this provider:
 *   • Run OCR on the supplied image file
 *   • Parse structured fields (exam name, accession, datetime) from OCR lines
 *   • Return ImportedStudy[] — one per parsed line
 *
 * The provider does NOT perform alias lookup, CPT matching, or duplicate
 * detection. Those run in importPipeline.ts, identically for every source.
 */

import { parseOcrLines } from '../utils/powerScribeParser';
import { getDefaultOcrProvider } from '../utils/ocrProvider';
import type { ImportProvider, ImportedStudy } from '../types/importProvider';

export class OCRImportProvider implements ImportProvider {
  readonly name = 'OCR Screenshot';
  readonly sourceId = 'ocr' as const;

  private file: File | Blob;
  private studyDate: string;

  constructor(file: File | Blob, studyDate: string) {
    this.file = file;
    this.studyDate = studyDate;
  }

  async importStudies(): Promise<ImportedStudy[]> {
    const provider = getDefaultOcrProvider();
    const result = await provider.extractText(this.file);
    const parsed = parseOcrLines(result.lines);
    const now = new Date().toISOString();

    return parsed.map((p) => ({
      examTitle: p.examName,
      canonicalExam: null,
      cpt: null,
      workRvu: null,
      studyDate: this.studyDate,
      studyTime: p.studyDateTime,
      modality: null,
      accessionNumber: p.accessionNumber,
      patientMRN: null,
      source: 'ocr' as const,
      importedAt: now,
    }));
  }
}
