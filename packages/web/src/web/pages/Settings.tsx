import { useLiveQuery } from 'dexie-react-hooks';
import { useState, useRef } from 'react';
import { theme } from '../lib/theme';
import { db, ensureUserSettings } from '../db/database';
import { importRvuFile } from '../utils/rvuFileImporter';
import { buildSeedCptRows } from '../data/seedCptData';
import { normalizeExamText } from '../utils/textMatching';
import { isDesktop, getDesktopAPI } from '../lib/desktop';
import type { UserSettings, ExamAlias, ExamDictionaryEntry } from '../types';
import type { ImportResult } from '../utils/rvuFileImporter';

export function Settings() {
  const settings = useLiveQuery<UserSettings | undefined>(
    () => db.userSettings.get('default'),
    []
  );

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [cptCount, setCptCount] = useState<number | null>(null);
  const rvuFileRef = useRef<HTMLInputElement>(null);

  useLiveQuery(async () => {
    const count = await db.cptRvuTable.count();
    setCptCount(count);
  }, []);

  const [local, setLocal] = useState<Partial<UserSettings>>({});

  const merged: Partial<UserSettings> = { ...settings, ...local };

  function update(patch: Partial<UserSettings>) {
    setLocal((prev) => ({ ...prev, ...patch }));
  }

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      const current = await ensureUserSettings();
      await db.userSettings.put({
        ...current,
        ...local,
        updatedAt: new Date().toISOString(),
      });
      setLocal({});
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  async function handleRvuFileImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportError(null);
    setImportResult(null);
    try {
      const buf = await file.arrayBuffer();
      const label = file.name.replace(/\.(zip|csv|txt)$/i, '').slice(0, 20);
      const result = await importRvuFile(buf, file.name, label);
      setImportResult(result);
      const count = await db.cptRvuTable.count();
      setCptCount(count);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setImporting(false);
      if (rvuFileRef.current) rvuFileRef.current.value = '';
    }
  }

  async function handleClearData() {
    if (!confirm('Delete ALL study logs? This cannot be undone.')) return;
    await db.studyLogs.clear();
  }

  async function handleResetCpt() {
    if (!confirm('Clear CPT table and re-seed from built-in defaults?')) return;
    await db.cptRvuTable.clear();
    await db.cptRvuTable.bulkPut(buildSeedCptRows());
    const count = await db.cptRvuTable.count();
    setCptCount(count);
  }

  // ── Learned Mappings ───────────────────────────────────────────────────────
  const learnedAliases = useLiveQuery<ExamAlias[]>(
    () => db.examAliases.orderBy('lastUsedAt').reverse().toArray(),
    [],
  );
  const examDictionary = useLiveQuery<ExamDictionaryEntry[]>(
    () => db.examDictionary.orderBy('canonicalDisplayName').toArray(),
    [],
  );

  const [aliasSearch, setAliasSearch] = useState('');
  const [editingAlias, setEditingAlias] = useState<ExamAlias | null>(null);
  const [editRaw, setEditRaw] = useState('');

  const filteredAliases = (learnedAliases ?? []).filter((a) => {
    if (!aliasSearch.trim()) return true;
    const q = aliasSearch.toLowerCase();
    return (
      a.aliasTextRaw.toLowerCase().includes(q) ||
      a.canonicalExamName?.toLowerCase().includes(q) ||
      a.cptCode.includes(q)
    );
  });

  async function handleDeleteAlias(id: string) {
    if (!confirm('Delete this learned mapping?')) return;
    await db.examAliases.delete(id);
  }

  function startEditAlias(alias: ExamAlias) {
    setEditingAlias(alias);
    setEditRaw(alias.aliasTextRaw);
  }

  async function handleSaveAlias() {
    if (!editingAlias) return;
    const trimmed = editRaw.trim();
    if (!trimmed) return;
    await db.examAliases.update(editingAlias.id, {
      aliasTextRaw: trimmed,
      aliasText: normalizeExamText(trimmed),
    });
    setEditingAlias(null);
  }

  function formatCptList(alias: ExamAlias): string {
    if (alias.cptCodes && alias.cptCodes.length > 0) {
      return alias.cptCodes.join(' · ');
    }
    return alias.modifier ? `${alias.cptCode}-${alias.modifier}` : alias.cptCode;
  }

  function sourceLabel(source: ExamAlias['source']): string {
    switch (source) {
      case 'user':              return 'Manual search';
      case 'manual_name_match': return 'Quick log';
      case 'ocr_confirmed':     return 'OCR import';
      case 'manual':            return 'Manual';
      case 'seed':              return 'Built-in';
      default:                  return source;
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-in fade-in duration-300">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">Settings</h1>
        <p className="text-slate-400 text-sm mt-0.5">Goals, schedule, and RVU data</p>
      </div>

      {/* Goal settings */}
      <div className="card space-y-4">
        <h2 className="text-sm font-semibold text-white uppercase tracking-wider">Annual Goal</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Annual wRVU Goal</label>
            <input
              type="number"
              value={merged.annualRvuGoal ?? 15000}
              onChange={(e) => update({ annualRvuGoal: Number(e.target.value) })}
              min={1000}
              max={50000}
              step={500}
              className="input w-full"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Fiscal Year Start Month</label>
            <select
              value={merged.fiscalYearStartMonth ?? 1}
              onChange={(e) => update({ fiscalYearStartMonth: Number(e.target.value) })}
              className="input w-full"
            >
              {['January','February','March','April','May','June','July','August','September','October','November','December'].map((m, i) => (
                <option key={i + 1} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Workdays per Week</label>
            <input
              type="number"
              value={merged.workdaysPerWeek ?? 5}
              onChange={(e) => update({ workdaysPerWeek: Number(e.target.value) })}
              min={1}
              max={7}
              step={0.5}
              className="input w-full"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Vacation Days Planned</label>
            <input
              type="number"
              value={merged.vacationDaysPlanned ?? 0}
              onChange={(e) => update({ vacationDaysPlanned: Number(e.target.value) })}
              min={0}
              max={200}
              className="input w-full"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Low Confidence Threshold</label>
            <input
              type="number"
              value={merged.lowConfidenceThreshold ?? 0.75}
              onChange={(e) => update({ lowConfidenceThreshold: Number(e.target.value) })}
              min={0}
              max={1}
              step={0.05}
              className="input w-full"
            />
            <p className="text-[10px] text-slate-500 mt-1">Matches below this score flag for review</p>
          </div>
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className={`w-full py-2.5 rounded-xl text-sm font-semibold transition-all ${
            saved
              ? 'bg-emerald-500/20 border border-emerald-500/30 text-emerald-400'
              : 'text-white hover:opacity-90'
          }`}
          style={!saved ? { background: `linear-gradient(135deg, ${theme.colors.primary}, ${theme.colors.accent})` } : {}}
        >
          {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Settings'}
        </button>
      </div>

      {/* Daily Pace settings */}
      <div className="card space-y-4">
        <h2 className="text-sm font-semibold text-white uppercase tracking-wider">Daily Pace</h2>
        <p className="text-xs text-slate-400">Used by the Daily Pace tab to track real-time productivity during your shift.</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Daily wRVU Goal</label>
            <input
              type="number"
              value={merged.dailyRvuGoal ?? 90}
              onChange={(e) => update({ dailyRvuGoal: Number(e.target.value) })}
              min={1}
              max={500}
              step={5}
              className="input w-full"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Break Minutes</label>
            <input
              type="number"
              value={merged.breakMinutes ?? 0}
              onChange={(e) => update({ breakMinutes: Number(e.target.value) })}
              min={0}
              max={480}
              step={5}
              className="input w-full"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Workday Start</label>
            <input
              type="time"
              value={merged.workdayStart ?? '08:00'}
              onChange={(e) => update({ workdayStart: e.target.value })}
              className="input w-full"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Workday End</label>
            <input
              type="time"
              value={merged.workdayEnd ?? '17:00'}
              onChange={(e) => update({ workdayEnd: e.target.value })}
              className="input w-full"
            />
          </div>
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className={`w-full py-2.5 rounded-xl text-sm font-semibold transition-all ${
            saved
              ? 'bg-emerald-500/20 border border-emerald-500/30 text-emerald-400'
              : 'text-white hover:opacity-90'
          }`}
          style={!saved ? { background: `linear-gradient(135deg, ${theme.colors.primary}, ${theme.colors.accent})` } : {}}
        >
          {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Settings'}
        </button>
      </div>

      {/* RVU file import */}
      <div className="card space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white uppercase tracking-wider">CMS RVU File</h2>
          <span className="text-xs text-slate-400">
            {cptCount !== null ? `${cptCount.toLocaleString()} CPT codes loaded` : 'Loading…'}
          </span>
        </div>

        <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20">
          <p className="text-blue-300 text-xs font-medium">Import CY2026 PPRRVU file</p>
          <p className="text-blue-300/70 text-xs mt-1">
            Download the CMS Physician Fee Schedule ZIP from CMS.gov, then import here.
            Work RVUs are snapshotted at log time — existing logs are never modified.
          </p>
        </div>

        <div>
          <input
            ref={rvuFileRef}
            type="file"
            accept=".zip,.csv,.txt"
            onChange={handleRvuFileImport}
            className="hidden"
          />
          <button
            onClick={() => rvuFileRef.current?.click()}
            disabled={importing}
            className="w-full py-2.5 rounded-xl border border-white/15 text-slate-300 text-sm font-medium hover:border-white/30 hover:text-white transition-all disabled:opacity-50"
          >
            {importing ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border border-t-transparent rounded-full animate-spin" style={{ borderColor: `${theme.colors.accent} transparent transparent transparent` }} />
                Importing…
              </span>
            ) : (
              '📂 Select PPRRVU ZIP or CSV'
            )}
          </button>
        </div>

        {importError && (
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20">
            <p className="text-red-400 text-xs">{importError}</p>
          </div>
        )}

        {importResult && (
          <div className={`p-3 rounded-xl border text-xs space-y-1 ${
            importResult.success
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
              : 'bg-red-500/10 border-red-500/20 text-red-300'
          }`}>
            <p className="font-semibold">
              {importResult.success ? '✓ Import complete' : '✕ Import failed'} — {importResult.fileVersion}
            </p>
            <p>Added: {importResult.rowsAdded} · Updated: {importResult.rowsUpdated} · Unchanged: {importResult.rowsUnchanged}</p>
            {importResult.rowsSkippedNoWorkRvu > 0 && (
              <p className="text-slate-400">Skipped (no work RVU): {importResult.rowsSkippedNoWorkRvu}</p>
            )}
            {importResult.significantChanges.length > 0 && (
              <p className="text-amber-300">⚠️ {importResult.significantChanges.length} codes changed ≥5%</p>
            )}
            {importResult.errors.length > 0 && (
              <div className="mt-1 space-y-0.5">
                {importResult.errors.map((e, i) => (
                  <p key={i} className="text-slate-400">{e}</p>
                ))}
              </div>
            )}
          </div>
        )}

        <button
          onClick={handleResetCpt}
          className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
        >
          Reset to built-in seed data
        </button>
      </div>

      {/* Learned Mappings */}
      <div className="card space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-white uppercase tracking-wider">Learned Mappings</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              OCR titles you've manually corrected. Applied automatically on future imports.
            </p>
          </div>
          <span className="text-xs text-slate-500 shrink-0">
            {learnedAliases?.length ?? 0} saved
          </span>
        </div>

        {/* Search */}
        {(learnedAliases?.length ?? 0) > 0 && (
          <input
            type="text"
            value={aliasSearch}
            onChange={(e) => setAliasSearch(e.target.value)}
            placeholder="Search by raw title, exam name, or CPT…"
            className="input w-full text-xs"
          />
        )}

        {/* Edit modal */}
        {editingAlias && (
          <div className="rounded-xl border border-sky-500/30 bg-slate-800/80 p-3 space-y-2">
            <p className="text-xs text-sky-400 font-semibold uppercase tracking-wider">Edit Raw Title</p>
            <p className="text-[10px] text-slate-500">Changing the raw title updates the normalized lookup key.</p>
            <input
              autoFocus
              type="text"
              value={editRaw}
              onChange={(e) => setEditRaw(e.target.value)}
              className="input w-full text-xs"
            />
            <div className="flex gap-2">
              <button
                onClick={handleSaveAlias}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white"
                style={{ background: `linear-gradient(135deg, ${theme.colors.primary}, ${theme.colors.accent})` }}
              >
                Save
              </button>
              <button
                onClick={() => setEditingAlias(null)}
                className="px-3 py-1.5 rounded-lg text-xs text-slate-400 border border-white/10 hover:text-white transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Alias list */}
        {filteredAliases.length === 0 && (
          <div className="text-center py-8 text-slate-500 text-xs">
            {(learnedAliases?.length ?? 0) === 0
              ? 'No learned mappings yet. Correct an exam during import and it will appear here.'
              : 'No mappings match your search.'}
          </div>
        )}

        <div className="space-y-2">
          {filteredAliases.map((alias) => (
            <div
              key={alias.id}
              className="rounded-xl border border-white/8 bg-white/3 p-3 space-y-1.5 hover:border-white/15 transition-colors"
            >
              {/* Row header */}
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  {/* Raw OCR title */}
                  <p className="text-xs font-mono text-slate-300 truncate" title={alias.aliasTextRaw}>
                    {alias.aliasTextRaw}
                  </p>
                  {/* Arrow + canonical name */}
                  {alias.canonicalExamName && (
                    <p className="text-[10px] text-slate-500 mt-0.5 truncate">
                      → <span className="text-slate-400">{alias.canonicalExamName}</span>
                    </p>
                  )}
                </div>
                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => startEditAlias(alias)}
                    className="text-[10px] px-2 py-0.5 rounded border border-white/10 text-slate-400 hover:text-white hover:border-white/25 transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDeleteAlias(alias.id)}
                    className="text-[10px] px-2 py-0.5 rounded border border-red-500/20 text-red-400/70 hover:text-red-400 hover:border-red-500/40 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>

              {/* CPT codes + RVU */}
              <div className="flex items-center gap-3 flex-wrap">
                <span className="font-mono text-[10px] text-sky-400 bg-sky-500/10 px-1.5 py-0.5 rounded">
                  {formatCptList(alias)}
                </span>
                {alias.totalWorkRvu != null && alias.totalWorkRvu > 0 && (
                  <span className="text-[10px] text-emerald-400">
                    {alias.totalWorkRvu.toFixed(2)} wRVU
                  </span>
                )}
                <span className="text-[10px] text-slate-600 ml-auto">
                  {sourceLabel(alias.source)} · {Math.round((alias.matchConfidence ?? 0) * 100)}% · {alias.timesUsed}× used
                  {(alias.corrections ?? 0) > 0 && ` · ${alias.corrections} corrections`}
                  {alias.lastUsedAt && ` · ${new Date(alias.lastUsedAt).toLocaleDateString()}`}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Clear all */}
        {(learnedAliases?.length ?? 0) > 0 && (
          <button
            onClick={async () => {
              if (!confirm(`Delete all ${learnedAliases?.length} learned mappings?`)) return;
              await db.examAliases.clear();
            }}
            className="text-xs text-slate-500 hover:text-red-400 transition-colors"
          >
            Clear all learned mappings
          </button>
        )}
      </div>

      {/* Radiology Exam Dictionary */}
      <div className="card space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-white uppercase tracking-wider">Radiology Exam Dictionary</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Canonical exams, local synonyms, PowerScribe names, CPT groups, and modifier 26 wRVUs.
            </p>
          </div>
          <span className="text-xs text-slate-500 shrink-0">{examDictionary?.length ?? 0} exams</span>
        </div>
        {(examDictionary?.length ?? 0) === 0 ? (
          <div className="text-center py-6 text-slate-500 text-xs">
            No dictionary entries yet. Approved OCR corrections will seed canonical entries over time.
          </div>
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
            {(examDictionary ?? []).map((entry) => {
              const aliases = [
                ...entry.commonSynonyms,
                ...entry.hospitalAliases,
                ...entry.powerScribeNames,
              ];
              return (
                <div key={entry.id} className="rounded-xl border border-white/8 bg-white/3 p-3 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-white truncate">{entry.canonicalDisplayName}</p>
                      {entry.cmsDescription && (
                        <p className="text-[10px] text-slate-500 truncate">{entry.cmsDescription}</p>
                      )}
                    </div>
                    <span className="text-[10px] text-slate-500 shrink-0">
                      {entry.modality}{entry.bodyRegion ? ` · ${entry.bodyRegion}` : ''}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {entry.cptCodes.map((code) => (
                      <span key={code} className="font-mono text-[10px] text-sky-400 bg-sky-500/10 px-1.5 py-0.5 rounded">
                        {code}
                      </span>
                    ))}
                    {entry.modifier26Wrvu != null && (
                      <span className="text-[10px] text-emerald-400">{entry.modifier26Wrvu.toFixed(2)} wRVU</span>
                    )}
                  </div>
                  <p className="text-[10px] text-slate-500">
                    Aliases: {aliases.length ? aliases.join(' · ') : 'None yet'}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* PowerScribe Watcher settings */}
      {isDesktop() && (
        <div className="card space-y-4">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: theme.colors.textSecondary }}>
              PowerScribe Watcher
            </h2>
            <p className="text-xs mt-1" style={{ color: theme.colors.textMuted }}>
              Configure the folder watcher for automatic screenshot OCR import.
            </p>
          </div>

          {/* Watch folder path */}
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: theme.colors.textSecondary }}>
              Watch Folder
            </label>
            <div className="flex items-center gap-2">
              <div
                className="flex-1 rounded-lg px-3 py-2 text-sm font-mono truncate"
                style={{
                  background: theme.colors.bgDeep,
                  border: `1px solid ${theme.colors.border}`,
                  color: settings?.watchFolderPath ? theme.colors.textPrimary : theme.colors.textMuted,
                }}
              >
                {settings?.watchFolderPath ?? 'No folder selected'}
              </div>
              <button
                onClick={async () => {
                  const api = getDesktopAPI();
                  if (!api) return;
                  const paths = await api.showOpenDialog({
                    title: 'Select Watch Folder',
                    properties: ['openDirectory', 'createDirectory'],
                  });
                  if (paths.length > 0) {
                    const s = await ensureUserSettings();
                    await db.userSettings.put({ ...s, watchFolderPath: paths[0], updatedAt: new Date().toISOString() });
                  }
                }}
                className="px-3 py-2 rounded-lg text-sm font-medium"
                style={{ background: theme.colors.primary, color: '#fff', border: 'none', cursor: 'pointer' }}
              >
                Browse…
              </button>
              {settings?.watchFolderPath && (
                <button
                  onClick={async () => {
                    const s = await ensureUserSettings();
                    await db.userSettings.put({ ...s, watchFolderPath: null, updatedAt: new Date().toISOString() });
                  }}
                  className="px-3 py-2 rounded-lg text-sm"
                  style={{ background: theme.colors.bgDeep, color: theme.colors.textMuted, border: `1px solid ${theme.colors.border}`, cursor: 'pointer' }}
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Auto-delete toggle */}
          <label className="flex items-center justify-between cursor-pointer select-none">
            <div>
              <p className="text-sm" style={{ color: theme.colors.textPrimary }}>
                Auto-delete processed files
              </p>
              <p className="text-xs" style={{ color: theme.colors.textMuted }}>
                Delete screenshots after successful OCR. If off, files move to a <code>processed/</code> subfolder.
              </p>
            </div>
            <div
              onClick={async () => {
                const s = await ensureUserSettings();
                await db.userSettings.put({ ...s, autoDeleteProcessed: !s.autoDeleteProcessed, updatedAt: new Date().toISOString() });
              }}
              className="relative inline-flex items-center h-6 w-11 rounded-full transition-colors cursor-pointer shrink-0"
              style={{
                background: settings?.autoDeleteProcessed ? theme.colors.primary : theme.colors.bgDeep,
                border: `1px solid ${settings?.autoDeleteProcessed ? theme.colors.primary : theme.colors.border}`,
              }}
            >
              <span
                className="inline-block h-4 w-4 rounded-full bg-white shadow transition-transform"
                style={{ transform: settings?.autoDeleteProcessed ? 'translateX(22px)' : 'translateX(2px)' }}
              />
            </div>
          </label>
        </div>
      )}

      {/* Camera Capture / PHI Protection */}
      <div className="card space-y-4">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-white uppercase tracking-wider">Camera Capture</h2>
          <span className="text-xs px-2 py-0.5 rounded-full font-medium"
            style={{ background: 'rgba(91,184,212,0.15)', color: theme.colors.accent, border: `1px solid rgba(91,184,212,0.25)` }}>
            PHI Protection
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3">
          {[
            ['autoImportClipboardScreenshots', 'Automatically import screenshots from clipboard', 'When this app is focused, pasted PowerScribe screenshots can go directly into OCR.'],
            ['alwaysProcessPowerScribeClipboard', 'Always process PowerScribe screenshots', 'Skip the Process/Ignore banner for future pasted screenshots.'],
            ['clearClipboardAfterImport', 'Clear clipboard after import', 'Requested behavior for desktop wrapper support; browsers may block clipboard clearing.'],
          ].map(([key, label, description]) => (
            <label key={key} className="flex items-center justify-between gap-3 cursor-pointer select-none">
              <div>
                <p className="text-sm text-white font-medium">{label}</p>
                <p className="text-xs text-slate-500 mt-0.5">{description}</p>
              </div>
              <input
                type="checkbox"
                checked={Boolean((settings as any)?.[key])}
                onChange={async () => {
                  const s = await ensureUserSettings();
                  await db.userSettings.put({ ...s, [key]: !Boolean((s as any)[key]), updatedAt: new Date().toISOString() });
                }}
                className="h-4 w-4 accent-sky-500"
              />
            </label>
          ))}
        </div>
        <p className="text-xs text-slate-400 leading-relaxed">
          When photographing the PowerScribe list from a phone, mandatory cropping
          ensures patient identifiers (name, MRN, DOB, room) are excluded before
          OCR runs. This setting should remain <strong className="text-white">ON</strong> in
          all clinical environments.
        </p>

        {/* Require crop toggle */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm text-white font-medium">Require crop before OCR</p>
            <p className="text-xs text-slate-500 mt-0.5">
              {settings?.requireCropBeforeOcr !== false
                ? 'ON — mandatory crop step protects patient identifiers'
                : '⚠ OFF — full photos sent to OCR without PHI removal'}
            </p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer shrink-0">
            <input
              type="checkbox"
              className="sr-only"
              checked={settings?.requireCropBeforeOcr !== false}
              onChange={async () => {
                const s = settings;
                if (!s) return;
                const newVal = s.requireCropBeforeOcr === false ? true : false;
                if (!newVal) {
                  // Confirm before disabling
                  const ok = window.confirm(
                    '⚠ PHI Warning\n\n' +
                    'Disabling crop before OCR may expose patient identifiers.\n\n' +
                    'Full PowerScribe screenshots contain: patient name, MRN, DOB, room number, and account number.\n\n' +
                    'Only disable this in fully de-identified demo/testing scenarios.\n\n' +
                    'Continue?',
                  );
                  if (!ok) return;
                }
                await db.userSettings.put({ ...s, requireCropBeforeOcr: newVal, updatedAt: new Date().toISOString() });
              }}
            />
            <div
              className="w-11 h-6 rounded-full transition-colors duration-200"
              style={{
                background: settings?.requireCropBeforeOcr !== false ? theme.colors.primary : theme.colors.bgDeep,
                border: `1px solid ${settings?.requireCropBeforeOcr !== false ? theme.colors.primary : theme.colors.border}`,
              }}
            >
              <span
                className="inline-block h-4 w-4 rounded-full bg-white shadow transition-transform mt-0.5"
                style={{ transform: settings?.requireCropBeforeOcr !== false ? 'translateX(22px)' : 'translateX(2px)' }}
              />
            </div>
          </label>
        </div>

        {settings?.requireCropBeforeOcr === false && (
          <div className="px-3 py-2.5 rounded-xl bg-red-500/10 border border-red-500/25">
            <p className="text-red-400 text-xs font-medium">
              ⚠ Crop requirement is disabled. Enable it before using Camera Capture in a clinical setting.
            </p>
          </div>
        )}

        {/* Privacy summary */}
        <div className="px-3 py-2.5 rounded-xl bg-emerald-500/8 border border-emerald-500/20">
          <p className="text-emerald-400 text-xs font-medium mb-1">Privacy guarantees (always enforced)</p>
          <ul className="text-emerald-300/60 text-xs space-y-0.5">
            <li>• Original photo deleted immediately after crop is confirmed</li>
            <li>• Cropped image cleared from memory after OCR completes</li>
            <li>• No image saved to camera roll, disk, or cloud</li>
            <li>• All OCR runs locally — no external API calls</li>
          </ul>
        </div>
      </div>

      {/* Danger zone */}
      <div className="card space-y-3 border-red-500/20">
        <h2 className="text-sm font-semibold text-red-400 uppercase tracking-wider">Danger Zone</h2>
        <p className="text-xs text-slate-400">
          All data is stored locally in your browser (IndexedDB). Clearing browser data will delete everything.
        </p>
        <button
          onClick={handleClearData}
          className="px-4 py-2 rounded-lg border border-red-500/30 bg-red-500/10 text-red-400 text-sm hover:bg-red-500/20 transition-colors"
        >
          Delete All Study Logs
        </button>
      </div>

      {/* About */}
      <div className="card space-y-2">
        <h2 className="text-sm font-semibold text-white uppercase tracking-wider">About</h2>
        <p className="text-xs text-slate-400">
          wRVU Tracker — personal productivity tool for radiologists.
          All data is stored on-device. Not for billing, coding, or compliance.
        </p>
        <p className="text-xs text-slate-500">Built on CY2026 CMS PPRRVU data.</p>
      </div>
    </div>
  );
}
