import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { theme } from '../lib/theme';
import { db } from '../db/database';
import { supabasePersistence } from '../services/supabasePersistence';
import { useProfile } from '../hooks/useProfile';
import { todayDateString, computePeriodTotals } from '../utils/calculations';
import { rememberExamMapping } from '../services/memoryLearningService';
import { normalizeRadiologyDescription } from '../utils/radiologyDescriptionNormalization';
import type { StudyLog, Modality } from '../types';
import { MODALITY_LABELS } from '../types';

type Range = '7d' | '30d' | '90d' | 'all' | 'custom';

function isDeleted(log: StudyLog): boolean {
  return Boolean((log as any).deletedAt);
}

function isoWeekKey(dateString: string): string {
  const date = new Date(dateString + 'T12:00:00');
  const start = new Date(date);
  start.setDate(date.getDate() - date.getDay());
  return start.toISOString().slice(0, 10);
}

function monthKey(dateString: string): string {
  return dateString.slice(0, 7);
}

function displayTitle(log: StudyLog): string {
  return log.examTitleDisplay?.trim() || log.examNameRaw;
}

export function History() {
  const [range, setRange] = useState<Range>('30d');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState(todayDateString());
  const [showReviewOnly, setShowReviewOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [editingLogId, setEditingLogId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');

  const { activeProfile } = useProfile();
  const profileId = activeProfile?.id ?? null;

  const dateRange = useMemo(() => {
    const today = todayDateString();
    if (range === 'custom') return { start: customStart || '2000-01-01', end: customEnd || today };
    const d = new Date();
    if (range === '7d') d.setDate(d.getDate() - 7);
    else if (range === '30d') d.setDate(d.getDate() - 30);
    else if (range === '90d') d.setDate(d.getDate() - 90);
    else return { start: '2000-01-01', end: today };
    return { start: d.toISOString().slice(0, 10), end: today };
  }, [range, customStart, customEnd]);

  const logs = useLiveQuery<StudyLog[]>(
    async () => {
      if (!profileId) return [];
      const all = await db.studyLogs
        .where('logDate')
        .between(dateRange.start, dateRange.end, true, true)
        .reverse()
        .toArray();
      return all.filter((log) => !isDeleted(log) && (log.profileId === profileId || log.profileId == null));
    },
    [dateRange.start, dateRange.end, profileId],
  );

  const filtered = useMemo(() => {
    let result = logs ?? [];
    if (showReviewOnly) result = result.filter((log) => log.needsReview);
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((log) =>
        displayTitle(log).toLowerCase().includes(q) ||
        log.examNameRaw.toLowerCase().includes(q) ||
        (log.cmsDescription ?? '').toLowerCase().includes(q) ||
        (log.cptCode ?? '').includes(q) ||
        (log.notes ?? '').toLowerCase().includes(q),
      );
    }
    return result;
  }, [logs, search, showReviewOnly]);

  const totals = computePeriodTotals(filtered);

  const groupedByDate = useMemo(() => {
    const map = new Map<string, StudyLog[]>();
    for (const log of filtered) {
      const arr = map.get(log.logDate) ?? [];
      arr.push(log);
      map.set(log.logDate, arr);
    }
    for (const [, dayLogs] of map) {
      dayLogs.sort((a, b) => (a.studyDateTime ?? a.createdAt).localeCompare(b.studyDateTime ?? b.createdAt));
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [filtered]);

  const trends = useMemo(() => {
    const byDay = new Map<string, number>();
    const byWeek = new Map<string, number>();
    const byMonth = new Map<string, number>();
    for (const log of filtered) {
      const rvu = log.needsReview ? 0 : (log.workRvu ?? 0);
      byDay.set(log.logDate, (byDay.get(log.logDate) ?? 0) + rvu);
      byWeek.set(isoWeekKey(log.logDate), (byWeek.get(isoWeekKey(log.logDate)) ?? 0) + rvu);
      byMonth.set(monthKey(log.logDate), (byMonth.get(monthKey(log.logDate)) ?? 0) + rvu);
    }
    const daily = Array.from(byDay.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    const rolling = daily.slice(-7);
    const rollingAvg = rolling.length
      ? rolling.reduce((sum, [, rvu]) => sum + rvu, 0) / rolling.length
      : 0;
    return {
      latestDay: daily.at(-1)?.[1] ?? 0,
      latestWeek: Array.from(byWeek.entries()).sort((a, b) => a[0].localeCompare(b[0])).at(-1)?.[1] ?? 0,
      latestMonth: Array.from(byMonth.entries()).sort((a, b) => a[0].localeCompare(b[0])).at(-1)?.[1] ?? 0,
      rollingAvg,
    };
  }, [filtered]);

  const selectedCount = selectedIds.size;
  const selectedTodayCount = filtered.filter((log) => log.logDate === todayDateString() && selectedIds.has(log.id)).length;

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectVisible() {
    setSelectedIds(new Set(filtered.map((log) => log.id)));
  }

  function selectToday() {
    setSelectedIds(new Set(filtered.filter((log) => log.logDate === todayDateString()).map((log) => log.id)));
  }

  function startRename(log: StudyLog) {
    setEditingLogId(log.id);
    setEditingTitle(displayTitle(log));
  }

  async function saveRename(log: StudyLog) {
    const title = editingTitle.trim();
    if (!title) return;
    const normalizedTitle = normalizeRadiologyDescription(title);
    const relatedLogs = (logs ?? []).filter((candidate) =>
      log.sessionId
        ? candidate.sessionId === log.sessionId
        : candidate.id === log.id,
    );
    const ids = relatedLogs.length > 0 ? relatedLogs.map((candidate) => candidate.id) : [log.id];
    const now = new Date().toISOString();

    await db.transaction('rw', db.studyLogs, async () => {
      for (const id of ids) {
        await db.studyLogs.update(id, {
          examTitleDisplay: title,
          examTitleNormalized: normalizedTitle,
          updatedAt: now,
        } as any);
      }
    });

    await supabasePersistence.updateStudyLogDisplayTitle(ids, title, normalizedTitle);

    const aliasCandidates = relatedLogs.length > 0 ? relatedLogs : [log];
    await rememberExamMapping({
      rawText: log.examNameRaw,
      canonicalExamName: title,
      candidates: aliasCandidates
        .filter((candidate) => candidate.cptCode && candidate.modifier === '26' && (candidate.workRvu ?? 0) > 0)
        .map((candidate) => ({
          cptCode: candidate.cptCode!,
          modifier: '26',
          workRvu: candidate.workRvu,
        })),
      source: 'user',
      profileId: activeProfile?.id ?? null,
      siteId: null,
      sessionId: log.sessionId,
      logDate: log.logDate,
      action: 'correct',
      audit: {
        action: 'cpt_changed',
        summary: `Renamed ${log.examNameRaw} to ${title}`,
        details: { logIds: ids, normalizedTitle },
      },
    });

    setEditingLogId(null);
    setEditingTitle('');
  }

  async function softDelete(ids: string[]) {
    if (ids.length === 0) return;
    if (!confirm(`Delete ${ids.length} selected exam${ids.length === 1 ? '' : 's'}? Totals and trends will update immediately.`)) return;
    setDeleting(true);
    try {
      const now = new Date().toISOString();
      await db.transaction('rw', db.studyLogs, async () => {
        for (const id of ids) {
          await db.studyLogs.update(id, { deletedAt: now, updatedAt: now } as any);
        }
      });
      await supabasePersistence.softDeleteStudyLogs(ids);
      setSelectedIds(new Set());
    } finally {
      setDeleting(false);
    }
  }

  async function markReviewed(log: StudyLog) {
    await db.studyLogs.update(log.id, { needsReview: false, updatedAt: new Date().toISOString() });
  }

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
        <h1 className="text-2xl font-bold text-white tracking-tight">Daily History</h1>
        <p className="text-slate-400 text-sm mt-0.5">
          {filtered.length} exams · {totals.totalWorkRvu.toFixed(1)} modifier 26 wRVU
        </p>
      </div>

      <div className="card space-y-3">
        <div className="flex flex-wrap gap-2">
          {RANGES.map((r) => (
            <button
              key={r.value}
              onClick={() => setRange(r.value)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${range === r.value ? 'border' : 'bg-white/5 text-slate-400 hover:text-white border border-transparent'}`}
              style={range === r.value ? { background: 'rgba(37,99,168,0.2)', borderColor: 'rgba(37,99,168,0.4)', color: theme.colors.accent } : {}}
            >
              {r.label}
            </button>
          ))}
          <button
            onClick={() => setShowReviewOnly(!showReviewOnly)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${showReviewOnly ? 'bg-amber-500/20 border border-amber-500/40 text-amber-300' : 'bg-white/5 text-slate-400 hover:text-white border border-transparent'}`}
          >
            Needs Review
          </button>
        </div>

        {range === 'custom' && (
          <div className="flex gap-3">
            <div className="flex-1"><label className="block text-xs text-slate-400 mb-1">From</label><input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="input w-full" /></div>
            <div className="flex-1"><label className="block text-xs text-slate-400 mb-1">To</label><input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="input w-full" /></div>
          </div>
        )}

        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search exam titles, CPT codes, CMS descriptions, notes..." className="input w-full" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="card text-center"><p className="text-xs text-slate-400">Daily</p><p className="text-xl font-bold text-white mt-0.5">{trends.latestDay.toFixed(1)}</p></div>
        <div className="card text-center"><p className="text-xs text-slate-400">Weekly</p><p className="text-xl font-bold text-white mt-0.5">{trends.latestWeek.toFixed(1)}</p></div>
        <div className="card text-center"><p className="text-xs text-slate-400">Monthly</p><p className="text-xl font-bold text-white mt-0.5">{trends.latestMonth.toFixed(1)}</p></div>
        <div className="card text-center"><p className="text-xs text-slate-400">7-day Avg</p><p className="text-xl font-bold text-white mt-0.5">{trends.rollingAvg.toFixed(1)}</p></div>
      </div>

      <div className="card flex flex-wrap items-center gap-2">
        <button onClick={selectToday} className="btn-ghost text-xs">Select all from today</button>
        <button onClick={selectVisible} className="btn-ghost text-xs">Select all visible</button>
        <button onClick={() => setSelectedIds(new Set())} className="btn-ghost text-xs" disabled={selectedCount === 0}>Clear selection</button>
        <button onClick={() => softDelete(Array.from(selectedIds))} disabled={deleting || selectedCount === 0} className="btn-danger ml-auto">
          {deleting ? 'Deleting…' : `Delete selected exams (${selectedCount})`}
        </button>
        {selectedTodayCount > 0 && <span className="text-xs text-slate-500">{selectedTodayCount} selected from today</span>}
      </div>

      {groupedByDate.length === 0 ? (
        <div className="card text-center py-12"><p className="text-slate-400 text-sm">{showReviewOnly ? 'No exams need review' : 'No exams in this range'}</p></div>
      ) : (
        <div className="space-y-4">
          {groupedByDate.map(([date, dayLogs]) => {
            const dayRvu = dayLogs.filter((log) => !log.needsReview).reduce((sum, log) => sum + (log.workRvu ?? 0), 0);
            return (
              <div key={date}>
                <div className="flex items-center gap-3 mb-2">
                  <div className="flex-1 h-px bg-white/5" />
                  <span className="text-xs text-slate-400 font-medium">
                    {new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                  </span>
                  <span className="text-xs text-white font-semibold">{dayRvu.toFixed(1)} wRVU</span>
                  <div className="flex-1 h-px bg-white/5" />
                </div>

                <div className="space-y-2">
                  {dayLogs.map((log) => {
                    const notRelevant = (log.workRvu ?? 0) <= 0 || log.modifier !== '26';
                    const title = displayTitle(log);
                    const cmsDescription = log.cmsDescription && log.cmsDescription !== title ? log.cmsDescription : null;
                    const isEditing = editingLogId === log.id;
                    return (
                      <div key={log.id} className={`card flex items-start gap-3 ${log.needsReview || notRelevant ? 'border-amber-500/30 bg-amber-500/5' : ''}`}>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(log.id)}
                          onChange={() => toggleSelected(log.id)}
                          className="mt-1 h-4 w-4 shrink-0 rounded border-white/20 bg-white/5"
                          aria-label={`Select ${title}`}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-xs font-bold text-slate-300">{log.cptCode ? `${log.cptCode}-26` : 'Unmatched'}</span>
                            {log.modality && <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/8 text-slate-400">{MODALITY_LABELS[log.modality as Modality]}</span>}
                            {log.studyDateTime && <span className="text-[10px] font-mono text-slate-500">{new Date(log.studyDateTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}</span>}
                            {notRelevant && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300">not productivity-relevant</span>}
                            {log.needsReview && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300">Review</span>}
                          </div>
                          {isEditing ? (
                            <div className="mt-1 flex gap-2">
                              <input
                                value={editingTitle}
                                onChange={(e) => setEditingTitle(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') void saveRename(log);
                                  if (e.key === 'Escape') {
                                    setEditingLogId(null);
                                    setEditingTitle('');
                                  }
                                }}
                                className="input flex-1 text-sm py-1"
                                autoFocus
                              />
                              <button onClick={() => saveRename(log)} className="text-[10px] px-2 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">Save</button>
                              <button onClick={() => { setEditingLogId(null); setEditingTitle(''); }} className="text-[10px] px-2 py-1 rounded-lg border border-white/12 text-slate-400">Cancel</button>
                            </div>
                          ) : (
                            <p className="text-sm text-white mt-0.5 line-clamp-1">{title}</p>
                          )}
                          {cmsDescription && <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">CMS: {cmsDescription}</p>}
                          {log.examNameRaw !== title && <p className="text-xs text-slate-600 mt-0.5 line-clamp-1">OCR: {log.examNameRaw}</p>}
                          {log.notes && <p className="text-xs text-slate-500 mt-0.5">{log.notes}</p>}
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-bold text-white">{notRelevant ? '0.00' : (log.workRvu?.toFixed(2) ?? '—')}</p>
                          <p className="text-[10px] text-slate-400">wRVU</p>
                        </div>
                        <div className="flex flex-col gap-1.5 shrink-0">
                          {!isEditing && (
                            <button onClick={() => startRename(log)} className="text-[10px] px-2 py-1 rounded-lg border border-white/12 text-slate-400 hover:border-white/25 hover:text-white transition-colors">Rename</button>
                          )}
                          {log.needsReview && (
                            <button onClick={() => markReviewed(log)} className="text-[10px] px-2 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/25 transition-colors whitespace-nowrap">OK</button>
                          )}
                          <button onClick={() => softDelete([log.id])} disabled={deleting} className="text-[10px] px-2 py-1 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-colors">Del</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
