import { describe, expect, test } from 'bun:test';
import { topModalityShares } from '../src/web/utils/calculations';

describe('topModalityShares', () => {
  test('always sums to 100% of the input total, folding the remainder into "Other"', () => {
    const shares = topModalityShares({ CT: 60, XR: 20, US: 10, MRI: 5, NM_PET: 3, MAMMO: 2 }, 4);
    const total = shares.reduce((sum, share) => sum + share.percent, 0);
    expect(total).toBeCloseTo(100, 5);
    expect(shares.length).toBe(5); // top 4 + Other
    expect(shares.at(-1)?.label).toBe('Other');
  });

  test('returns nothing for an all-zero or empty distribution', () => {
    expect(topModalityShares({})).toEqual([]);
    expect(topModalityShares({ CT: 0, XR: 0 })).toEqual([]);
  });

  test('sorts by share descending and omits zero-wRVU modalities entirely', () => {
    const shares = topModalityShares({ CT: 10, XR: 0, US: 30 });
    expect(shares.map((s) => s.modality)).toEqual(['US', 'CT']);
  });

  test('no remainder slice when everything fits within max', () => {
    const shares = topModalityShares({ CT: 10, XR: 5 }, 4);
    expect(shares.length).toBe(2);
    expect(shares.reduce((sum, s) => sum + s.percent, 0)).toBeCloseTo(100, 5);
  });
});
