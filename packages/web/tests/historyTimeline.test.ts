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
    expect(buildInsightStories(logs)[0].text).toContain('83%');
  });

  test('the Day lens defaults to a 7-day window, unchanged from before the density pass', () => {
    expect(lensStart('day', '2026-07-12')).toBe('2026-07-06');
    expect(buildTimelineBuckets('day', logs, '2026-07-12').length).toBe(7);
  });

  test('an explicit dayLensDays extends the window without touching the default caller', () => {
    expect(lensStart('day', '2026-07-12', 14)).toBe('2026-06-29');
    expect(buildTimelineBuckets('day', logs, '2026-07-12', 14).length).toBe(14);
  });

  test('the custom lens buckets exactly the given range, inclusive, regardless of dayLensDays', () => {
    const range = { start: '2026-07-10', end: '2026-07-12' };
    expect(lensStart('custom', '2026-07-12', 7, range)).toBe('2026-07-10');
    const buckets = buildTimelineBuckets('custom', logs, '2026-07-12', 7, range);
    expect(buckets.length).toBe(3);
    expect(buckets.map((b) => b.key)).toEqual(['2026-07-10', '2026-07-11', '2026-07-12']);
    expect(buckets.reduce((sum, b) => sum + b.rvu, 0)).toBe(6);
  });

  test('custom lens without a range falls back to today, not a crash', () => {
    expect(lensStart('custom', '2026-07-12')).toBe('2026-07-12');
  });
});

describe('buildInsightStories minimum-sample gates', () => {
  test('a single day of data produces zero weekday-pattern claims', () => {
    const oneDayLogs = [log('1', '2026-07-13', 3, 'CT'), log('2', '2026-07-13', 2, 'CT')];
    const stories = buildInsightStories(oneDayLogs);
    expect(stories.some((s) => s.text.includes('highest-output weekday'))).toBe(false);
  });

  test('a single day of data still surfaces a muted share-of-total story (not a pattern claim)', () => {
    const oneDayLogs = [log('1', '2026-07-13', 3, 'CT'), log('2', '2026-07-13', 2, 'CT')];
    const stories = buildInsightStories(oneDayLogs);
    expect(stories).toHaveLength(1);
    expect(stories[0].muted).toBe(true);
    expect(stories[0].text).toContain('So far');
  });

  test('a weekday seen on only 2 distinct dates (< 3 weeks) does not produce a weekday-pattern claim', () => {
    const twoMondays = [
      log('1', '2026-06-29', 5, 'CT'), // Monday
      log('2', '2026-07-06', 5, 'CT'), // Monday
      log('3', '2026-06-30', 1, 'XR'), // Tuesday
    ];
    const stories = buildInsightStories(twoMondays);
    expect(stories.some((s) => s.text.includes('highest-output weekday'))).toBe(false);
  });

  test('a weekday seen on 3 distinct dates (3 distinct weeks) produces a weekday-pattern claim', () => {
    const threeMondays = [
      log('1', '2026-06-22', 5, 'CT'),
      log('2', '2026-06-29', 5, 'CT'),
      log('3', '2026-07-06', 5, 'CT'),
      log('4', '2026-06-23', 1, 'XR'),
    ];
    const stories = buildInsightStories(threeMondays);
    const weekdayStory = stories.find((s) => s.text.includes('highest-output weekday'));
    expect(weekdayStory).toBeDefined();
    expect(weekdayStory!.text).toContain('Mondays');
  });

  test('share-of-total drops the fanfare tone (muted) below 7 distinct days of data', () => {
    const sixDays = Array.from({ length: 6 }, (_, i) => log(`${i}`, `2026-07-0${i + 1}`, 1, 'CT'));
    const stories = buildInsightStories(sixDays);
    const shareStory = stories.find((s) => s.text.includes('%'));
    expect(shareStory!.muted).toBe(true);
  });

  test('share-of-total uses the confident fanfare tone at 7+ distinct days of data', () => {
    const sevenDays = Array.from({ length: 7 }, (_, i) => log(`${i}`, `2026-07-0${i + 1}`, 1, 'CT'));
    const stories = buildInsightStories(sevenDays);
    const shareStory = stories.find((s) => s.text.includes('%'));
    expect(shareStory!.muted).toBe(false);
    expect(shareStory!.text).toContain('accounts for');
  });

  test('no data produces no stories at all', () => {
    expect(buildInsightStories([])).toEqual([]);
  });
});
