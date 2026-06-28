/**
 * ManualImportProvider.ts
 *
 * Wraps a single manually-entered study (from the Log Study screen) into an
 * ImportedStudy so it flows through the shared importPipeline like every
 * other source.
 *
 * The provider is deliberately thin: it accepts the raw exam name, date, and
 * optional notes that the user typed, and returns a single ImportedStudy.
 * All matching, deduplication, and alias learning happen downstream.
 */

import type { ImportProvider, ImportedStudy } from '../types/importProvider';

export interface ManualStudyInput {
  examTitle: string;
  studyDate: string;       // YYYY-MM-DD
  notes?: string | null;
}

export class ManualImportProvider implements ImportProvider {
  readonly name = 'Manual Entry';
  readonly sourceId = 'manual' as const;

  private input: ManualStudyInput;

  constructor(input: ManualStudyInput) {
    this.input = input;
  }

  async importStudies(): Promise<ImportedStudy[]> {
    const { examTitle, studyDate } = this.input;
    if (!examTitle.trim()) return [];

    return [
      {
        examTitle: examTitle.trim(),
        canonicalExam: null,   // pipeline normalizes via alias table
        cpt: null,             // pipeline does CPT matching
        workRvu: null,
        studyDate,
        studyTime: null,
        modality: null,
        accessionNumber: null,
        patientMRN: null,
        source: 'manual',
        importedAt: new Date().toISOString(),
        dateTimeConfidence: 0,
        dateTimeSource: 'manual' as const,
      },
    ];
  }
}
