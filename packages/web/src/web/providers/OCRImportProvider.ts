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
import { cropImageBlob, DEFAULT_POWERSCRIBE_STUDY_LIST_CROP, type RelativeCropRect } from '../utils/imageCrop';
import type { ImportProvider, ImportedStudy } from '../types/importProvider';

export interface OCRImportOptions {
  cropBeforeOcr?: boolean;
  cropRegion?: RelativeCropRect | null;
}

export class OCRImportProvider implements ImportProvider {
  readonly name = 'OCR Screenshot';
  readonly sourceId = 'ocr' as const;

  private file: File | Blob;
  private studyDate: string;
  private options: OCRImportOptions;

  constructor(file: File | Blob, studyDate: string, options: OCRImportOptions = {}) {
    this.file = file;
    this.studyDate = studyDate;
    this.options = options;
  }

  async importStudies(): Promise<ImportedStudy[]> {
    const provider = getDefaultOcrProvider();
    const imageForOcr = this.options.cropBeforeOcr === false
      ? this.file
      : await cropImageBlob(this.file, this.options.cropRegion ?? DEFAULT_POWERSCRIBE_STUDY_LIST_CROP);
    const result = await provider.extractText(imageForOcr);
    const parsed = parseOcrLines(result.lines);
    const now = new Date().toISOString();

    return parsed.map((p) => {
      const productivityDate = p.modifiedDate ?? p.studyDate ?? this.studyDate;

      return {
        examTitle: p.examName,
        canonicalExam: null,
        cpt: null,
        workRvu: null,
        studyDate: p.studyDate ?? productivityDate,
        studyTime: p.modifiedDateTime ?? p.studyDateTime,
        modifiedDate: p.modifiedDate ?? productivityDate,
        modifiedDateTime: p.modifiedDateTime ?? p.studyDateTime,
        modality: null,
        accessionNumber: p.accessionNumber,
        patientMRN: null,
        source: 'ocr' as const,
        importedAt: now,
        dateTimeConfidence: p.dateTimeConfidence,
        dateTimeSource: p.dateTimeConfidence > 0 ? 'ocr' : 'import_default',
      };
    });
  }
}
