import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { db } from '../db/database';
import { supabasePersistence } from '../services/supabasePersistence';
import { useProfile } from '../hooks/useProfile';
import { todayDateString } from '../utils/calculations';
import { rememberExamMapping } from '../services/memoryLearningService';
import { normalizeRadiologyDescription } from '../utils/radiologyDescriptionNormalization';
import { parseHospitalReport, compareHospitalRows, saveHospitalComparisonReport, type HospitalRow, type HospitalDiscrepancy } from '../utils/hospitalComparison';
import type { StudyLog, Modality } from '../types';
import { MODALITY_LABELS } from '../types';

function isDeleted(log: StudyLog): boolean {
  return Boolean((log as any).deletedAt);
}

function displayTitle(log: StudyLog): string {
  return log.examTitleDisplay?.trim() || log.examNameRaw;
}

function formatDayLabel(date: string): string {
  return new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function HospitalComparePanel({ dayLogs, reportDate, profileId, siteId }: {
  dayLogs: StudyLog[];
  reportDate: string;
  profileId: string | null;
  siteId: string | null;
}) {
  const [reportText, setReportText] = useState('');
  const [reportName, setReportName] = useState('hospital-report.csv');
  const [saved, setSaved] = useState(false);

  const hospitalRows: HospitalRow[] = useMemo(() => parseHospitalReport(reportText), [reportText]);
  const discrepancies: HospitalDiscrepancy[] = useMemo(() => compareHospitalRows(hospitalRows, dayLogs), [hospitalRows, dayLogs]);

  async function handleFile(file: File | null) {
    if (!file) return;
    setReportName(file.name);
    setReportText(await file.text());
    setSaved(false);
  }

  async function save() {
    await saveHospitalComparisonReport({
      profileId,
      siteId,
      reportDate,
      filename: reportName,
      hospitalRows,
      logs: dayLogs,
      discrepancies,
    });
    setSaved(true);
  }

  return (
    <div className="rounded-lg border border-white/8 bg-white/3 p-3 space-y-2 text-xs">
      <input type="file" accept=".csv,text/csv,text/plain" onChange={(e) => void handleFile(e.target.files?.[0] ?? null)} className="text-xs text-slate-400" />
      <textarea
        value={reportText}
        onChange={(e) => { setReportText(e.target.value); setSaved(false); }}
        rows={4}
        className="input w-full font-mono text-xs"
        placeholder="exam,cpt,modifier,wrvu,quantity"
      />
      {hospitalRows.length > 0 && (
        <>
          <p className="text-slate-400">{discrepancies.length} discrepanc{discrepancies.length === 1 ? 'y' : 'ies'} found.</p>
          <div className="max-h-40 overflow-y-auto space-y-1.5">
            {discrepancies.slice(0, 20).map((item, index) => (
              <div key={`${item.key}-${index}`} className="rounded border border-white/8 bg-black/15 p-2">
                <p className="text-slate-300">{item.summary}</p>
              </div>
            ))}
          </div>
          <button onClick={() => void save()} disabled={saved} className="text-[11px] px-2.5 py-1 rounded-lg border border-sky-500/30 text-sky-300 hover:bg-sky-500/10 disabled:opacity-40">
            {saved ? 'Saved' : 'Save discrepancy report'}
          </button>
        </>
      )}
    </div>
  );
}

export function History() {
  const [search, setSearch] = useState('');
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());
  const [compareOpenDate, setCompareOpenDate] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [editingLogId, setEditingLogId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');

  const { activeProfile, activePractice } = useProfile();
  const profileId = activeProfile?.id ?? null;
  const siteId = activePractice?.id ?? null;

  const logs = useLiveQuery<StudyLog[]>(
    async () => {
      if (!profileId) return [];
      const all = await db.studyLogs.orderBy('logDate').reverse().toArray();
      return all.filter((log) => !isDeleted(log) && (log.profileId === profileId || log.profileId == null));
    },
    [profileId],
  ) ?? [];

  const filtered = useMemo(() => {
    if (!search.trim()) return logs;
    const q = search.toLowerCase();
    return logs.filter((log) =>
      displayTitle(log).toLowerCase().includes(q) ||
      log.examNameRaw.toLowerCase().includes(q) ||
      (log.cmsDescription ?? '').toLowerCase().includes(q) ||
      (log.cptCode ?? '').includes(q),
    );
  }, [logs, search]);

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

  function toggleExpanded(date: string) {
    setExpandedDates((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  }

  function startRename(log: StudyLog) {
    setEditingLogId(log.id);
    setEditingTitle(displayTitle(log));
  }

  async function saveRename(log: StudyLog) {
    const title = editingTitle.trim();
    if (!title) return;
    const normalizedTitle = normalizeRadiologyDescription(title);
    const relatedLogs = logs.filter((candidate) =>
      log.sessionId ? candidate.sessionId === log.sessionId : candidate.id === log.id,
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
    } finally {
      setDeleting(false);
    }
  }

  async function markReviewed(log: StudyLog) {
    await db.studyLogs.update(log.id, { needsReview: false, updatedAt: new Date().toISOString() });
  }

  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      <h1 className="text-2xl font-bold text-white tracking-tight">History</h1>

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by procedure or CPT"
        className="input w-full"
      />

      {groupedByDate.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-slate-400 text-sm">{search.trim() ? 'No matches found' : 'No history yet'}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {groupedByDate.map(([date, dayLogs]) => {
            const dayRvu = dayLogs.filter((log) => !log.needsReview).reduce((sum, log) => sum + (log.workRvu ?? 0), 0);
            const expanded = expandedDates.has(date);
            const isToday = date === todayDateString();
            return (
              <div key={date} className="rounded-xl border border-white/8 overflow-hidden">
                <button
                  onClick={() => toggleExpanded(date)}
                  className="w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-white/3 transition-colors"
                >
                  <span className="text-slate-200 font-medium">
                    {isToday ? 'Today' : formatDayLabel(date)} · {dayLogs.length} {dayLogs.length === 1 ? 'study' : 'studies'} · {dayRvu.toFixed(1)} wRVU
                  </span>
                  <span className="text-slate-500 text-xs">{expanded ? 'Hide ▲' : 'Show ▼'}</span>
                </button>

                {expanded && (
                  <div className="border-t border-white/8 p-3 space-y-2">
                    <button
                      onClick={() => setCompareOpenDate(compareOpenDate === date ? null : date)}
                      className="text-[11px] px-2.5 py-1 rounded-lg border border-white/12 text-slate-400 hover:border-white/25 hover:text-white transition-colors"
                    >
                      Compare with hospital report
                    </button>
                    {compareOpenDate === date && (
                      <HospitalComparePanel dayLogs={dayLogs} reportDate={date} profileId={profileId} siteId={siteId} />
                    )}

                    {dayLogs.map((log) => {
                      const notRelevant = (log.workRvu ?? 0) <= 0 || log.modifier !== '26';
                      const title = displayTitle(log);
                      const cmsDescription = log.cmsDescription && log.cmsDescription !== title ? log.cmsDescription : null;
                      const isEditing = editingLogId === log.id;
                      return (
                        <div key={log.id} className={`card flex items-start gap-3 ${log.needsReview || notRelevant ? 'border-amber-500/30 bg-amber-500/5' : ''}`}>
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
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
