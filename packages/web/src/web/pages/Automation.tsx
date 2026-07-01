import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { db } from '../db/database';
import { useOrg } from '../hooks/useOrg';
import { todayDateString } from '../utils/calculations';
import { normalizeRadiologyDescription } from '../utils/radiologyDescriptionNormalization';
import { learnAlias, searchExamLibrary } from '../utils/matching';
import { recordAuditEvent } from '../utils/audit';
import type { PipelineReviewRow } from '../pipeline/importPipeline';
import type { AuditLogEntry, HospitalComparisonReport, MemorySuggestion, StudyLog, UserSettings } from '../types';

interface HospitalRow {
  examTitle: string;
  cptCode: string | null;
  modifier: string | null;
  workRvu: number | null;
  quantity: number;
}

interface Discrepancy {
  type: 'missing_local' | 'missing_hospital' | 'cpt_mismatch' | 'modifier_mismatch' | 'wrvu_difference';
  key: string;
  summary: string;
  hospital?: HospitalRow;
  local?: StudyLog;
}

function fmt(n: number, decimals = 1) {
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function localTitle(log: StudyLog): string {
  return log.examTitleDisplay?.trim() || log.examNameRaw;
}

function csvEscape(value: unknown): string {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadText(filename: string, text: string, type = 'text/csv;charset=utf-8') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function parseHospitalReport(raw: string): HospitalRow[] {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  const header = lines[0].split(',').map((cell) => cell.trim().toLowerCase());
  const hasHeader = header.some((cell) => ['exam', 'examtitle', 'cpt', 'cptcode', 'wrvu', 'workrvu'].includes(cell.replace(/\s+/g, '')));
  const dataLines = hasHeader ? lines.slice(1) : lines;
  const indexFor = (names: string[], fallback: number) => {
    const index = header.findIndex((cell) => names.includes(cell.replace(/\s+/g, '')));
    return index >= 0 ? index : fallback;
  };
  const examIndex = hasHeader ? indexFor(['exam', 'examtitle', 'description', 'study'], 0) : 0;
  const cptIndex = hasHeader ? indexFor(['cpt', 'cptcode'], 1) : 1;
  const modifierIndex = hasHeader ? indexFor(['modifier', 'mod'], 2) : 2;
  const wrvuIndex = hasHeader ? indexFor(['wrvu', 'workrvu', 'workrvus'], 3) : 3;
  const qtyIndex = hasHeader ? indexFor(['quantity', 'qty', 'count'], 4) : 4;

  return dataLines.map((line) => {
    const cells = line.split(',').map((cell) => cell.trim());
    return {
      examTitle: cells[examIndex] || cells[0] || 'Untitled exam',
      cptCode: cells[cptIndex] || null,
      modifier: cells[modifierIndex] || null,
      workRvu: Number.isFinite(Number(cells[wrvuIndex])) ? Number(cells[wrvuIndex]) : null,
      quantity: Math.max(1, Number.isFinite(Number(cells[qtyIndex])) ? Number(cells[qtyIndex]) : 1),
    };
  });
}

function compareHospitalRows(rows: HospitalRow[], logs: StudyLog[]): Discrepancy[] {
  const localByKey = new Map<string, StudyLog[]>();
  for (const log of logs) {
    const key = `${normalizeRadiologyDescription(localTitle(log))}|${log.cptCode ?? ''}`;
    localByKey.set(key, [...(localByKey.get(key) ?? []), log]);
  }
  const hospitalKeys = new Set<string>();
  const discrepancies: Discrepancy[] = [];

  for (const row of rows) {
    const key = `${normalizeRadiologyDescription(row.examTitle)}|${row.cptCode ?? ''}`;
    hospitalKeys.add(key);
    const local = localByKey.get(key)?.[0];
    if (!local) {
      discrepancies.push({ type: 'missing_local', key, summary: `Hospital report has ${row.examTitle} ${row.cptCode ?? ''}, but no matching local log.`, hospital: row });
      continue;
    }
    if ((row.modifier ?? null) !== (local.modifier ?? null)) {
      discrepancies.push({ type: 'modifier_mismatch', key, summary: `Modifier differs for ${row.examTitle}: hospital ${row.modifier ?? 'none'}, local ${local.modifier ?? 'none'}.`, hospital: row, local });
    }
    if (row.workRvu != null && local.workRvu != null && Math.abs(row.workRvu - local.workRvu) > 0.01) {
      discrepancies.push({ type: 'wrvu_difference', key, summary: `wRVU differs for ${row.examTitle}: hospital ${row.workRvu}, local ${local.workRvu}.`, hospital: row, local });
    }
  }

  for (const log of logs) {
    const key = `${normalizeRadiologyDescription(localTitle(log))}|${log.cptCode ?? ''}`;
    if (!hospitalKeys.has(key)) {
      discrepancies.push({ type: 'missing_hospital', key, summary: `Local log ${localTitle(log)} ${log.cptCode ?? ''} is absent from the hospital report.`, local: log });
    }
  }
  return discrepancies;
}

export function Automation() {
  const { activeProfile, activePractice } = useOrg();
  const profileId = activeProfile?.id ?? null;
  const siteId = activePractice?.id ?? null;
  const today = todayDateString();
  const [reportText, setReportText] = useState('');
  const [reportName, setReportName] = useState('hospital-report.csv');
  const [compareDate, setCompareDate] = useState(today);
  const [bulkCorrections, setBulkCorrections] = useState<Record<string, { query: string; scope: 'future' | 'site' | 'personal' }>>({});

  const settings = useLiveQuery<UserSettings | undefined>(() => db.userSettings.get('default'), []);
  const logs = useLiveQuery<StudyLog[]>(
    async () => {
      const all = await db.studyLogs.where('logDate').equals(compareDate).toArray();
      return all.filter((log) => !(log as any).deletedAt && (log.profileId === profileId || log.profileId == null));
    },
    [compareDate, profileId],
  ) ?? [];
  const activeSession = useLiveQuery(
    async () => {
      const sessions = await db.activeReviewSessions.where('status').equals('active').reverse().sortBy('updatedAt');
      return sessions.find((session) => session.profileId === profileId || session.profileId == null);
    },
    [profileId],
  );
  const auditEntries = useLiveQuery<AuditLogEntry[]>(
    async () => {
      const entries = await db.auditLogEntries.where('logDate').equals(compareDate).reverse().sortBy('createdAt');
      return entries.filter((entry) => entry.profileId === profileId || entry.profileId == null);
    },
    [compareDate, profileId],
  ) ?? [];
  const storedReports = useLiveQuery<HospitalComparisonReport[]>(
    async () => db.hospitalComparisonReports.where('reportDate').equals(compareDate).reverse().sortBy('createdAt'),
    [compareDate],
  ) ?? [];
  const suggestions = useLiveQuery<MemorySuggestion[]>(
    async () => db.memorySuggestions.where('status').equals('pending').reverse().sortBy('createdAt'),
    [],
  ) ?? [];
  const aliases = useLiveQuery(() => db.examAliases.toArray(), []) ?? [];

  const confirmed = logs.filter((log) => !log.needsReview).reduce((sum, log) => sum + (log.workRvu ?? 0), 0);
  const pending = activeSession?.estimatedPendingWrvu ?? logs.filter((log) => log.needsReview).reduce((sum, log) => sum + (log.workRvu ?? 0), 0);
  const projected = confirmed + pending;
  const goal = activeProfile?.dailyRvuGoal ?? settings?.dailyRvuGoal ?? 90;
  const remaining = Math.max(0, goal - projected);
  const percent = Math.min(100, (projected / Math.max(1, goal)) * 100);
  const compRate = settings?.estimatedCompPerWrvu ?? null;

  const hospitalRows = useMemo(() => parseHospitalReport(reportText), [reportText]);
  const discrepancies = useMemo(() => compareHospitalRows(hospitalRows, logs), [hospitalRows, logs]);
  const confidenceBuckets = useMemo(() => {
    const buckets = { high: 0, medium: 0, low: 0 };
    for (const log of logs) {
      if (log.matchConfidence >= 0.9) buckets.high++;
      else if (log.matchConfidence >= 0.75) buckets.medium++;
      else buckets.low++;
    }
    return buckets;
  }, [logs]);
  const autoApproved = logs.filter((log) => log.matchMethod === 'alias_match' && log.matchConfidence >= 0.95).length;
  const newAliasesToday = aliases.filter((alias) => alias.createdAt?.slice(0, 10) === today).length;
  const activeRows = useMemo<PipelineReviewRow[]>(() => {
    if (!activeSession?.rowsJson) return [];
    try {
      return JSON.parse(activeSession.rowsJson) as PipelineReviewRow[];
    } catch {
      return [];
    }
  }, [activeSession?.rowsJson]);
  const unknownGroups = useMemo(() => {
    const byKey = new Map<string, PipelineReviewRow[]>();
    for (const row of activeRows) {
      if (!row.included || !row.needsReview) continue;
      const selectedCount = row.selectedCandidateIndices?.length ?? (row.selectedCandidateIndex == null ? 0 : 1);
      const lowConfidence = (row.candidates[0]?.confidence ?? 0) < 0.75;
      if (selectedCount > 0 && !lowConfidence) continue;
      const key = normalizeRadiologyDescription(row.source.examTitle);
      byKey.set(key, [...(byKey.get(key) ?? []), row]);
    }
    return Array.from(byKey.entries())
      .filter(([, grouped]) => grouped.length > 1)
      .map(([key, grouped]) => ({ key, grouped, sample: grouped[0].source.examTitle }))
      .sort((a, b) => b.grouped.length - a.grouped.length);
  }, [activeRows]);
  const averageReviewTime = auditEntries.length > 1
    ? Math.max(1, Math.round((new Date(auditEntries[0].createdAt).getTime() - new Date(auditEntries.at(-1)!.createdAt).getTime()) / 60000 / auditEntries.length))
    : 0;

  async function handleHospitalFile(file: File | null) {
    if (!file) return;
    setReportName(file.name);
    setReportText(await file.text());
  }

  async function saveComparisonReport() {
    const hospitalTotalWrvu = hospitalRows.reduce((sum, row) => sum + (row.workRvu ?? 0) * row.quantity, 0);
    const localTotalWrvu = logs.reduce((sum, log) => sum + (log.workRvu ?? 0), 0);
    await db.hospitalComparisonReports.add({
      id: crypto.randomUUID(),
      profileId,
      siteId,
      reportDate: compareDate,
      filename: reportName,
      hospitalTotalWrvu,
      localTotalWrvu,
      hospitalExamCount: hospitalRows.reduce((sum, row) => sum + row.quantity, 0),
      localExamCount: logs.length,
      discrepanciesJson: JSON.stringify(discrepancies),
      createdAt: new Date().toISOString(),
    });
    await recordAuditEvent({
      profileId,
      siteId,
      sessionId: null,
      logDate: compareDate,
      action: 'hospital_report_imported',
      summary: `Compared ${reportName}: ${discrepancies.length} discrepancies`,
      detailsJson: JSON.stringify({ reportName, discrepancies }),
    });
  }

  function exportFinalizedDay() {
    const rows = [
      ['Date', 'Exam', 'CPT', 'Modifier', 'wRVU', 'Modality', 'Status', 'Match method', 'Confidence', 'Audit summary'],
      ...logs.map((log) => [
        log.logDate,
        localTitle(log),
        log.cptCode ?? '',
        log.modifier ?? '',
        log.workRvu ?? '',
        log.modality ?? '',
        log.needsReview ? 'Pending review' : 'Confirmed',
        log.matchMethod,
        `${Math.round(log.matchConfidence * 100)}%`,
        auditEntries.filter((entry) => entry.sessionId === log.sessionId || entry.logDate === log.logDate).map((entry) => entry.action).join('; '),
      ]),
      [],
      ['Total wRVU', confirmed],
      ['Projected wRVU', projected],
      ['Finalized at', new Date().toISOString()],
    ];
    downloadText(`wrvu-${compareDate}.csv`, rows.map((row) => row.map(csvEscape).join(',')).join('\n'));
    void recordAuditEvent({
      profileId,
      siteId,
      sessionId: activeSession?.id ?? null,
      logDate: compareDate,
      action: 'exported',
      summary: `Exported ${compareDate} CSV`,
      detailsJson: JSON.stringify({ count: logs.length, confirmed, projected }),
    });
  }

  async function generateSuggestions() {
    const byNormalized = new Map<string, StudyLog[]>();
    for (const log of logs) {
      const key = normalizeRadiologyDescription(localTitle(log));
      byNormalized.set(key, [...(byNormalized.get(key) ?? []), log]);
    }
    for (const [key, grouped] of byNormalized) {
      if (grouped.length < 2) continue;
      const cptCodes = Array.from(new Set(grouped.filter((log) => log.cptCode && log.modifier === '26').map((log) => `${log.cptCode}-26`)));
      if (cptCodes.length === 0) continue;
      const existing = suggestions.find((suggestion) => suggestion.normalizedKey === key);
      if (existing) continue;
      await db.memorySuggestions.add({
        id: crypto.randomUUID(),
        profileId,
        siteId,
        suggestionType: cptCodes.length > 1 ? 'combo' : 'site_alias',
        prompt: `Remember ${grouped[0].examNameRaw} as ${cptCodes.join(' + ')} for ${activePractice?.name ?? 'this site'}?`,
        normalizedKey: key,
        cptCodes,
        occurrences: grouped.length,
        status: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
  }

  async function resolveSuggestion(suggestion: MemorySuggestion, status: 'approved' | 'rejected') {
    await db.memorySuggestions.update(suggestion.id, { status, updatedAt: new Date().toISOString() });
    if (status === 'approved') {
      const sourceLog = logs.find((log) => normalizeRadiologyDescription(localTitle(log)) === suggestion.normalizedKey);
      if (sourceLog) {
        await learnAlias({
          rawText: sourceLog.examNameRaw,
          canonicalExamName: localTitle(sourceLog),
          candidates: suggestion.cptCodes.map((serialized) => {
            const [cptCode, modifier] = serialized.split('-');
            const matchingLog = logs.find((log) => log.cptCode === cptCode);
            return { cptCode, modifier: modifier ?? '26', workRvu: matchingLog?.workRvu ?? null, description: matchingLog?.cmsDescription, modality: matchingLog?.modality };
          }),
          source: 'user',
          profileId,
          siteId,
          action: 'confirm',
        });
      }
    }
    await recordAuditEvent({
      profileId,
      siteId,
      sessionId: null,
      logDate: compareDate,
      action: status === 'approved' ? 'alias_learned' : 'cpt_changed',
      summary: `${status === 'approved' ? 'Approved' : 'Rejected'} memory suggestion: ${suggestion.prompt}`,
      detailsJson: JSON.stringify(suggestion),
    });
  }

  async function applyBulkCorrection(key: string) {
    if (!activeSession) return;
    const correction = bulkCorrections[key];
    const query = correction?.query.trim();
    if (!query) return;
    const matches = await searchExamLibrary(query, profileId);
    const selected = matches.find((match) => match.cptCode === query.replace(/\D/g, '')) ?? matches[0];
    if (!selected) return;

    const nextRows = activeRows.map((row) => {
      if (normalizeRadiologyDescription(row.source.examTitle) !== key) return row;
      const existingIndex = row.candidates.findIndex((candidate) => candidate.cptCode === selected.cptCode && (candidate.modifier ?? null) === (selected.modifier ?? null));
      const candidates = existingIndex >= 0 ? row.candidates : [selected, ...row.candidates];
      return {
        ...row,
        candidates,
        selectedCandidateIndex: 0,
        selectedCandidateIndices: [0],
        needsReview: false,
        reviewReason: null,
      };
    });

    await db.activeReviewSessions.update(activeSession.id, {
      rowsJson: JSON.stringify(nextRows),
      needsReviewCount: nextRows.filter((row) => row.needsReview).length,
      updatedAt: new Date().toISOString(),
    });

    const targetRows = activeRows.filter((row) => normalizeRadiologyDescription(row.source.examTitle) === key);
    const scope = correction?.scope ?? 'site';
    await learnAlias({
      rawText: targetRows[0]?.source.examTitle ?? key,
      canonicalExamName: selected.description,
      candidates: [{ cptCode: selected.cptCode, modifier: selected.modifier ?? '26', workRvu: selected.workRvu ?? null, description: selected.description, modality: selected.modality }],
      source: 'user',
      profileId: scope === 'future' ? null : profileId,
      siteId: scope === 'site' ? siteId : null,
      action: 'correct',
    });
    await recordAuditEvent({
      profileId,
      siteId,
      sessionId: activeSession.id,
      logDate: activeSession.readingDate,
      action: 'alias_learned',
      summary: `Bulk corrected ${targetRows.length} repeated OCR rows to ${selected.cptCode}${selected.modifier ? `-${selected.modifier}` : ''}`,
      detailsJson: JSON.stringify({ normalizedKey: key, scope, selected, rows: targetRows.map((row) => row.tempId) }),
    });
  }

  return (
    <div className="space-y-5 animate-in fade-in duration-300">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Productivity Automation</h1>
          <p className="text-slate-400 text-sm mt-0.5">Daily goal, hospital comparison, exports, audit history, and learning queue.</p>
        </div>
        <div className="flex items-center gap-2">
          <input type="date" value={compareDate} onChange={(event) => setCompareDate(event.target.value)} className="input" />
          <button onClick={exportFinalizedDay} className="px-3 py-2 rounded-lg border border-emerald-500/30 text-sm text-emerald-300 hover:bg-emerald-500/10">Export CSV</button>
        </div>
      </div>

      <div className="card space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-white">Daily Goal Tracker</p>
            <p className="text-xs text-slate-500">Confirmed is finalized local wRVU. Pending is estimated from the active review session.</p>
          </div>
          <p className="text-sm font-bold text-white">{fmt(projected)} / {fmt(goal)} wRVU</p>
        </div>
        <div className="h-3 rounded-full bg-white/8 overflow-hidden">
          <div className="h-full rounded-full bg-emerald-400" style={{ width: `${percent}%` }} />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <Metric label="Confirmed" value={fmt(confirmed)} tone="emerald" />
          <Metric label="Estimated pending" value={fmt(pending)} tone="amber" />
          <Metric label="Projected" value={fmt(projected)} tone="sky" />
          <Metric label="Remaining" value={fmt(remaining)} tone="slate" />
          <Metric label="Percent" value={`${Math.round(percent)}%`} tone="slate" />
        </div>
        {compRate != null && compRate > 0 && (
          <p className="text-xs text-slate-400">Estimated compensation: confirmed ${fmt(confirmed * compRate, 2)}; projected ${fmt(projected * compRate, 2)}.</p>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="card space-y-3">
          <div>
            <p className="text-sm font-semibold text-white">Hospital Comparison Mode</p>
            <p className="text-xs text-slate-500">Upload a CSV with exam, CPT, modifier, wRVU, and quantity columns.</p>
          </div>
          <input type="file" accept=".csv,text/csv,text/plain" onChange={(event) => void handleHospitalFile(event.target.files?.[0] ?? null)} className="text-sm text-slate-400" />
          <textarea value={reportText} onChange={(event) => setReportText(event.target.value)} rows={6} className="input w-full font-mono text-xs" placeholder="exam,cpt,modifier,wrvu,quantity" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Metric label="Hospital exams" value={String(hospitalRows.reduce((sum, row) => sum + row.quantity, 0))} tone="slate" />
            <Metric label="Local exams" value={String(logs.length)} tone="slate" />
            <Metric label="Discrepancies" value={String(discrepancies.length)} tone="amber" />
            <Metric label="Saved reports" value={String(storedReports.length)} tone="sky" />
          </div>
          <button onClick={() => void saveComparisonReport()} disabled={hospitalRows.length === 0} className="px-3 py-2 rounded-lg border border-sky-500/30 text-sm text-sky-300 hover:bg-sky-500/10 disabled:opacity-40">Save discrepancy report</button>
          <div className="max-h-56 overflow-y-auto space-y-2">
            {discrepancies.slice(0, 20).map((item, index) => (
              <div key={`${item.key}-${index}`} className="rounded-lg border border-white/8 bg-white/3 p-2 text-xs">
                <p className="font-semibold text-white">{item.type.replace(/_/g, ' ')}</p>
                <p className="text-slate-400">{item.summary}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="card space-y-3">
          <div>
            <p className="text-sm font-semibold text-white">OCR Performance Dashboard</p>
            <p className="text-xs text-slate-500">Snapshot for the selected day.</p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            <Metric label="Auto-approved" value={`${logs.length ? Math.round((autoApproved / logs.length) * 100) : 0}%`} tone="emerald" />
            <Metric label="Needs review" value={String(logs.filter((log) => log.needsReview).length + (activeSession?.needsReviewCount ?? 0))} tone="amber" />
            <Metric label="New aliases today" value={String(newAliasesToday)} tone="sky" />
            <Metric label="High confidence" value={String(confidenceBuckets.high)} tone="emerald" />
            <Metric label="Medium confidence" value={String(confidenceBuckets.medium)} tone="amber" />
            <Metric label="Low confidence" value={String(confidenceBuckets.low)} tone="red" />
          </div>
          <p className="text-xs text-slate-400">Average review pace: {averageReviewTime} min/action. Estimated time saved: {Math.round(autoApproved * 0.35)} min.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="card space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-white">Radiology Memory Assistant</p>
              <p className="text-xs text-slate-500">Suggests aliases, site mappings, and common combinations from repeated confirmations.</p>
            </div>
            <button onClick={() => void generateSuggestions()} className="px-3 py-1.5 rounded-lg border border-sky-500/30 text-xs text-sky-300 hover:bg-sky-500/10">Scan day</button>
          </div>
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {suggestions.length === 0 && <p className="text-xs text-slate-500">No pending suggestions.</p>}
            {suggestions.map((suggestion) => (
              <div key={suggestion.id} className="rounded-lg border border-white/8 bg-white/3 p-3 space-y-2">
                <p className="text-sm text-white">{suggestion.prompt}</p>
                <p className="text-xs text-slate-500">{suggestion.occurrences} occurrences; {suggestion.cptCodes.join(' + ')}</p>
                <div className="flex gap-2">
                  <button onClick={() => void resolveSuggestion(suggestion, 'approved')} className="px-2 py-1 rounded border border-emerald-500/30 text-xs text-emerald-300">Approve</button>
                  <button onClick={() => void resolveSuggestion(suggestion, 'rejected')} className="px-2 py-1 rounded border border-red-500/30 text-xs text-red-300">Reject</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card space-y-3">
          <div>
            <p className="text-sm font-semibold text-white">Bulk Learning Queue</p>
            <p className="text-xs text-slate-500">Repeated unknown OCR descriptions can be corrected once and applied across the active session.</p>
          </div>
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {unknownGroups.length === 0 && <p className="text-xs text-slate-500">No repeated unknowns in the active session.</p>}
            {unknownGroups.map((group) => {
              const correction = bulkCorrections[group.key] ?? { query: '', scope: 'site' as const };
              return (
                <div key={group.key} className="rounded-lg border border-white/8 bg-white/3 p-3 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm text-white">{group.sample}</p>
                      <p className="text-xs text-slate-500">{group.grouped.length} occurrences; normalized as {group.key}</p>
                    </div>
                    <span className="text-xs font-semibold text-amber-300">{group.grouped.length}x</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2">
                    <input
                      value={correction.query}
                      onChange={(event) => setBulkCorrections((current) => ({ ...current, [group.key]: { ...correction, query: event.target.value } }))}
                      className="input"
                      placeholder="CPT or exam name"
                    />
                    <select
                      value={correction.scope}
                      onChange={(event) => setBulkCorrections((current) => ({ ...current, [group.key]: { ...correction, scope: event.target.value as 'future' | 'site' | 'personal' } }))}
                      className="input"
                    >
                      <option value="site">Hospital-specific</option>
                      <option value="personal">Personal</option>
                      <option value="future">Remember future uploads</option>
                    </select>
                    <button onClick={() => void applyBulkCorrection(group.key)} className="px-3 py-2 rounded-lg border border-emerald-500/30 text-xs text-emerald-300 hover:bg-emerald-500/10">Apply</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card space-y-3">
          <div>
            <p className="text-sm font-semibold text-white">Audit History</p>
            <p className="text-xs text-slate-500">Finalized-day activity: imports, approvals, corrections, deletions, exports, and comparisons.</p>
          </div>
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {auditEntries.length === 0 && <p className="text-xs text-slate-500">No audit events for this day yet.</p>}
            {auditEntries.map((entry) => (
              <div key={entry.id} className="rounded-lg border border-white/8 bg-white/3 p-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold text-white">{entry.action.replace(/_/g, ' ')}</p>
                  <p className="text-slate-500">{new Date(entry.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                </div>
                <p className="text-slate-400">{entry.summary}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: 'emerald' | 'amber' | 'sky' | 'red' | 'slate' }) {
  const classes = {
    emerald: 'border-emerald-500/20 bg-emerald-500/8 text-emerald-300',
    amber: 'border-amber-500/20 bg-amber-500/8 text-amber-300',
    sky: 'border-sky-500/20 bg-sky-500/8 text-sky-300',
    red: 'border-red-500/20 bg-red-500/8 text-red-300',
    slate: 'border-white/8 bg-white/3 text-white',
  }[tone];
  return (
    <div className={`rounded-xl border px-3 py-2 ${classes}`}>
      <p className="text-[10px] uppercase tracking-wider opacity-75">{label}</p>
      <p className="text-lg font-bold">{value}</p>
    </div>
  );
}
