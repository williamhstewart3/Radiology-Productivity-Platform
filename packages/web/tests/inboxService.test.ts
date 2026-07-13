import { describe, expect, test } from 'bun:test';
import { approveInboxRow, buildExistingStudyTouchPatch, confidencePhrase, formatInboxAccounting, mergeInboxCandidateSelection, summarizeInboxAccounting } from '../src/web/services/inboxService';
import { selectedCandidatesForRow, type PipelineReviewRow } from '../src/web/pipeline/importPipeline';
import type { MatchCandidate, StudyLog } from '../src/web/types';

function pendingRow(duplicateStatus: PipelineReviewRow['duplicateStatus'], hasCandidate: boolean): PipelineReviewRow {
  return {
    candidates: hasCandidate
      ? [{ cptCode: '74177', modifier: '26', description: 'CT abd/pelvis', workRvu: 3.15, modality: 'CT', confidence: 0.8, method: 'radiology_match' }]
      : [],
    selectedCandidateIndex: hasCandidate ? 0 : null,
    selectedCandidateIndices: hasCandidate ? [0] : [],
    duplicateStatus,
    included: true,
    autoSkipped: false,
    needsReview: true,
  } as PipelineReviewRow;
}

describe('Inbox confidence language', () => {
  test('maps every matcher situation to a human phrase', () => {
    expect(confidencePhrase('alias_match', true)).toBe('Learned match');
    expect(confidencePhrase('manual_cpt', true)).toBe('Direct match');
    expect(confidencePhrase('ocr_match', true)).toBe('Protocol match');
    expect(confidencePhrase('radiology_match', true)).toBe('Fuzzy match — worth a look');
    expect(confidencePhrase(undefined, false)).toBe('No confident match');
  });

  test('approval preserves the pipeline row contract', () => {
    const row = {
      candidates: [{ cptCode: '70450', modifier: '26', description: 'CT head', workRvu: 0.83, modality: 'CT', confidence: 0.8, method: 'radiology_match' }],
      selectedCandidateIndex: 0,
      selectedCandidateIndices: [0],
      duplicateStatus: 'possible',
      included: true,
      autoSkipped: false,
      needsReview: true,
    } as PipelineReviewRow;
    expect(approveInboxRow(row)).toMatchObject({ needsReview: false, approvalStatus: 'approved_as_new' });
  });
});

describe('summarizeInboxAccounting — the permanent batch-accounting line', () => {
  test('null when there is no active session or it is empty', () => {
    expect(summarizeInboxAccounting(null, [])).toBeNull();
    expect(summarizeInboxAccounting({ totalExams: 0, needsReviewCount: 0, confirmedWrvu: 0 }, [])).toBeNull();
  });

  test('readyCount is totalExams minus needsReviewCount, readyWrvu is the session confirmedWrvu directly', () => {
    const summary = summarizeInboxAccounting({ totalExams: 11, needsReviewCount: 2, confirmedWrvu: 27.45 }, []);
    expect(summary).toMatchObject({ totalRows: 11, readyCount: 9, readyWrvu: 27.45 });
  });

  test('possibleDuplicateCount and needsCptCount are counted from the pending rows, mutually exclusive', () => {
    const pending = [
      pendingRow('possible', true), // possible duplicate
      pendingRow(null, false), // needs CPT
      pendingRow(null, true), // ordinary review row — neither bucket
    ];
    const summary = summarizeInboxAccounting({ totalExams: 11, needsReviewCount: 3, confirmedWrvu: 12.6 }, pending);
    expect(summary).toMatchObject({ possibleDuplicateCount: 1, needsCptCount: 1 });
  });

  test('a possible-duplicate row with no candidate is not double-counted as needing a CPT', () => {
    const summary = summarizeInboxAccounting({ totalExams: 1, needsReviewCount: 1, confirmedWrvu: 0 }, [pendingRow('possible', false)]);
    expect(summary).toMatchObject({ possibleDuplicateCount: 1, needsCptCount: 0 });
  });
});

describe('mergeInboxCandidateSelection — the Change code picker\'s commit path', () => {
  function candidate(cptCode: string, workRvu: number, modifier: string | null = '26'): MatchCandidate {
    return { cptCode, modifier, description: `Desc ${cptCode}`, workRvu, modality: 'CT', confidence: 1, method: 'manual_cpt' };
  }

  test('a single searched code not already in row.candidates gets appended and selected', () => {
    const row = pendingRow(null, true); // one existing candidate: 74177
    const picked = candidate('71046', 0.4);
    const merged = mergeInboxCandidateSelection(row, [picked]);
    expect(merged.candidates).toHaveLength(2);
    expect(merged.selectedCandidateIndices).toEqual([1]);
    expect(selectedCandidatesForRow(merged)).toEqual([picked]);
  });

  test('picking a code identical to an existing candidate (by cptCode+modifier) reuses its index instead of duplicating', () => {
    const row = pendingRow(null, true); // candidates[0] is cptCode 74177/26
    const sameCode = candidate('74177', 3.15, '26');
    const merged = mergeInboxCandidateSelection(row, [sameCode]);
    expect(merged.candidates).toHaveLength(1);
    expect(merged.selectedCandidateIndices).toEqual([0]);
  });

  test('multi-select: two picked codes both merge in and both get selected, in order', () => {
    const row = pendingRow(null, false); // no existing candidates
    const a = candidate('74176', 2.5);
    const b = candidate('74177', 3.15);
    const merged = mergeInboxCandidateSelection(row, [a, b]);
    expect(merged.candidates).toEqual([a, b]);
    expect(merged.selectedCandidateIndices).toEqual([0, 1]);
    expect(selectedCandidatesForRow(merged).reduce((sum, c) => sum + (c.workRvu ?? 0), 0)).toBeCloseTo(5.65);
  });

  test('marks the row pending review again so the radiologist still confirms the new pick before it commits', () => {
    const row = { ...pendingRow(null, true), needsReview: false, approvalStatus: 'auto_approved' as const };
    const merged = mergeInboxCandidateSelection(row, [candidate('71046', 0.4)]);
    expect(merged.needsReview).toBe(true);
    expect(merged.approvalStatus).toBe('pending');
  });

  test('does not mutate the original row\'s candidates array', () => {
    const row = pendingRow(null, true);
    const originalCandidates = row.candidates;
    mergeInboxCandidateSelection(row, [candidate('71046', 0.4)]);
    expect(row.candidates).toBe(originalCandidates);
    expect(row.candidates).toHaveLength(1);
  });
});

describe('buildExistingStudyTouchPatch — the "Update existing" verb\'s field-level rules', () => {
  function duplicateRow(overrides: Partial<PipelineReviewRow['source']> = {}, displayTitle?: string): PipelineReviewRow {
    return {
      ...pendingRow('possible', true),
      duplicateExistingLogId: 'existing_1',
      displayTitle,
      source: {
        examTitle: 'CT ABDOMEN PELVIS WITH CONTRAST',
        procedureName: 'CT Abdomen Pelvis with Contrast',
        examDateTime: '2026-07-13T14:00:00.000Z',
        studyTime: '2026-07-13T14:00:00.000Z',
        modifiedDateTime: '2026-07-13T18:30:00.000Z',
        source: 'powerscribe',
        ...overrides,
      },
    } as PipelineReviewRow;
  }

  function existing(overrides: Partial<StudyLog> = {}): StudyLog {
    return {
      id: 'existing_1', profileId: null, logDate: '2026-07-13',
      studyDateTime: '2026-07-13T14:05:00.000Z', examDateTime: '2026-07-13T14:00:00.000Z', studyDate: '2026-07-13',
      dateTimeConfidence: 1, dateTimeSource: 'ocr', examNameRaw: 'CT ABDOMEN PELVIS WITH CONTRAST',
      examTitleDisplay: 'CT ABDOMEN PELVIS WITH CONTRAST', cptCode: '74177', modifier: '26', workRvu: 3.15,
      modality: 'CT', matchMethod: 'manual_cpt', matchConfidence: 1, needsReview: false, sessionId: null,
      sourceImportId: null, notes: null, studyFingerprint: 'weak:x',
      createdAt: '2026-07-13T14:10:00.000Z', updatedAt: '2026-07-13T14:10:00.000Z',
      ...overrides,
    } as StudyLog;
  }

  test('refreshes the Modified/read time when the incoming capture is newer', () => {
    const patch = buildExistingStudyTouchPatch(duplicateRow(), existing());
    expect(patch.studyDateTime).toBe('2026-07-13T18:30:00.000Z');
  });

  test('never touches workRvu or cptCode -- those fields are absent from the patch entirely', () => {
    const patch = buildExistingStudyTouchPatch(duplicateRow(), existing());
    expect(patch).not.toHaveProperty('workRvu');
    expect(patch).not.toHaveProperty('cptCode');
  });

  test('resolves a display name when the existing record was never manually cleaned up (display == raw)', () => {
    const patch = buildExistingStudyTouchPatch(duplicateRow({}, 'CT Abdomen Pelvis with Contrast'), existing());
    expect(patch.examTitleDisplay).toBe('CT Abdomen Pelvis with Contrast');
  });

  test('never clobbers a radiologist\'s earlier manual rename', () => {
    const patch = buildExistingStudyTouchPatch(
      duplicateRow({}, 'CT Abdomen Pelvis with Contrast'),
      existing({ examTitleDisplay: 'Appendicitis protocol CT' }),
    );
    expect(patch.examTitleDisplay).toBeUndefined();
  });

  test('empty patch when nothing actually changed', () => {
    const patch = buildExistingStudyTouchPatch(
      duplicateRow({ modifiedDateTime: '2026-07-13T14:05:00.000Z' }, 'CT Abdomen Pelvis with Contrast'),
      existing({ studyDateTime: '2026-07-13T14:05:00.000Z', examTitleDisplay: 'CT Abdomen Pelvis with Contrast' }),
    );
    expect(patch).toEqual({});
  });
});

describe('formatInboxAccounting', () => {
  test('shows the ready wRVU total (the auto-approved batch summary), omits zero-value duplicate/CPT segments', () => {
    expect(formatInboxAccounting({ totalRows: 11, readyCount: 9, readyWrvu: 27.4, possibleDuplicateCount: 0, needsCptCount: 0 }))
      .toBe('11 rows · 9 ready (+27.4 wRVU)');
  });

  test('appends non-zero segments, matching the spec\'s example line', () => {
    expect(formatInboxAccounting({ totalRows: 11, readyCount: 9, readyWrvu: 27.4, possibleDuplicateCount: 1, needsCptCount: 1 }))
      .toBe('11 rows · 9 ready (+27.4 wRVU) · 1 possible duplicate · 1 needs CPT');
  });

  test('omits the wRVU parenthetical when nothing is ready yet', () => {
    expect(formatInboxAccounting({ totalRows: 2, readyCount: 0, readyWrvu: 0, possibleDuplicateCount: 2, needsCptCount: 0 }))
      .toBe('2 rows · 0 ready · 2 possible duplicates');
  });

  test('singular/plural agreement on rows', () => {
    expect(formatInboxAccounting({ totalRows: 1, readyCount: 1, readyWrvu: 3.4, possibleDuplicateCount: 0, needsCptCount: 0 }))
      .toBe('1 row · 1 ready (+3.4 wRVU)');
  });
});
