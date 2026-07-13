import { describe, expect, test } from 'bun:test';
import { computePeriodTotals, topModalityShares } from '../src/web/utils/calculations';
import type { StudyLog } from '../src/web/types';

function log(id: string, logDate: string, cptCode: string, rvu: number, needsReview = false): StudyLog {
  return { id, logDate, cptCode, workRvu: rvu, needsReview } as StudyLog;
}

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

describe('computePeriodTotals — the restored History period header', () => {
  test('busiestDay picks the day with the highest counted wRVU total', () => {
    const totals = computePeriodTotals([
      log('a', '2026-07-01', '74177', 2),
      log('b', '2026-07-02', '74177', 3),
      log('c', '2026-07-02', '71046', 1),
    ]);
    expect(totals.busiestDay).toEqual({ date: '2026-07-02', rvu: 4 });
  });

  test('busiestDay is null when there are no counted logs', () => {
    expect(computePeriodTotals([]).busiestDay).toBeNull();
    expect(computePeriodTotals([log('a', '2026-07-01', '74177', 5, true)]).busiestDay).toBeNull();
  });

  test('avgRvuPerDay divides by the explicit day count when given (calendar days, not just active ones)', () => {
    const totals = computePeriodTotals([log('a', '2026-07-01', '74177', 30)], 3);
    expect(totals.avgRvuPerDay).toBeCloseTo(10, 5);
  });

  test('avgRvuPerDay falls back to the active-day count when daysInRange is omitted', () => {
    const totals = computePeriodTotals([log('a', '2026-07-01', '74177', 10), log('b', '2026-07-02', '74177', 10)]);
    expect(totals.avgRvuPerDay).toBeCloseTo(10, 5);
  });

  test('topCpts ranks by total wRVU (not frequency) and caps at 5', () => {
    const totals = computePeriodTotals([
      log('a1', '2026-07-01', '71046', 0.2),
      log('a2', '2026-07-01', '71046', 0.2),
      log('a3', '2026-07-01', '71046', 0.2),
      log('b', '2026-07-01', '74177', 3.15),
    ]);
    expect(totals.topCpts[0].cptCode).toBe('74177');
    expect(totals.topCpts[0].count).toBe(1);
    expect(totals.topCpts[0].totalRvu).toBeCloseTo(3.15, 5);
    expect(totals.topCpts[1].cptCode).toBe('71046');
    expect(totals.topCpts[1].count).toBe(3);
    expect(totals.topCpts[1].totalRvu).toBeCloseTo(0.6, 5);
  });

  test('topCpts excludes needsReview rows, same as the rest of the header', () => {
    const totals = computePeriodTotals([log('a', '2026-07-01', '74177', 99, true)]);
    expect(totals.topCpts).toEqual([]);
  });
});
