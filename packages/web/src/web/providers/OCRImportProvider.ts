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
import {
  DEFAULT_POWERSCRIBE_STUDY_LIST_CROP,
  cropPowerScribeScreenshotWithDebug,
  type DetectedCrop,
  type RelativeCropRect,
} from '../utils/imageCrop';
import type { ImportProvider, ImportedStudy } from '../types/importProvider';
import type { ParsedLine } from '../utils/powerScribeParser';

export interface OCRImportOptions {
  cropBeforeOcr?: boolean;
  cropRegion?: RelativeCropRect | null;
  autoDetectPowerScribeTable?: boolean;
}

export interface OCRImportDebugInfo {
  crop: DetectedCrop | null;
  ocrText: string;
  ocrLines: string[];
  detectedRows: ParsedLine[];
  ocrConfidence: number;
}

export class OCRImportProvider implements ImportProvider {
  readonly name = 'OCR Screenshot';
  readonly sourceId = 'ocr' as const;

  private file: File | Blob;
  private studyDate: string;
  private options: OCRImportOptions;
  private debugInfo: OCRImportDebugInfo | null = null;

  constructor(file: File | Blob, studyDate: string, options: OCRImportOptions = {}) {
    this.file = file;
    this.studyDate = studyDate;
    this.options = options;
  }

  async importStudies(): Promise<ImportedStudy[]> {
    const provider = getDefaultOcrProvider();
    const cropResult = this.options.cropBeforeOcr === false
      ? null
      : await cropPowerScribeScreenshotWithDebug(
          this.file,
          this.options.autoDetectPowerScribeTable === false
            ? this.options.cropRegion ?? DEFAULT_POWERSCRIBE_STUDY_LIST_CROP
            : this.options.cropRegion ?? null,
        );
    const imageForOcr = cropResult?.blob ?? this.file;
    const result = await provider.extractText(imageForOcr);
    const parsed = parseOcrLines(result.lines);
    const now = new Date().toISOString();

    this.debugInfo = {
      crop: cropResult?.crop ?? null,
      ocrText: result.rawText,
      ocrLines: result.lines,
      detectedRows: parsed,
      ocrConfidence: result.confidence,
    };

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
        rowIndex: p.rowIndex,
        ocrConfidence: result.confidence,
        source: 'ocr' as const,
        importedAt: now,
        dateTimeConfidence: p.dateTimeConfidence,
        dateTimeSource: p.dateTimeConfidence > 0 ? 'ocr' : 'import_default',
      };
    });
  }

  getDebugInfo(): OCRImportDebugInfo | null {
    return this.debugInfo;
  }
}
