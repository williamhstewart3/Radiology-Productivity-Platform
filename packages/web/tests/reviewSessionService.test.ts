import { describe, expect, test } from 'bun:test';
import { __testQuietRowsForImmediateCommit, mergeReviewSessionRows } from '../src/web/services/reviewSessionService';
import type { PipelineReviewRow } from '../src/web/pipeline/importPipeline';
import type { ImportedStudy } from '../src/web/types/importProvider';
import type { MatchCandidate, Modality } from '../src/web/types';

function candidate(cptCode: string): MatchCandidate {
  return {
    cptCode,
    modifier: '26',
    description: `CPT ${cptCode}`,
    workRvu: 1,
    modality: 'XR' as Modality,
    confidence: 1,
    method: 'radiology_match',
    explanation: {
      rawText: 'XR CHEST PORTABLE',
      normalizedText: 'xr chest portable',
      source: 'test',
      detail: 'test',
    },
  };
}

function row(patch: Partial<ImportedStudy> = {}, cptCodes = ['71045']): PipelineReviewRow {
  const source: ImportedStudy = {
    source: 'ocr',
    examTitle: 'XR CHEST PORTABLE',
    procedureName: 'XR CHEST PORTABLE',
    canonicalExam: null,
    cpt: null,
    workRvu: null,
    studyDate: '2026-07-01',
    examDate: patch.examDate ?? '2026-07-01',
    examTime: patch.examTime ?? null,
    examDateTime: patch.examDateTime ?? null,
    studyTime: patch.studyTime ?? patch.modifiedDateTime ?? null,
    modifiedDate: patch.modifiedDate ?? '2026-07-02',
    modifiedTime: patch.modifiedTime ?? null,
    modifiedDateTime: patch.modifiedDateTime ?? null,
    modality: 'XR',
    accessionNumber: null,
    patientMRN: null,
    rowIndex: null,
    cleanedExamName: 'XR CHEST PORTABLE',
    cleanedText: 'XR CHEST PORTABLE',
    extractionConfidence: 1,
    parserNeedsReview: false,
    parserReviewReason: null,
    parserRawLine: 'XR CHEST PORTABLE',
    ocrConfidence: 1,
    importedAt: '2026-07-02T08:00:00.000Z',
    dateTimeConfidence: patch.dateTimeConfidence ?? 1,
    dateTimeSource: 'ocr',
    ...patch,
  };

  return {
    tempId: crypto.randomUUID(),
    source,
    candidates: cptCodes.map(candidate),
    selectedCandidateIndex: 0,
    selectedCandidateIndices: cptCodes.map((_, index) => index),
    displayTitle: source.procedureName ?? source.examTitle,
    needsReview: false,
    duplicateStatus: null,
    duplicateExistingLogId: null,
    duplicateReason: null,
    included: true,
    autoSkipped: false,
    autoApproved: false,
    autoApprovalLevel: null,
    reviewReason: null,
  };
}

describe('active review session duplicate merging', () => {
  test('commits quiet rows even when another row still needs review', () => {
    const quiet = row();
    const pending = { ...row({}, ['73650']), needsReview: true };

    expect(__testQuietRowsForImmediateCommit([quiet, pending])).toEqual([quiet]);
  });

  test('does not self-dedupe repeated same-CPT rows when exact times differ', () => {
    const existing = row({
      examDateTime: '2026-07-01T17:18:00',
      modifiedDateTime: '2026-07-02T07:59:00',
    });
    const next = row({
      examDateTime: '2026-07-01T19:06:00',
      modifiedDateTime: '2026-07-02T08:03:00',
    });

    const merged = mergeReviewSessionRows([existing], [], [next], []);

    expect(merged.reviewRows).toHaveLength(2);
    expect(merged.skippedRows).toHaveLength(0);
  });

  test('skips exact repeated rows from a subsequent capture', () => {
    const existing = row({
      examDateTime: '2026-07-01T17:18:00',
      modifiedDateTime: '2026-07-02T07:59:00',
    });
    const repeated = row({
      examDateTime: '2026-07-01T17:18:00',
      modifiedDateTime: '2026-07-02T07:59:00',
    });

    const merged = mergeReviewSessionRows([existing], [], [repeated], []);

    expect(merged.reviewRows).toHaveLength(1);
    expect(merged.skippedRows).toHaveLength(1);
    expect(merged.skippedRows[0].duplicateStatus).toBe('exact');
  });

  test('keeps same CPT/date rows visible when times are missing', () => {
    const existing = row({ examDateTime: null, modifiedDateTime: null, studyTime: null });
    const next = row({ examDateTime: null, modifiedDateTime: null, studyTime: null });

    const merged = mergeReviewSessionRows([existing], [], [next], []);

    expect(merged.reviewRows).toHaveLength(2);
    expect(merged.skippedRows).toHaveLength(0);
  });

  test('handles multi-CPT exact identity and modified-time differences', () => {
    const existing = row({
      examDateTime: '2026-07-01T17:18:00',
      modifiedDateTime: '2026-07-02T07:59:00',
    }, ['71260', '74177']);
    const repeated = row({
      examDateTime: '2026-07-01T17:18:00',
      modifiedDateTime: '2026-07-02T07:59:00',
    }, ['74177', '71260']);
    const differentRead = row({
      examDateTime: '2026-07-01T17:18:00',
      modifiedDateTime: '2026-07-02T08:03:00',
    }, ['74177', '71260']);

    const repeatedMerge = mergeReviewSessionRows([existing], [], [repeated], []);
    const differentMerge = mergeReviewSessionRows([existing], [], [differentRead], []);

    expect(repeatedMerge.skippedRows).toHaveLength(1);
    expect(differentMerge.skippedRows).toHaveLength(0);
    expect(differentMerge.reviewRows).toHaveLength(2);
  });
});
