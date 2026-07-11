import { describe, expect, test } from 'bun:test';
import { db } from '../src/web/db/database';
import { commitPipelineResults, type PipelineReviewRow } from '../src/web/pipeline/importPipeline';
import { buildFingerprint, isStrongDuplicateFingerprint } from '../src/web/utils/duplicateDetection';
import type { ImportedStudy } from '../src/web/types/importProvider';
import type { MatchCandidate } from '../src/web/types';

function study(overrides: Partial<ImportedStudy> = {}): ImportedStudy {
  return {
    examTitle: 'XR CHEST PORTABLE',
    procedureName: 'XR CHEST PORTABLE',
    canonicalExam: null,
    cpt: null,
    workRvu: null,
    studyDate: '2026-07-01',
    examDate: '2026-07-01',
    examTime: '08:00',
    examDateTime: '2026-07-01T08:00:00',
    studyTime: '2026-07-01T08:00:00',
    modifiedDate: '2026-07-01',
    modifiedTime: '08:05',
    modifiedDateTime: '2026-07-01T08:05:00',
    modality: 'XR',
    accessionNumber: null,
    patientMRN: null,
    rowIndex: null,
    cleanedExamName: 'XR CHEST PORTABLE',
    cleanedText: 'XR CHEST PORTABLE',
    extractionConfidence: 0.9,
    parserNeedsReview: false,
    parserReviewReason: null,
    parserRawLine: 'XR CHEST PORTABLE',
    ocrConfidence: 0.9,
    source: 'ocr',
    importedAt: new Date().toISOString(),
    dateTimeConfidence: 1,
    dateTimeSource: 'ocr',
    ...overrides,
  };
}

function candidate(overrides: Partial<MatchCandidate> = {}): MatchCandidate {
  return {
    cptCode: '71045',
    modifier: '26',
    description: 'XR Chest 1 view',
    workRvu: 0.15,
    modality: 'XR',
    confidence: 0.99,
    method: 'alias_match',
    ...overrides,
  };
}

function reviewRow(overrides: Partial<PipelineReviewRow> = {}): PipelineReviewRow {
  const source = overrides.source ?? study();
  const candidates = overrides.candidates ?? [candidate()];
  return {
    tempId: crypto.randomUUID(),
    source,
    candidates,
    selectedCandidateIndex: candidates.length > 0 ? 0 : null,
    selectedCandidateIndices: candidates.length > 0 ? [0] : [],
    displayTitle: source.procedureName ?? source.examTitle,
    needsReview: false,
    duplicateStatus: null,
    duplicateExistingLogId: null,
    duplicateReason: null,
    included: true,
    autoSkipped: false,
    autoApproved: false,
    autoApprovalLevel: null,
    approvalStatus: 'manual_approved',
    reviewReason: null,
    ...overrides,
  };
}

describe('buildFingerprint minute-granularity duplicate classification', () => {
  test('same CPT+title+date but different minutes does not produce a matching strict fingerprint', () => {
    const fpA = buildFingerprint('XR CHEST PORTABLE', '71045', '2026-07-01', '2026-07-01T08:05:00', null, 'XR', {
      cptCodes: ['71045'],
      performedDateTime: '2026-07-01T08:00:00',
      modifiedDateTime: '2026-07-01T08:05:00',
    });
    const fpB = buildFingerprint('XR CHEST PORTABLE', '71045', '2026-07-01', '2026-07-01T08:12:00', null, 'XR', {
      cptCodes: ['71045'],
      performedDateTime: '2026-07-01T08:00:00',
      modifiedDateTime: '2026-07-01T08:12:00',
    });

    expect(fpA).not.toBe(fpB);
  });

  test('same CPT set + both timestamps in the same minute produces an exact-skip fingerprint', () => {
    const fpA = buildFingerprint('XR CHEST PORTABLE', '71045', '2026-07-01', '2026-07-01T08:05:00', null, 'XR', {
      cptCodes: ['71045'],
      performedDateTime: '2026-07-01T08:00:00',
      modifiedDateTime: '2026-07-01T08:05:00',
    });
    const fpB = buildFingerprint('XR CHEST PORTABLE', '71045', '2026-07-01', '2026-07-01T08:05:00', null, 'XR', {
      cptCodes: ['71045'],
      performedDateTime: '2026-07-01T08:00:00',
      modifiedDateTime: '2026-07-01T08:05:00',
    });

    expect(fpA).toBe(fpB);
    expect(isStrongDuplicateFingerprint(fpA)).toBe(true);
  });
});

describe('commitPipelineResults — save-path accounting', () => {
  test('different-minute repeats of the same exam are not skipped', async () => {
    const row1 = reviewRow({ source: study({ modifiedDateTime: '2026-07-01T08:05:00', modifiedTime: '08:05' }) });
    const row2 = reviewRow({ source: study({ modifiedDateTime: '2026-07-01T08:12:00', modifiedTime: '08:12' }) });

    const result = await commitPipelineResults([row1, row2], '2026-07-01', 0, null);

    expect(result.importedCount).toBe(2);
    expect(result.alreadySavedCount).toBe(0);
  });

  test('a strict-fingerprint duplicate submitted to commit is counted as already-saved, not silently dropped', async () => {
    const row1 = reviewRow({ source: study({ modifiedDateTime: '2026-07-01T09:05:00', modifiedTime: '09:05' }) });
    const firstCommit = await commitPipelineResults([row1], '2026-07-01', 0, null);
    expect(firstCommit.importedCount).toBe(1);

    const row2 = reviewRow({ source: study({ modifiedDateTime: '2026-07-01T09:05:00', modifiedTime: '09:05' }) });
    const secondCommit = await commitPipelineResults([row2], '2026-07-01', 0, null);

    expect(secondCommit.importedCount).toBe(0);
    expect(secondCommit.alreadySavedCount).toBe(1);
  });

  test('10 distinct-read-time captures of the same exam on the same day all save', async () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      reviewRow({
        source: study({
          modifiedDateTime: `2026-07-01T10:${String(i * 5).padStart(2, '0')}:00`,
          modifiedTime: `10:${String(i * 5).padStart(2, '0')}`,
        }),
      }),
    );

    const result = await commitPipelineResults(rows, '2026-07-01', 0, null);

    expect(result.importedCount).toBe(10);
    expect(result.alreadySavedCount).toBe(0);
  });
});

describe('commitPipelineResults — manual approval', () => {
  test('needsReview + manual_approved + a valid 26-modifier CPT saves the row', async () => {
    const row = reviewRow({
      needsReview: true,
      approvalStatus: 'manual_approved',
      source: study({ modifiedDateTime: '2026-07-01T11:05:00', modifiedTime: '11:05' }),
    });

    const result = await commitPipelineResults([row], '2026-07-01', 0, null);

    expect(result.importedCount).toBe(1);
    expect(result.blockedNoValidCptCount).toBe(0);
  });

  test('a row with no valid CPT candidate is counted in blockedNoValidCptCount, not reviewNeededCount', async () => {
    const row = reviewRow({
      needsReview: true,
      approvalStatus: 'pending',
      candidates: [candidate({ modifier: null, workRvu: 0 })],
      selectedCandidateIndex: 0,
      selectedCandidateIndices: [0],
    });

    const result = await commitPipelineResults([row], '2026-07-01', 0, null);

    expect(result.importedCount).toBe(0);
    expect(result.blockedNoValidCptCount).toBe(1);
    expect(result.reviewNeededCount).toBe(0);
  });
});
