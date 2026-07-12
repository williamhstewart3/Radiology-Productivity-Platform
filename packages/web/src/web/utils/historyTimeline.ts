import type { StudyLog } from '../types';

export type HistoryLens = 'day' | 'month' | 'year';
export interface TimelineBucket { key: string; label: string; rvu: number; studies: number }

export function lensStart(lens: HistoryLens, today: string): string {
  const date = new Date(`${today}T12:00:00`);
  if (lens === 'day') date.setDate(date.getDate() - 6);
  else if (lens === 'month') date.setDate(1);
  else date.setMonth(0, 1);
  return date.toISOString().slice(0, 10);
}

export function buildTimelineBuckets(lens: HistoryLens, logs: StudyLog[], today: string): TimelineBucket[] {
  const counted = logs.filter((log) => !log.needsReview);
  if (lens === 'year') {
    const year = today.slice(0, 4);
    return Array.from({ length: 12 }, (_, index) => {
      const key = `${year}-${String(index + 1).padStart(2, '0')}`;
      const rows = counted.filter((log) => log.logDate.startsWith(key));
      return { key, label: new Date(`${key}-01T12:00:00`).toLocaleDateString('en-US', { month: 'short' }), rvu: rows.reduce((sum, log) => sum + (log.workRvu ?? 0), 0), studies: rows.length };
    });
  }
  const start = new Date(`${lensStart(lens, today)}T12:00:00`);
  const end = new Date(`${today}T12:00:00`);
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

export function buildInsightStories(logs: StudyLog[]): string[] {
  const counted = logs.filter((log) => !log.needsReview);
  const total = counted.reduce((sum, log) => sum + (log.workRvu ?? 0), 0);
  if (!total) return [];
  const byModality = new Map<string, number>();
  const byWeekday = new Map<string, { total: number; days: Set<string> }>();
  for (const log of counted) {
    const rvu = log.workRvu ?? 0;
    const modality = log.modality ?? 'Other';
    byModality.set(modality, (byModality.get(modality) ?? 0) + rvu);
    const weekday = new Date(`${log.logDate}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long' });
    const entry = byWeekday.get(weekday) ?? { total: 0, days: new Set<string>() };
    entry.total += rvu;
    entry.days.add(log.logDate);
    byWeekday.set(weekday, entry);
  }
  const topModality = [...byModality.entries()].sort((a, b) => b[1] - a[1])[0];
  const topWeekday = [...byWeekday.entries()].map(([day, value]) => ({ day, average: value.total / value.days.size })).sort((a, b) => b.average - a.average)[0];
  return [
    topModality ? `${topModality[0]} accounts for ${Math.round((topModality[1] / total) * 100)}% of this period’s wRVUs.` : '',
    topWeekday ? `${topWeekday.day}s are your highest-output weekday at ${topWeekday.average.toFixed(1)} wRVU on average.` : '',
  ].filter(Boolean);
}
