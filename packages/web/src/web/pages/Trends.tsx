/**
 * Trends.tsx
 *
 * The Annual Dashboard, reorganized per the UI modernization spec: one chart,
 * one story per range. Reuses computePeriodTotals (unchanged) for headline
 * stats so they reconcile exactly with a direct Dexie query for the same
 * range/location/profile.
 */

import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Bar, BarChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { db } from '../db/database';
import { useOrg } from '../hooks/useOrg';
import { computePeriodTotals } from '../utils/calculations';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { GroupedList, Row } from '../components/ui/GroupedList';
import type { StudyLog } from '../types';

type Range = 'week' | 'month' | 'year';

function isDeleted(log: StudyLog): boolean {
  return Boolean((log as any).deletedAt);
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function rangeStart(range: Range, today: string): string {
  const d = new Date(today + 'T12:00:00');
  if (range === 'week') {
    d.setDate(d.getDate() - d.getDay());
  } else if (range === 'month') {
    d.setDate(1);
  } else {
    d.setMonth(0, 1);
  }
  return isoDate(d);
}

interface Bucket {
  key: string;
  label: string;
  rvu: number;
}

function buildBuckets(range: Range, logs: StudyLog[], today: string): Bucket[] {
  const byDate = new Map<string, number>();
  for (const log of logs) {
    if (log.needsReview) continue;
    byDate.set(log.logDate, (byDate.get(log.logDate) ?? 0) + (log.workRvu ?? 0));
  }

  if (range === 'year') {
    const year = today.slice(0, 4);
    const months = Array.from({ length: 12 }, (_, i) => {
      const key = `${year}-${String(i + 1).padStart(2, '0')}`;
      const label = new Date(`${key}-01T12:00:00`).toLocaleDateString('en-US', { month: 'short' });
      const rvu = [...byDate.entries()].filter(([date]) => date.startsWith(key)).reduce((sum, [, v]) => sum + v, 0);
      return { key, label, rvu };
    });
    return months;
  }

  const start = new Date(rangeStart(range, today) + 'T12:00:00');
  const end = new Date(today + 'T12:00:00');
  const days: Bucket[] = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const key = isoDate(d);
    days.push({
      key,
      label: d.toLocaleDateString('en-US', { weekday: range === 'week' ? 'short' : undefined, month: range === 'month' ? 'short' : undefined, day: range === 'month' ? 'numeric' : undefined } as Intl.DateTimeFormatOptions),
      rvu: byDate.get(key) ?? 0,
    });
  }
  return days;
}

interface TrendsProps {
  onNavigate: (path: string) => void;
}

export function Trends({ onNavigate }: TrendsProps) {
  const { activeProfile, locations, allRadiologists } = useOrg();
  const profileId = activeProfile?.id ?? null;
  const [range, setRange] = useState<Range>('week');
  const [locationFilter, setLocationFilter] = useState<string | null>(null);
  const settings = useLiveQuery(() => db.userSettings.get('default'), [], undefined);

  const today = useMemo(() => isoDate(new Date()), []);
  const start = useMemo(() => rangeStart(range, today), [range, today]);

  // StudyLog only carries profileId, not a location — filtering by location
  // means filtering by the set of profiles that belong to it.
  const locationProfileIds = useMemo(
    () => (locationFilter ? new Set(allRadiologists.filter((p) => p.practiceId === locationFilter).map((p) => p.id)) : null),
    [locationFilter, allRadiologists],
  );

  const rangeLogs = useLiveQuery(
    async () => {
      if (!profileId) return [];
      const all = await db.studyLogs.where('logDate').between(start, today, true, true).toArray();
      return all.filter(
        (log) =>
          !isDeleted(log) &&
          (locationProfileIds ? (log.profileId != null && locationProfileIds.has(log.profileId)) : (log.profileId === profileId || log.profileId == null)),
      );
    },
    [start, today, profileId, locationProfileIds],
    [],
  );

  const totals = computePeriodTotals(rangeLogs);
  const buckets = useMemo(() => buildBuckets(range, rangeLogs, today), [range, rangeLogs, today]);

  // Days elapsed in the range so far (inclusive of today), regardless of bucket granularity.
  const daysElapsed = Math.max(1, Math.round((new Date(today + 'T12:00:00').getTime() - new Date(start + 'T12:00:00').getTime()) / 86_400_000) + 1);
  const avgPerDay = totals.totalWorkRvu / daysElapsed;

  // Busiest DAY, computed from the logs directly regardless of chart bucket
  // granularity (year buckets by month, but "busiest day" still means a day).
  const busiest = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const log of rangeLogs) {
      if (log.needsReview) continue;
      byDay.set(log.logDate, (byDay.get(log.logDate) ?? 0) + (log.workRvu ?? 0));
    }
    let best: { date: string; rvu: number } | null = null;
    for (const [date, rvu] of byDay) {
      if (!best || rvu > best.rvu) best = { date, rvu };
    }
    return best;
  }, [rangeLogs]);

  const topCpts = useMemo(() => {
    const byCpt = new Map<string, { cptCode: string; description: string; rvu: number; count: number }>();
    for (const log of rangeLogs) {
      if (log.needsReview || !log.cptCode) continue;
      const key = log.cptCode;
      const entry = byCpt.get(key) ?? { cptCode: key, description: log.examTitleDisplay ?? log.examNameRaw, rvu: 0, count: 0 };
      entry.rvu += log.workRvu ?? 0;
      entry.count += 1;
      byCpt.set(key, entry);
    }
    return [...byCpt.values()].sort((a, b) => b.rvu - a.rvu).slice(0, 5);
  }, [rangeLogs]);

  const goalLine = range === 'year'
    ? (activeProfile?.annualRvuGoal ?? 0) / 12
    : (activeProfile?.dailyRvuGoal ?? 0);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-[34px] font-bold leading-tight text-rd-label-primary">Trends</h1>
        {locations.length > 1 && (
          <select
            value={locationFilter ?? ''}
            onChange={(e) => setLocationFilter(e.target.value || null)}
            className="h-9 rounded-[10px] border-none bg-rd-surface px-3 text-[13px] text-rd-label-primary"
            style={{ boxShadow: 'var(--rd-shadow-card)' }}
          >
            <option value="">All locations</option>
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>{loc.name}</option>
            ))}
          </select>
        )}
      </div>

      <SegmentedControl
        options={[
          { value: 'week', label: 'Week' },
          { value: 'month', label: 'Month' },
          { value: 'year', label: 'Year' },
        ]}
        value={range}
        onChange={setRange}
      />

      <div className="rounded-[16px] bg-rd-surface p-4" style={{ boxShadow: 'var(--rd-shadow-card)' }}>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={buckets} onClick={(e) => e?.activeLabel && onNavigate('/trends/history')}>
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--rd-label-secondary)' }} axisLine={false} tickLine={false} />
            <YAxis hide />
            <Tooltip
              formatter={(value) => [`${Number(value ?? 0).toFixed(1)} wRVU`, '']}
              contentStyle={{ background: 'var(--rd-surface)', border: 'none', borderRadius: 10, fontSize: 12 }}
            />
            {goalLine > 0 && <ReferenceLine y={goalLine} stroke="var(--rd-label-secondary)" strokeDasharray="4 4" />}
            <Bar dataKey="rvu" fill="var(--rd-accent)" radius={[4, 4, 0, 0]} cursor="pointer" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <GroupedList>
        <Row
          footnote={
            settings?.estimatedCompPerWrvu != null && settings.estimatedCompPerWrvu > 0
              ? `≈ $${(totals.totalWorkRvu * settings.estimatedCompPerWrvu).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
              : undefined
          }
          trailing={<span className="[font-variant-numeric:tabular-nums]">{totals.totalWorkRvu.toFixed(1)}</span>}
        >
          Total wRVUs
        </Row>
        <Row trailing={<span className="[font-variant-numeric:tabular-nums]">{totals.studyCount}</span>}>
          Studies
        </Row>
        <Row trailing={<span className="[font-variant-numeric:tabular-nums]">{avgPerDay.toFixed(1)}</span>}>
          Avg / day
        </Row>
        <Row trailing={<span className="[font-variant-numeric:tabular-nums]">{busiest && busiest.rvu > 0 ? `${new Date(busiest.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · ${busiest.rvu.toFixed(1)}` : '—'}</span>}>
          Busiest day
        </Row>
      </GroupedList>

      {topCpts.length > 0 && (
        <GroupedList header="Top CPT codes">
          {topCpts.map((c) => (
            <Row key={c.cptCode} footnote={c.description} trailing={<span className="[font-variant-numeric:tabular-nums]">{c.rvu.toFixed(1)}</span>}>
              {c.cptCode} · {c.count}×
            </Row>
          ))}
        </GroupedList>
      )}
    </div>
  );
}
