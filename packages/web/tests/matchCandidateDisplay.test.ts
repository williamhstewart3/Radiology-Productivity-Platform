import { describe, expect, test } from 'bun:test';
import { matchCandidateDisplayTitle } from '../src/web/utils/matchCandidateDisplay';

describe('approval candidate titles', () => {
  test('shows the institutional title instead of the CMS billing descriptor', () => {
    expect(matchCandidateDisplayTitle({
      description: 'MR neck spine w/ dye',
      displayTitle: 'MRI CERVICAL SPINE W CONTRAST',
    })).toBe('MRI CERVICAL SPINE W CONTRAST');
  });

  test('falls back to the official description when no local title exists', () => {
    expect(matchCandidateDisplayTitle({ description: 'MR neck spine w/ dye' })).toBe('MR neck spine w/ dye');
  });

  test('repairs an institutional candidate saved before display titles were added', () => {
    expect(matchCandidateDisplayTitle({
      description: 'MR neck spine w/ dye',
      explanation: {
        rawText: 'MRI CERVICAL SPINE W CONTRAST',
        normalizedText: 'mri cervical spine w contrast',
        source: 'Institution procedure dictionary',
        detail: 'legacy candidate',
      },
    }, 'MRI CERVICAL SPINE W CONTRAST')).toBe('MRI CERVICAL SPINE W CONTRAST');
  });
});
