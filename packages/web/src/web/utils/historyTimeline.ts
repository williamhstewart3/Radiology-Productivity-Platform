import type { StudyLog } from '../types';

export type HistoryLens = 'day' | 'month' | 'year' | 'custom';
export interface TimelineBucket { key: string; label: string; rvu: number; studies: number }
export interface CustomRange { start: string; end: string }

export function lensStart(lens: HistoryLens, today: string, dayLensDays = 7, customRange?: CustomRange): string {
  if (lens === 'custom') return customRange?.start ?? today;
  const date = new Date(`${today}T12:00:00`);
  if (lens === 'day') date.setDate(date.getDate() - (dayLensDays - 1));
  else if (lens === 'month') date.setDate(1);
  else date.setMonth(0, 1);
  return date.toISOString().slice(0, 10);
}

export function buildTimelineBuckets(lens: HistoryLens, logs: StudyLog[], today: string, dayLensDays = 7, customRange?: CustomRange): TimelineBucket[] {
  const counted = logs.filter((log) => !log.needsReview);
  if (lens === 'year') {
    const year = today.slice(0, 4);
    return Array.from({ length: 12 }, (_, index) => {
      const key = `${year}-${String(index + 1).padStart(2, '0')}`;
      const rows = counted.filter((log) => log.logDate.startsWith(key));
      return { key, label: new Date(`${key}-01T12:00:00`).toLocaleDateString('en-US', { month: 'short' }), rvu: rows.reduce((sum, log) => sum + (log.workRvu ?? 0), 0), studies: rows.length };
    });
  }
  const rangeEnd = lens === 'custom' ? (customRange?.end ?? today) : today;
  const start = new Date(`${lensStart(lens, today, dayLensDays, customRange)}T12:00:00`);
  const end = new Date(`${rangeEnd}T12:00:00`);
  const buckets: TimelineBucket[] = [];
  for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
    const key = date.toISOString().slice(0, 10);
    const rows = counted.filter((log) => log.logDate === key);
    buckets.push({
      key,
      label: date.toLocaleDateString('en-US', lens === 'day' ? { weekday: 'short' } : { month: 'short', day: 'numeric' }),
      rvu: rows.reduce((sum, log) => sum + (log.workRvu ?? 0), 0),
      studies: rows.length,
    });
  }
  return buckets;
}

export interface InsightStory {
  text: string;
  /** Below-threshold-but-still-shown stories (share-of-total under 7 days of data) render in a quieter tone -- no fanfare treatment. */
  muted: boolean;
}

/** A given weekday name appearing on N distinct dates has, by definition, been observed across N distinct calendar weeks. */
const WEEKDAY_PATTERN_MIN_WEEKS = 3;
const SHARE_OF_TOTAL_FANFARE_MIN_DAYS = 7;

/**
 * Every story here declares its own minimum sample and is simply omitted
 * below it -- "Mondays are your highest-output weekday" computed from one
 * Monday is not a pattern, it's noise wearing a confident sentence. When
 * nothing clears its bar, callers should show at most one honest
 * "still collecting" line instead of an empty band, never a thin-data claim.
 */
export function buildInsightStories(logs: StudyLog[]): InsightStory[] {
  const counted = logs.filter((log) => !log.needsReview);
  const total = counted.reduce((sum, log) => sum + (log.workRvu ?? 0), 0);
  if (!total) return [];
  const byModality = new Map<string, number>();
  const byWeekday = new Map<string, { total: number; days: Set<string> }>();
  const distinctDays = new Set<string>();
  for (const log of counted) {
    const rvu = log.workRvu ?? 0;
    const modality = log.modality ?? 'Other';
    byModality.set(modality, (byModality.get(modality) ?? 0) + rvu);
    const weekday = new Date(`${log.logDate}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long' });
    const entry = byWeekday.get(weekday) ?? { total: 0, days: new Set<string>() };
    entry.total += rvu;
    entry.days.add(log.logDate);
    byWeekday.set(weekday, entry);
    distinctDays.add(log.logDate);
  }
  const topModality = [...byModality.entries()].sort((a, b) => b[1] - a[1])[0];
  const topWeekday = [...byWeekday.entries()]
    .map(([day, value]) => ({ day, average: value.total / value.days.size, weeks: value.days.size }))
    .sort((a, b) => b.average - a.average)[0];

  const stories: InsightStory[] = [];
  if (topModality) {
    const muted = distinctDays.size < SHARE_OF_TOTAL_FANFARE_MIN_DAYS;
    stories.push({
      text: muted
        ? `So far, ${topModality[0]} is ${Math.round((topModality[1] / total) * 100)}% of your counted wRVUs.`
        : `${topModality[0]} accounts for ${Math.round((topModality[1] / total) * 100)}% of this period’s wRVUs.`,
      muted,
    });
  }
  if (topWeekday && topWeekday.weeks >= WEEKDAY_PATTERN_MIN_WEEKS) {
    stories.push({ text: `${topWeekday.day}s are your highest-output weekday at ${topWeekday.average.toFixed(1)} wRVU on average.`, muted: false });
  }
  return stories;
}
