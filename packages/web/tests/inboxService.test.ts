import { describe, expect, test } from 'bun:test';
import { approveInboxRow, confidencePhrase } from '../src/web/services/inboxService';
import type { PipelineReviewRow } from '../src/web/pipeline/importPipeline';

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
