import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { theme } from '../lib/theme';
import { db } from '../db/database';
import { useProfile } from '../hooks/useProfile';
import { todayDateString, computePeriodTotals } from '../utils/calculations';
import type { StudyLog, Modality } from '../types';
import { MODALITY_LABELS } from '../types';

type Range = '7d' | '30d' | '90d' | 'all' | 'custom';

export function History() {
  const [range, setRange] = useState<Range>('30d');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState(todayDateString());
  const [showReviewOnly, setShowReviewOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);

  const { activeProfile } = useProfile();
  const profileId = activeProfile?.id ?? null;

  const dateRange = (() => {
    const today = todayDateString();
    if (range === 'custom') {
      return { start: customStart || '2000-01-01', end: customEnd || today };
    }
    const d = new Date();
    if (range === '7d') d.setDate(d.getDate() - 7);
    else if (range === '30d') d.setDate(d.getDate() - 30);
    else if (range === '90d') d.setDate(d.getDate() - 90);
    else return { start: '2000-01-01', end: today };
    return { start: d.toISOString().slice(0, 10), end: today };
  })();

  const logs = useLiveQuery<StudyLog[]>(
    async () => {
      if (!profileId) return [];
      const all = await db.studyLogs
        .where('logDate')
        .between(dateRange.start, dateRange.end, true, true)
        .reverse()
        .toArray();
      return all.filter((l) => l.profileId === profileId || l.profileId == null);
    },
    [dateRange.start, dateRange.end, profileId]
  );

  const filtered = (() => {
    if (!logs) return [];
    let result = logs;
    if (showReviewOnly) result = result.filter((l) => l.needsReview);
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (l) =>
          l.examNameRaw.toLowerCase().includes(q) ||
          (l.cptCode ?? '').includes(q) ||
          (l.notes ?? '').toLowerCase().includes(q)
      );
    }
    return result;
  })();

  const totals = computePeriodTotals(filtered);

  async function deleteLog(id: string) {
    setDeleting(id);
    try {
      await db.studyLogs.delete(id);
    } finally {
      setDeleting(null);
    }
  }

  async function markReviewed(log: StudyLog) {
    await db.studyLogs.update(log.id, {
      needsReview: false,
      updatedAt: new Date().toISOString(),
    });
  }

  const groupedByDate = (() => {
    const map = new Map<string, StudyLog[]>();
    for (const log of filtered) {
      const arr = map.get(log.logDate) ?? [];
      arr.push(log);
      map.set(log.logDate, arr);
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  })();

  const RANGES: { label: string; value: Range }[] = [
    { label: '7D', value: '7d' },
    { label: '30D', value: '30d' },
    { label: '90D', value: '90d' },
    { label: 'All', value: 'all' },
    { label: 'Custom', value: 'custom' },
  ];

  return (
    <div className="space-y-5 animate-in fade-in duration-300">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">History</h1>
        <p className="text-slate-400 text-sm mt-0.5">
          {filtered.length} studies · {totals.totalWorkRvu.toFixed(1)} wRVU
        </p>
      </div>

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap gap-2">
          {RANGES.map((r) => (
            <button
              key={r.value}
              onClick={() => setRange(r.value)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                range === r.value
                  ? 'border'
                  : 'bg-white/5 text-slate-400 hover:text-white border border-transparent'
              }`}
              style={range === r.value ? {
                background: 'rgba(37,99,168,0.2)',
                borderColor: 'rgba(37,99,168,0.4)',
                color: theme.colors.accent,
              } : {}}
            >
              {r.label}
            </button>
          ))}
          <button
            onClick={() => setShowReviewOnly(!showReviewOnly)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
              showReviewOnly
                ? 'bg-amber-500/20 border border-amber-500/40 text-amber-300'
                : 'bg-white/5 text-slate-400 hover:text-white border border-transparent'
            }`}
          >
            ⚠️ Needs Review
          </button>
        </div>

        {range === 'custom' && (
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">From</label>
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="input w-full"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-400 mb-1">To</label>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="input w-full"
              />
            </div>
          </div>
        )}

        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search exam names, CPT codes, notes…"
          className="input w-full"
        />
      </div>

      {/* Summary row */}
      {filtered.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="card text-center">
            <p className="text-xs text-slate-400">Total wRVU</p>
            <p className="text-xl font-bold text-white mt-0.5">{totals.totalWorkRvu.toFixed(1)}</p>
          </div>
          <div className="card text-center">
            <p className="text-xs text-slate-400">Studies</p>
            <p className="text-xl font-bold text-white mt-0.5">{totals.studyCount}</p>
          </div>
          <div className="card text-center">
            <p className="text-xs text-slate-400">Avg / Study</p>
            <p className="text-xl font-bold text-white mt-0.5">{totals.avgRvuPerStudy.toFixed(2)}</p>
          </div>
        </div>
      )}

      {/* Log list */}
      {groupedByDate.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-slate-400 text-sm">
            {showReviewOnly ? 'No studies need review' : 'No studies in this range'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {groupedByDate.map(([date, dayLogs]) => {
            const dayRvu = dayLogs.filter((l) => !l.needsReview).reduce((s, l) => s + (l.workRvu ?? 0), 0);
            return (
              <div key={date}>
                <div className="flex items-center gap-3 mb-2">
                  <div className="flex-1 h-px bg-white/5" />
                  <span className="text-xs text-slate-400 font-medium">
                    {new Date(date + 'T12:00:00').toLocaleDateString('en-US', {
                      weekday: 'short', month: 'short', day: 'numeric'
                    })}
                  </span>
                  <span className="text-xs text-white font-semibold">
                    {dayRvu.toFixed(1)} wRVU
                  </span>
                  <div className="flex-1 h-px bg-white/5" />
                </div>

                <div className="space-y-2">
                  {dayLogs.map((log) => (
                    <div
                      key={log.id}
                      className={`card flex items-start gap-3 ${
                        log.needsReview ? 'border-amber-500/30 bg-amber-500/5' : ''
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-xs font-bold text-slate-300">
                            {log.cptCode ?? 'Unmatched'}
                          </span>
                          {log.modality && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/8 text-slate-400">
                              {MODALITY_LABELS[log.modality as Modality]}
                            </span>
                          )}
                          {log.needsReview && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300">
                              ⚠️ Review
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-white mt-0.5 line-clamp-1">{log.examNameRaw}</p>
                        {log.notes && (
                          <p className="text-xs text-slate-500 mt-0.5">{log.notes}</p>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-bold text-white">{log.workRvu?.toFixed(2) ?? '—'}</p>
                        <p className="text-[10px] text-slate-400">wRVU</p>
                      </div>
                      <div className="flex flex-col gap-1.5 shrink-0">
                        {log.needsReview && (
                          <button
                            onClick={() => markReviewed(log)}
                            className="text-[10px] px-2 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/25 transition-colors whitespace-nowrap"
                          >
                            ✓ OK
                          </button>
                        )}
                        <button
                          onClick={() => deleteLog(log.id)}
                          disabled={deleting === log.id}
                          className="text-[10px] px-2 py-1 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-colors"
                        >
                          {deleting === log.id ? '…' : 'Del'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
