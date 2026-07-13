import { describe, expect, test } from 'bun:test';
import { buildInsightStories, buildTimelineBuckets, lensStart } from '../src/web/utils/historyTimeline';
import type { StudyLog } from '../src/web/types';

function log(id: string, date: string, rvu: number, modality: 'CT' | 'XR'): StudyLog {
  return { id, logDate: date, workRvu: rvu, modality, needsReview: false } as StudyLog;
}

describe('History timeline', () => {
  const logs = [log('1', '2026-07-11', 3, 'CT'), log('2', '2026-07-11', 1, 'XR'), log('3', '2026-07-12', 2, 'CT')];

  test('bucket totals reconcile to the same visible rows', () => {
    const buckets = buildTimelineBuckets('day', logs, '2026-07-12');
    expect(buckets.reduce((sum, bucket) => sum + bucket.rvu, 0)).toBe(6);
    expect(buckets.reduce((sum, bucket) => sum + bucket.studies, 0)).toBe(3);
  });

  test('stories cite only values derived from the same rows', () => {
    expect(buildInsightStories(logs)[0]).toContain('83%');
  });

  test('the Day lens defaults to a 7-day window, unchanged from before the density pass', () => {
    expect(lensStart('day', '2026-07-12')).toBe('2026-07-06');
    expect(buildTimelineBuckets('day', logs, '2026-07-12').length).toBe(7);
  });

  test('an explicit dayLensDays extends the window without touching the default caller', () => {
    expect(lensStart('day', '2026-07-12', 14)).toBe('2026-06-29');
    expect(buildTimelineBuckets('day', logs, '2026-07-12', 14).length).toBe(14);
  });
});
