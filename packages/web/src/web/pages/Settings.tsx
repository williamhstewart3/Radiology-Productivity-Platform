import { useLiveQuery } from 'dexie-react-hooks';
import { useState, useRef, type ReactNode } from 'react';
import { theme } from '../lib/theme';
import { db, ensureUserSettings } from '../db/database';
import { useProfile } from '../hooks/useProfile';
import { importRvuFile } from '../utils/rvuFileImporter';
import { dedupeCptRvuRowsForBulkPut } from '../utils/cptRowDeduplication';
import { buildSeedCptRows } from '../data/seedCptData';
import { normalizeExamText } from '../utils/textMatching';
import { recordAuditEvent } from '../utils/audit';
import { todayDateString } from '../utils/calculations';
import {
  importInstitutionProcedureMappings,
  type InstitutionProcedureMappingSummary,
} from '../utils/institutionProcedureMappingImporter';
import type { UserSettings, ExamAlias, ExamDictionaryEntry, MemorySuggestion, AuditLogEntry } from '../types';
import type { ImportResult } from '../utils/rvuFileImporter';

interface SettingsProps {
  onNavigate?: (tab: 'automation' | 'profiles' | 'locations' | 'admin') => void;
}

function SectionHeading({ children }: { children: ReactNode }) {
  return <h2 className="text-lg font-semibold text-white">{children}</h2>;
}

export function Settings({ onNavigate }: SettingsProps) {
  const { activeProfile } = useProfile();
  const profileId = activeProfile?.id ?? null;

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
  const institutionFileRef = useRef<HTMLInputElement>(null);
  const [institutionImporting, setInstitutionImporting] = useState(false);
  const [institutionImportError, setInstitutionImportError] = useState<string | null>(null);
  const [institutionImportSummary, setInstitutionImportSummary] = useState<InstitutionProcedureMappingSummary | null>(null);

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
    await db.cptRvuTable.bulkPut(dedupeCptRvuRowsForBulkPut(buildSeedCptRows(), 'settings CPT seed reset'));
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
  const institutionMappings = (examDictionary ?? []).filter((entry) => entry.source === 'institution');

  const [aliasSearch, setAliasSearch] = useState('');
  const [editingAlias, setEditingAlias] = useState<ExamAlias | null>(null);
  const [editRaw, setEditRaw] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);

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

  // ── Pending memory suggestions ────────────────────────────────────────────
  const pendingSuggestions = useLiveQuery<MemorySuggestion[]>(
    () => db.memorySuggestions.where('status').equals('pending').reverse().sortBy('createdAt'),
    [],
  ) ?? [];

  async function resolveSuggestion(suggestion: MemorySuggestion, status: 'approved' | 'rejected') {
    await db.memorySuggestions.update(suggestion.id, { status, updatedAt: new Date().toISOString() });
    await recordAuditEvent({
      profileId: suggestion.profileId,
      siteId: suggestion.siteId,
      sessionId: null,
      logDate: todayDateString(),
      action: 'memory_suggestion_resolved',
      summary: `${status === 'approved' ? 'Approved' : 'Rejected'} suggestion: ${suggestion.prompt}`,
      detailsJson: JSON.stringify({ suggestionId: suggestion.id, status }),
    });
  }

  // ── Audit history ──────────────────────────────────────────────────────────
  const [auditDate, setAuditDate] = useState(todayDateString());
  const auditEntries = useLiveQuery<AuditLogEntry[]>(
    async () => {
      const entries = await db.auditLogEntries.where('logDate').equals(auditDate).reverse().sortBy('createdAt');
      return entries.filter((entry) => entry.profileId === profileId || entry.profileId == null);
    },
    [auditDate, profileId],
  ) ?? [];

  async function handleInstitutionMappingImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setInstitutionImporting(true);
    setInstitutionImportError(null);
    setInstitutionImportSummary(null);
    try {
      const summary = await importInstitutionProcedureMappings(await file.arrayBuffer(), file.name, { replaceExisting: true });
      setInstitutionImportSummary(summary);
    } catch (error) {
      setInstitutionImportError(error instanceof Error ? error.message : 'Institution mapping import failed');
    } finally {
      setInstitutionImporting(false);
      if (institutionFileRef.current) institutionFileRef.current.value = '';
    }
  }

  async function handleClearInstitutionMappings() {
    if (!confirm(`Clear ${institutionMappings.length} institution procedure mappings?`)) return;
    const ids = institutionMappings.map((entry) => entry.id);
    if (ids.length > 0) await db.examDictionary.bulkDelete(ids);
    setInstitutionImportSummary(null);
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

  const saveButtonClass = `w-full py-2.5 rounded-xl text-sm font-semibold transition-all ${
    saved
      ? 'bg-emerald-500/20 border border-emerald-500/30 text-emerald-400'
      : 'text-white hover:opacity-90'
  }`;
  const saveButtonStyle = !saved ? { background: `linear-gradient(135deg, ${theme.colors.primary}, ${theme.colors.accent})` } : {};

  return (
    <div className="max-w-2xl mx-auto space-y-8 animate-in fade-in duration-300">
      <h1 className="text-2xl font-bold text-white tracking-tight">Settings</h1>

      {/* ── Profile & goals ─────────────────────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeading>Profile & goals</SectionHeading>

        {onNavigate && (
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => onNavigate('profiles')}
              className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-left transition-all hover:border-white/20 hover:bg-white/[0.06]"
            >
              <p className="text-sm font-medium text-white">Profiles</p>
              <p className="mt-0.5 text-xs text-slate-500">Radiologists and goals</p>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('locations')}
              className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-left transition-all hover:border-white/20 hover:bg-white/[0.06]"
            >
              <p className="text-sm font-medium text-white">Locations</p>
              <p className="mt-0.5 text-xs text-slate-500">Practices and workspaces</p>
            </button>
          </div>
        )}

        <div className="card space-y-4">
          <p className="text-xs font-medium text-slate-400">Annual goal</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Annual wRVU goal</label>
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
              <label className="block text-xs text-slate-400 mb-1.5">Fiscal year start month</label>
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
              <label className="block text-xs text-slate-400 mb-1.5">Workdays per week</label>
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
              <label className="block text-xs text-slate-400 mb-1.5">Vacation days planned</label>
              <input
                type="number"
                value={merged.vacationDaysPlanned ?? 0}
                onChange={(e) => update({ vacationDaysPlanned: Number(e.target.value) })}
                min={0}
                max={200}
                className="input w-full"
              />
            </div>
          </div>

          <p className="text-xs font-medium text-slate-400 pt-2">Daily pace</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Daily wRVU goal</label>
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
              <label className="block text-xs text-slate-400 mb-1.5">Break minutes</label>
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
              <label className="block text-xs text-slate-400 mb-1.5">Workday start</label>
              <input
                type="time"
                value={merged.workdayStart ?? '08:00'}
                onChange={(e) => update({ workdayStart: e.target.value })}
                className="input w-full"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Workday end</label>
              <input
                type="time"
                value={merged.workdayEnd ?? '17:00'}
                onChange={(e) => update({ workdayEnd: e.target.value })}
                className="input w-full"
              />
            </div>
          </div>

          <button onClick={handleSave} disabled={saving} className={saveButtonClass} style={saveButtonStyle}>
            {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save settings'}
          </button>
        </div>
      </section>

      {/* ── Capture & matching ──────────────────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeading>Capture & matching</SectionHeading>

        <div className="card space-y-4">
          <p className="text-sm font-medium text-white">PowerScribe capture</p>

          <div className="grid grid-cols-1 gap-3">
            {[
              ['autoImportClipboardScreenshots', 'Automatically import screenshots from clipboard', 'When this app is focused, pasted PowerScribe screenshots can go directly into Capture.'],
              ['alwaysProcessPowerScribeClipboard', 'Automatically process detected PowerScribe captures', 'Skip the Process/Ignore confirmation for future pasted PowerScribe screenshots.'],
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

          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm text-white font-medium">Require crop before OCR</p>
              <p className="text-xs text-slate-500 mt-0.5">
                {settings?.requireCropBeforeOcr !== false
                  ? 'On — mandatory crop step protects patient identifiers'
                  : '⚠ Off — full photos sent to OCR without PHI removal'}
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
                    const ok = window.confirm(
                      'PHI warning\n\n' +
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
                Crop requirement is disabled. Enable it before using PowerScribe Capture in a clinical setting.
              </p>
            </div>
          )}
        </div>

        {/* Learned mappings */}
        <div className="card space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-white">Learned mappings</p>
              <p className="text-xs text-slate-500 mt-0.5">
                OCR titles you've manually corrected. Applied automatically on future imports.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {pendingSuggestions.length > 0 && (
                <button
                  onClick={() => setShowSuggestions((v) => !v)}
                  className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 font-medium"
                >
                  {pendingSuggestions.length} pending
                </button>
              )}
              <span className="text-xs text-slate-500">{learnedAliases?.length ?? 0} saved</span>
            </div>
          </div>

          {showSuggestions && pendingSuggestions.length > 0 && (
            <div className="space-y-2">
              {pendingSuggestions.map((suggestion) => (
                <div key={suggestion.id} className="rounded-lg border border-amber-500/20 bg-amber-500/8 p-2.5 text-xs space-y-1.5">
                  <p className="text-amber-100">{suggestion.prompt}</p>
                  <div className="flex gap-2">
                    <button onClick={() => resolveSuggestion(suggestion, 'approved')} className="text-[11px] px-2 py-0.5 rounded border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10">Approve</button>
                    <button onClick={() => resolveSuggestion(suggestion, 'rejected')} className="text-[11px] px-2 py-0.5 rounded border border-white/12 text-slate-400 hover:text-white">Reject</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {(learnedAliases?.length ?? 0) > 0 && (
            <input
              type="text"
              value={aliasSearch}
              onChange={(e) => setAliasSearch(e.target.value)}
              placeholder="Search by raw title, exam name, or CPT"
              className="input w-full text-xs"
            />
          )}

          {editingAlias && (
            <div className="rounded-xl border border-sky-500/30 bg-slate-800/80 p-3 space-y-2">
              <p className="text-xs text-sky-400 font-semibold">Edit raw title</p>
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
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-mono text-slate-300 truncate" title={alias.aliasTextRaw}>
                      {alias.aliasTextRaw}
                    </p>
                    {alias.canonicalExamName && (
                      <p className="text-[10px] text-slate-500 mt-0.5 truncate">
                        → <span className="text-slate-400">{alias.canonicalExamName}</span>
                      </p>
                    )}
                  </div>
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
                      Remove
                    </button>
                  </div>
                </div>

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

        <div className="card space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-white">Institution procedure mappings</p>
              <p className="text-xs text-slate-500 mt-0.5">
                Local MR, US, and CT procedure-to-CPT mappings. These outrank generic CMS fuzzy matching.
              </p>
            </div>
            <span className="text-xs text-slate-500 shrink-0">{institutionMappings.length} rows</span>
          </div>

          <input
            ref={institutionFileRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={handleInstitutionMappingImport}
            className="hidden"
          />

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => institutionFileRef.current?.click()}
              disabled={institutionImporting}
              className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 disabled:opacity-50 text-xs font-medium text-white transition-colors"
            >
              {institutionImporting ? 'Importing…' : 'Upload .xlsx'}
            </button>
            {institutionMappings.length > 0 && (
              <button
                onClick={handleClearInstitutionMappings}
                className="px-3 py-2 rounded-lg border border-red-500/20 text-xs font-medium text-red-300 hover:border-red-500/40 transition-colors"
              >
                Clear mappings
              </button>
            )}
          </div>

          {institutionImportError && (
            <p className="text-xs text-red-400">{institutionImportError}</p>
          )}

          {institutionImportSummary && (
            <div className="rounded-xl border border-white/8 bg-black/20 p-3 space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  ['Total rows', institutionImportSummary.totalRows],
                  ['Mapped rows', institutionImportSummary.mappedRows],
                  ['Blank CPT', institutionImportSummary.skippedBlankCptRows],
                  ['Multi-CPT', institutionImportSummary.multiCptRows],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg bg-white/5 p-2">
                    <p className="text-[10px] text-slate-500">{label}</p>
                    <p className="mt-1 text-sm font-semibold text-white">{value}</p>
                  </div>
                ))}
              </div>
              <p className="text-xs text-slate-400">
                Modality counts:{' '}
                {Object.entries(institutionImportSummary.modalityCounts)
                  .map(([modality, count]) => `${modality} ${count}`)
                  .join(' - ') || 'None'}
                {institutionImportSummary.replacedEntries > 0 && ` - replaced ${institutionImportSummary.replacedEntries}`}
              </p>
              {institutionImportSummary.warnings.length > 0 && (
                <div className="space-y-1">
                  {institutionImportSummary.warnings.map((warning) => (
                    <p key={warning} className="text-xs text-amber-300">{warning}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <details className="card">
          <summary className="cursor-pointer select-none text-sm font-medium text-white">
            Radiology exam dictionary ({examDictionary?.length ?? 0})
          </summary>
          <div className="mt-3 space-y-3">
            <p className="text-xs text-slate-500">
              Canonical exams, local synonyms, PowerScribe names, CPT groups, and modifier 26 wRVUs.
            </p>
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
                        {entry.cptCodes.length === 0 ? (
                          <span className="text-[10px] text-amber-300 bg-amber-500/10 px-1.5 py-0.5 rounded">
                            Reference only - no CPT
                          </span>
                        ) : (
                          entry.cptCodes.map((code) => (
                            <span key={code} className="font-mono text-[10px] text-sky-400 bg-sky-500/10 px-1.5 py-0.5 rounded">
                              {code}
                            </span>
                          ))
                        )}
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
        </details>

        <p className="text-xs text-slate-500 leading-relaxed px-1">
          Privacy: original photos are deleted immediately after crop is confirmed, cropped
          images are cleared from memory after OCR completes, nothing is saved to camera
          roll/disk/cloud, and OCR runs entirely on-device.
        </p>
      </section>

      {/* ── Data & privacy ──────────────────────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeading>Data & privacy</SectionHeading>

        <div className="card space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-white">CMS RVU file</p>
            <span className="text-xs text-slate-400">
              {cptCount !== null ? `${cptCount.toLocaleString()} CPT codes loaded` : 'Loading…'}
            </span>
          </div>

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
              'Select PPRRVU ZIP or CSV'
            )}
          </button>

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
                {importResult.success ? 'Import complete' : 'Import failed'} — {importResult.fileVersion}
              </p>
              <p>Added: {importResult.rowsAdded} · Updated: {importResult.rowsUpdated} · Unchanged: {importResult.rowsUnchanged}</p>
              {importResult.rowsSkippedNoWorkRvu > 0 && (
                <p className="text-slate-400">Skipped (no work RVU): {importResult.rowsSkippedNoWorkRvu}</p>
              )}
              {importResult.significantChanges.length > 0 && (
                <p className="text-amber-300">{importResult.significantChanges.length} codes changed 5% or more</p>
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

        <details className="card">
          <summary className="cursor-pointer select-none text-sm font-medium text-white">Audit history</summary>
          <div className="mt-3 space-y-3">
            <input
              type="date"
              value={auditDate}
              onChange={(e) => setAuditDate(e.target.value)}
              className="input"
            />
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {auditEntries.length === 0 && <p className="text-xs text-slate-500">No audit events for this day.</p>}
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
        </details>

        <div className="card space-y-3 border-red-500/20">
          <p className="text-sm font-medium text-red-400">Danger zone</p>
          <p className="text-xs text-slate-400">
            All data is stored locally in your browser (IndexedDB). Clearing browser data will delete everything.
          </p>
          <button
            onClick={handleClearData}
            className="px-4 py-2 rounded-lg border border-red-500/30 bg-red-500/10 text-red-400 text-sm hover:bg-red-500/20 transition-colors"
          >
            Delete all study logs
          </button>
        </div>

        <div className="space-y-1 px-1">
          <p className="text-xs text-slate-400">
            wRVU Tracker — personal productivity tool for radiologists. All data is stored
            on-device. Not for billing, coding, or compliance.
          </p>
          <p className="text-xs text-slate-500">Built on CY2026 CMS PPRRVU data.</p>
        </div>
      </section>

      {/* ── Advanced ─────────────────────────────────────────────────────── */}
      {onNavigate && (
        <details className="card">
          <summary className="cursor-pointer select-none text-sm font-medium text-white">Advanced</summary>
          <div className="mt-3">
            <button
              type="button"
              onClick={() => onNavigate('admin')}
              className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-left transition-all hover:border-white/20 hover:bg-white/[0.06]"
            >
              <p className="text-sm font-medium text-white">Admin data</p>
              <p className="mt-0.5 text-xs text-slate-500">CPT tables, RVU file versions, and diagnostics</p>
            </button>
          </div>
        </details>
      )}
    </div>
  );
}
