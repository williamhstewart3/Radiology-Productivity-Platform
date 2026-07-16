import { describe, expect, test } from 'bun:test';
import { evaluateCommitDecision } from '../src/web/pipeline/importPipeline';
import type { MatchCandidate } from '../src/web/types';
import type { ImportedStudy } from '../src/web/types/importProvider';

function study(patch: Partial<ImportedStudy> = {}): ImportedStudy {
  return {
    examTitle: 'CT CHEST W CONTRAST', procedureName: 'CT CHEST W CONTRAST', canonicalExam: null, cpt: null, workRvu: null,
    studyDate: '2026-07-16', examDate: '2026-07-16', examTime: '08:47', examDateTime: '2026-07-16T08:47:00',
    studyTime: null, modifiedDate: null, modifiedTime: null, modifiedDateTime: null, modality: 'CT', accessionNumber: null,
    patientMRN: null, extractionConfidence: 1, parserNeedsReview: false, parserReviewReason: null,
    source: 'report_capture', captureProfileId: 'p1', captureSiteId: 's1', importedAt: '2026-07-16T08:48:00.000Z',
    dateTimeConfidence: 1, dateTimeSource: 'ocr', ...patch,
  };
}

function candidate(source: string, patch: Partial<MatchCandidate> = {}): MatchCandidate {
  return {
    cptCode: '71260', modifier: '26', description: 'CT thorax with contrast', workRvu: 1.16, modality: 'CT',
    confidence: 1, method: 'alias_match', explanation: { rawText: '', normalizedText: '', source, detail: source }, ...patch,
  };
}

function decide(candidates: MatchCandidate[], patch: Partial<Parameters<typeof evaluateCommitDecision>[0]> = {}) {
  return evaluateCommitDecision({
    study: study(), candidates, selectedCandidates: candidates, duplicateStatus: null, parserNeedsReview: false,
    matchReviewReason: null, profileId: 'p1', siteId: 's1', ...patch,
  });
}

describe('provenance-based commit decision', () => {
  test('exact confirmed single and multi-CPT aliases are deterministic', () => {
    expect(decide([candidate('exact confirmed alias')]).autoCommit).toBe(true);
    const combo = [candidate('exact confirmed alias'), candidate('exact confirmed alias', { cptCode: '74177', workRvu: 3.15 })];
    expect(decide(combo)).toMatchObject({ certainty: 'deterministic', autoCommit: true });
  });

  test('fuzzy confidence 1.0 is still pending', () => {
    expect(decide([candidate('fuzzy learned alias')])).toMatchObject({ certainty: 'high_confidence', autoCommit: false });
  });

  test('exact institutional mapping is deterministic only by method detail', () => {
    const exact = candidate('Institution procedure dictionary', {
      method: 'radiology_match', confidence: 0.995,
      explanation: { rawText: '', normalizedText: '', source: 'Institution procedure dictionary', detail: 'exact_institution_match' },
    });
    expect(decide([exact]).autoCommit).toBe(true);
    const merelyPerfect = { ...exact, confidence: 1, explanation: { ...exact.explanation!, detail: 'ocr_tolerant_institution_match' } };
    expect(decide([merelyPerfect]).autoCommit).toBe(false);
  });

  test('duplicate, invalid timestamp, and scope drift block silent commit', () => {
    const exact = candidate('exact confirmed alias');
    expect(decide([exact], { duplicateStatus: 'possible' }).autoCommit).toBe(false);
    expect(decide([exact], { study: study({ examDateTime: null, dateTimeConfidence: 0 }) }).autoCommit).toBe(false);
    expect(decide([exact], { siteId: 'different-site' }).autoCommit).toBe(false);
  });

  test('conflicting exact alias and institution CPT sets require review', () => {
    const alias = candidate('exact confirmed alias');
    const institution = candidate('Institution procedure dictionary', {
      cptCode: '71250', method: 'radiology_match', confidence: 0.995,
      explanation: { rawText: '', normalizedText: '', source: 'Institution procedure dictionary', detail: 'exact_institution_match' },
    });
    expect(decide([alias, institution], { selectedCandidates: [institution] })).toMatchObject({ certainty: 'ambiguous', autoCommit: false });
  });

  test('an incomplete stored multi-CPT alias never auto-commits a partial set', () => {
    const incomplete = candidate('exact confirmed alias', {
      explanation: { rawText: '', normalizedText: '', source: 'exact confirmed alias', detail: 'aliasCptSet=71260-26|74177-26' },
    });
    expect(decide([incomplete])).toMatchObject({ certainty: 'ambiguous', autoCommit: false });
  });
});
