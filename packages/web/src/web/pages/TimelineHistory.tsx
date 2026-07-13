import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Bar, BarChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { db } from '../db/database';
import { useOrg } from '../hooks/useOrg';
import { computeByModality, computePeriodTotals, computeYtdStats, topModalityShares } from '../utils/calculations';
import { buildInsightStories, buildTimelineBuckets, lensStart, type CustomRange, type HistoryLens } from '../utils/historyTimeline';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { MatchSourceFootnote } from '../components/ui/MatchSourceFootnote';
import type { CptRvuRow, StudyLog } from '../types';

function isDeleted(log: StudyLog): boolean { return Boolean((log as StudyLog & { deletedAt?: string }).deletedAt); }
function title(log: StudyLog): string { return log.examTitleDisplay?.trim() || log.examNameRaw; }
function shortDate(date: string): string { return new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }

function DayGoalBar({ rvu, goal }: { rvu: number; goal: number }) {
  if (goal <= 0) return null;
  const percent = Math.min(150, (rvu / goal) * 100);
  const tickPercent = (100 / 150) * 100;
  return (
    <div className="relative h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-rd-surface-2">
      <span className="sr-only">{rvu.toFixed(1)} of {goal} wRVU goal</span>
      <div
        aria-hidden="true"
        className="absolute inset-y-0 left-0 rounded-full bg-rd-label-primary"
        style={{ width: `${(percent / 150) * 100}%`, opacity: rvu >= goal ? 1 : 0.55 }}
      />
      <div aria-hidden="true" className="absolute inset-y-0 w-px bg-rd-separator" style={{ left: `${tickPercent}%` }} />
    </div>
  );
}

export function TimelineHistory({ onOpenLegacy }: { onOpenLegacy: () => void }) {
  const { activeProfile } = useOrg();
  const profileId = activeProfile?.id ?? null;
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const initialParams = new URLSearchParams(window.location.search);
  const initialLens = initialParams.get('lens');
  const [lens, setLens] = useState<HistoryLens>(initialLens === 'year' ? 'year' : initialLens === 'month' ? 'month' : 'day');
  const [drillDate, setDrillDate] = useState<string | null>(initialParams.get('date'));
  const [storyOpen, setStoryOpen] = useState<number | null>(null);
  const [customStart, setCustomStart] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [customEnd, setCustomEnd] = useState(today);
  const customRange: CustomRange = useMemo(() => ({ start: customStart || today, end: customEnd || today }), [customStart, customEnd, today]);
  const start = lensStart(lens, today, 7, customRange);
  const rangeEnd = lens === 'custom' ? customRange.end : today;

  const logs = useLiveQuery(async () => {
    if (!profileId) return [];
    const rows = await db.studyLogs.where('logDate').between(start, rangeEnd, true, true).toArray();
    return rows.filter((log) => !isDeleted(log) && (log.profileId === profileId || log.profileId == null));
  }, [start, rangeEnd, profileId], []);
  const settings = useLiveQuery(() => db.userSettings.get('default'), [], undefined);
  const currentRows = useLiveQuery(() => db.cptRvuTable.where('statusCategory').equals('active').toArray(), [], [] as CptRvuRow[]);
  const currentByCode = useMemo(() => new Map(currentRows.map((row) => [`${row.cptCode}-${row.modifier}`, row])), [currentRows]);
  const visibleLogs = drillDate ? logs.filter((log) => log.logDate === drillDate) : logs;
  const daysInRange = Math.max(1, Math.round((new Date(`${rangeEnd}T12:00:00`).getTime() - new Date(`${start}T12:00:00`).getTime()) / 86_400_000) + 1);
  const totals = computePeriodTotals(visibleLogs, drillDate ? undefined : daysInRange);
  const buckets = useMemo(() => buildTimelineBuckets(lens, logs, today, 7, customRange), [lens, logs, today, customRange]);
  const stories = useMemo(() => buildInsightStories(logs), [logs]);
  const grouped = useMemo(() => {
    const map = new Map<string, StudyLog[]>();
    for (const log of visibleLogs) map.set(log.logDate, [...(map.get(log.logDate) ?? []), log]);
    for (const rows of map.values()) rows.sort((a, b) => (b.studyDateTime ?? b.createdAt).localeCompare(a.studyDateTime ?? a.createdAt));
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [visibleLogs]);
  const ytd = lens === 'year' && settings ? computeYtdStats(logs, settings) : null;
  const goalLine = lens === 'year' ? (activeProfile?.annualRvuGoal ?? 0) / 12 : (activeProfile?.dailyRvuGoal ?? 0);
  const dailyGoal = activeProfile?.dailyRvuGoal ?? 0;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[34px] font-bold text-rd-label-primary">History</h1>
          <p className="text-[17px] text-rd-label-secondary">{totals.totalWorkRvu.toFixed(1)} wRVU · {totals.studyCount} studies{ytd ? ` · projected ${ytd.projectedYearEnd.toFixed(0)} year-end` : ''}</p>
          <p className="text-[13px] text-rd-label-secondary [font-variant-numeric:tabular-nums]">
            {totals.avgRvuPerDay.toFixed(1)}/day avg
            {totals.busiestDay && ` · busiest ${shortDate(totals.busiestDay.date)} (${totals.busiestDay.rvu.toFixed(1)})`}
            {totals.topCpts.length > 0 && ` · top: ${totals.topCpts.map((cpt) => `${cpt.cptCode} ×${cpt.count}`).join(', ')}`}
          </p>
        </div>
        <button type="button" onClick={onOpenLegacy} className="min-h-11 text-[13px] text-rd-label-secondary underline underline-offset-4">Search, edit, or export</button>
      </div>
      <SegmentedControl options={[{ value: 'day', label: 'Day' }, { value: 'month', label: 'Month' }, { value: 'year', label: 'Year' }, { value: 'custom', label: 'Custom' }]} value={lens} onChange={(value) => { setLens(value); setDrillDate(null); }} />
      {lens === 'custom' && (
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="history-range-start" className="mb-1 block text-[12px] text-rd-label-secondary">From</label>
            <input
              id="history-range-start"
              aria-label="Range start"
              type="date"
              value={customStart}
              max={customEnd}
              onChange={(e) => setCustomStart(e.target.value)}
              className="rounded-[10px] border border-rd-separator bg-rd-surface-2 px-3 py-2 text-[13px] text-rd-label-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rd-label-primary"
            />
          </div>
          <div>
            <label htmlFor="history-range-end" className="mb-1 block text-[12px] text-rd-label-secondary">To</label>
            <input
              id="history-range-end"
              aria-label="Range end"
              type="date"
              value={customEnd}
              min={customStart}
              max={today}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="rounded-[10px] border border-rd-separator bg-rd-surface-2 px-3 py-2 text-[13px] text-rd-label-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rd-label-primary"
            />
          </div>
        </div>
      )}
      {drillDate && <button type="button" onClick={() => setDrillDate(null)} className="min-h-11 text-[13px] text-rd-label-primary">← Back to {lens}</button>}

      <div className="rounded-[16px] bg-rd-surface p-4" style={{ boxShadow: 'var(--rd-shadow-card)' }}>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={buckets} onClick={(state) => { const bucket = buckets.find((item) => item.label === state?.activeLabel); if (bucket && lens !== 'year') setDrillDate(bucket.key); }}>
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--rd-label-secondary)' }} axisLine={false} tickLine={false} /><YAxis hide />
            <Tooltip formatter={(value) => [`${Number(value ?? 0).toFixed(1)} wRVU`, '']} contentStyle={{ background: 'var(--rd-surface)', border: '1px solid var(--rd-separator)', borderRadius: 10, fontSize: 12 }} />
            {goalLine > 0 && <ReferenceLine y={goalLine} stroke="var(--rd-label-secondary)" strokeDasharray="4 4" />}
            <Bar dataKey="rvu" fill="var(--rd-label-primary)" radius={[4, 4, 0, 0]} cursor="pointer" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {stories.length > 0 && <div className="grid gap-2 sm:grid-cols-2">{stories.map((story, index) => <button key={story} type="button" onClick={() => setStoryOpen(storyOpen === index ? null : index)} className="rounded-[12px] border border-rd-separator bg-rd-surface p-4 text-left text-[15px] text-rd-label-primary">✦ {story}{storyOpen === index && <span className="mt-2 block text-[12px] text-rd-label-secondary">Evidence: {totals.studyCount} counted studies totaling {totals.totalWorkRvu.toFixed(1)} wRVU in the visible range.</span>}</button>)}</div>}

      {grouped.length === 0 ? <div className="rounded-[16px] bg-rd-surface py-14 text-center text-rd-label-secondary">Your history starts with your first capture.</div> : grouped.map(([date, rows]) => {
        const countedRows = rows.filter((row) => !row.needsReview);
        const dayRvu = countedRows.reduce((sum, row) => sum + (row.workRvu ?? 0), 0);
        const topModality = topModalityShares(computeByModality(countedRows))[0];
        return <section key={date} className="space-y-1"><header className="sticky top-14 z-10 flex items-center justify-between gap-3 border-b border-rd-separator bg-rd-bg/95 py-2">
          <span className="text-[13px] font-semibold text-rd-label-primary">{new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
          <DayGoalBar rvu={dayRvu} goal={dailyGoal} />
          <span className="text-[13px] text-rd-label-secondary [font-variant-numeric:tabular-nums]">{dayRvu.toFixed(1)} · {rows.length} studies{topModality ? ` · ${topModality.label} ${topModality.percent.toFixed(0)}%` : ''}</span>
        </header>{rows.map((log) => {
          const current = currentByCode.get(`${log.cptCode}-${log.modifier}`);
          const historical = current?.workRvu != null && log.workRvu != null && Math.abs(current.workRvu - log.workRvu) > 0.001;
          return <div key={log.id} className="rd-row grid grid-cols-[62px_1fr_auto] items-center gap-3 border-b border-rd-separator px-1 text-[13px]"><span className="font-mono text-rd-label-secondary">{log.studyDateTime ? new Date(log.studyDateTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '—'}</span><span className="min-w-0 truncate text-rd-label-primary">{title(log)} <span className="font-mono text-rd-label-secondary">{log.cptCode}</span> <MatchSourceFootnote method={log.matchMethod} /> {log.dateTimeSource === 'import_default' && <span className="text-rd-caution">inferred</span>} {historical && <span className="rounded bg-rd-surface-2 px-1.5 text-[11px] text-rd-label-secondary">{new Date(log.createdAt).getFullYear()} table</span>} {log.sourceImportId && <span className="text-[11px] text-rd-label-secondary">batch</span>}</span><span className="font-semibold text-rd-label-primary [font-variant-numeric:tabular-nums]">{log.workRvu?.toFixed(2) ?? '—'}</span></div>;
        })}</section>;
      })}
    </div>
  );
}
