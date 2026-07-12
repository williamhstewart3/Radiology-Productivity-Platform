import { useLiveQuery } from 'dexie-react-hooks';
import { useState, useRef } from 'react';
import { db, ensureUserSettings } from '../db/database';
import { importRvuFile } from '../utils/rvuFileImporter';
import { dedupeCptRvuRowsForBulkPut } from '../utils/cptRowDeduplication';
import { buildSeedCptRows } from '../data/seedCptData';
import { normalizeExamText } from '../utils/textMatching';
import {
  importInstitutionProcedureMappings,
  type InstitutionProcedureMappingSummary,
} from '../utils/institutionProcedureMappingImporter';
import { GroupedList, Row } from '../components/ui/GroupedList';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import type { UserSettings, ExamAlias, ExamDictionaryEntry } from '../types';
import type { ImportResult } from '../utils/rvuFileImporter';
import { supabasePersistence } from '../services/supabasePersistence';
import { effectiveAutoCommitThreshold } from '../services/automationSettings';

interface SettingsProps {
  onNavigate?: (tab: 'automation' | 'profiles' | 'locations' | 'admin') => void;
}

export function Settings({ onNavigate }: SettingsProps) {
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

  async function setTheme(theme: 'light' | 'dark' | 'system') {
    const current = await ensureUserSettings();
    await db.userSettings.put({ ...current, theme, updatedAt: new Date().toISOString() });
  }

  async function setCompRate(value: number | null) {
    const current = await ensureUserSettings();
    await db.userSettings.put({ ...current, estimatedCompPerWrvu: value, updatedAt: new Date().toISOString() });
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

  // ── Aliases ─────────────────────────────────────────────────────────────
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
    if (alias.cptCodes && alias.cptCodes.length > 0) return alias.cptCodes.join(' · ');
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
    <div className="mx-auto max-w-2xl space-y-8">
      <h1 className="text-[34px] font-bold leading-tight text-rd-label-primary">Settings</h1>

      {/* ── Profiles & locations ─────────────────────────────────────── */}
      <section className="space-y-3">
        <p className="px-1 text-[13px] font-medium text-rd-label-secondary">Profiles & locations</p>

        {onNavigate && (
          <GroupedList>
            <Row onClick={() => onNavigate('profiles')} footnote="Radiologists and goals" trailing={<span className="text-rd-label-secondary">›</span>}>
              Profiles
            </Row>
            <Row onClick={() => onNavigate('locations')} footnote="Practices and workspaces" trailing={<span className="text-rd-label-secondary">›</span>}>
              Locations
            </Row>
            <Row onClick={() => onNavigate('automation')} footnote="Capture and review behavior" trailing={<span className="text-rd-label-secondary">›</span>}>
              Automation
            </Row>
            {onNavigate && (
              <Row onClick={() => onNavigate('admin')} footnote="CPT tables and diagnostics" trailing={<span className="text-rd-label-secondary">›</span>}>
                Admin data
              </Row>
            )}
          </GroupedList>
        )}

        <div className="rounded-[16px] bg-rd-surface p-4 space-y-4" style={{ boxShadow: 'var(--rd-shadow-card)' }}>
          <div className="grid grid-cols-2 gap-4">
            <label className="grid gap-1 text-[13px] text-rd-label-secondary">
              Annual wRVU goal
              <input
                type="number"
                aria-label="Annual wRVU goal"
                value={merged.annualRvuGoal ?? 15000}
                onChange={(e) => update({ annualRvuGoal: Number(e.target.value) })}
                min={1000} max={50000} step={500}
                className="h-10 rounded-[8px] bg-rd-bg px-3 text-[15px] text-rd-label-primary"
              />
            </label>
            <label className="grid gap-1 text-[13px] text-rd-label-secondary">
              Daily wRVU goal
              <input
                type="number"
                aria-label="Daily wRVU goal"
                value={merged.dailyRvuGoal ?? 90}
                onChange={(e) => update({ dailyRvuGoal: Number(e.target.value) })}
                min={1} max={500} step={5}
                className="h-10 rounded-[8px] bg-rd-bg px-3 text-[15px] text-rd-label-primary"
              />
            </label>
            <label className="grid gap-1 text-[13px] text-rd-label-secondary">
              Workday start
              <input
                type="time"
                aria-label="Workday start"
                value={merged.workdayStart ?? '08:00'}
                onChange={(e) => update({ workdayStart: e.target.value })}
                className="h-10 rounded-[8px] bg-rd-bg px-3 text-[15px] text-rd-label-primary"
              />
            </label>
            <label className="grid gap-1 text-[13px] text-rd-label-secondary">
              Workday end
              <input
                type="time"
                aria-label="Workday end"
                value={merged.workdayEnd ?? '17:00'}
                onChange={(e) => update({ workdayEnd: e.target.value })}
                className="h-10 rounded-[8px] bg-rd-bg px-3 text-[15px] text-rd-label-primary"
              />
            </label>
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className="min-h-11 w-full rounded-[10px] text-[15px] font-semibold text-white disabled:opacity-60"
            style={{ background: saved ? 'var(--rd-positive)' : 'var(--rd-accent)' }}
          >
            {saving ? 'Saving…' : saved ? 'Saved' : 'Save'}
          </button>
        </div>
      </section>

      <section className="space-y-3">
        <p className="px-1 text-[13px] font-medium text-rd-label-secondary">Automation</p>
        <div className="rounded-[16px] bg-rd-surface p-4 space-y-4" style={{ boxShadow: 'var(--rd-shadow-card)' }}>
          <label className="grid gap-2 text-[13px] text-rd-label-secondary">
            <span className="flex justify-between"><span>Auto-commit threshold</span><span className="font-mono text-rd-label-primary">{Math.round(effectiveAutoCommitThreshold(merged.lowConfidenceThreshold) * 100)}%</span></span>
            <input type="range" min="0.95" max="0.99" step="0.01" value={effectiveAutoCommitThreshold(merged.lowConfidenceThreshold)} onChange={(event) => update({ lowConfidenceThreshold: Number(event.target.value) })} aria-label="Auto-commit threshold" />
          </label>
          <p className="text-[13px] leading-relaxed text-rd-label-secondary">Learned matches this confident are counted without asking. Lower-confidence and duplicate decisions always go to Inbox.</p>
          <button type="button" onClick={handleSave} disabled={saving} className="min-h-11 w-full rounded-[10px] bg-rd-label-primary text-[15px] font-semibold text-rd-bg disabled:opacity-60">{saved ? 'Saved' : 'Save automation'}</button>
        </div>
      </section>

      <section className="space-y-3">
        <p className="px-1 text-[13px] font-medium text-rd-label-secondary">Data & privacy</p>
        <div className="rounded-[16px] bg-rd-surface p-4 text-[13px] leading-relaxed text-rd-label-secondary" style={{ boxShadow: 'var(--rd-shadow-card)' }}>
          <p className="font-semibold text-rd-label-primary">Local-first · remote persistence {supabasePersistence.isConfigured() ? 'enabled' : 'disabled'}</p>
          <p className="mt-1">{supabasePersistence.isConfigured() ? 'Remote persistence was explicitly enabled for this build.' : 'Study data, screenshots, OCR, aliases, and logs stay on this device.'}</p>
          {supabasePersistence.hasCredentials() && !supabasePersistence.isConfigured() && <p className="mt-1 text-rd-caution">Credentials are present, but the privacy gate remains off.</p>}
        </div>
      </section>

      {/* ── Aliases ───────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <p className="px-1 text-[13px] font-medium text-rd-label-secondary">
          Aliases {learnedAliases && `· ${learnedAliases.length} saved`}
        </p>

        {(learnedAliases?.length ?? 0) > 0 && (
          <input
            type="text"
            aria-label="Search learned aliases"
            value={aliasSearch}
            onChange={(e) => setAliasSearch(e.target.value)}
            placeholder="Search by raw title, exam name, or CPT"
            className="h-10 w-full rounded-[10px] bg-rd-surface px-3 text-[15px] text-rd-label-primary"
            style={{ boxShadow: 'var(--rd-shadow-card)' }}
          />
        )}

        {editingAlias && (
          <div className="rounded-[12px] bg-rd-surface p-3 space-y-2" style={{ boxShadow: 'var(--rd-shadow-card)' }}>
            <p className="text-[13px] font-medium text-rd-label-primary">Edit raw title</p>
            <input
              type="text"
              aria-label="Raw title"
              value={editRaw}
              onChange={(e) => setEditRaw(e.target.value)}
              className="h-9 w-full rounded-[8px] bg-rd-bg px-2 text-[13px] text-rd-label-primary"
            />
            <div className="flex gap-2">
              <button onClick={handleSaveAlias} className="rounded-[8px] px-3 py-1.5 text-[13px] font-semibold text-white" style={{ background: 'var(--rd-accent)' }}>
                Save
              </button>
              <button onClick={() => setEditingAlias(null)} className="rounded-[8px] px-3 py-1.5 text-[13px] text-rd-label-secondary">
                Cancel
              </button>
            </div>
          </div>
        )}

        <GroupedList footer={(learnedAliases?.length ?? 0) === 0 ? 'Correct an exam during import and it will appear here.' : undefined}>
          {filteredAliases.length === 0 && <Row footnote="No matches">No learned mappings yet</Row>}
          {filteredAliases.map((alias) => (
            <Row
              key={alias.id}
              footnote={`${formatCptList(alias)} · ${sourceLabel(alias.source)} · ${alias.timesUsed}× used`}
              trailing={
                <div className="flex items-center gap-1.5">
                  <button onClick={() => startEditAlias(alias)} className="rounded-[6px] px-2 py-1 text-[12px] text-rd-accent">Edit</button>
                  <button onClick={() => handleDeleteAlias(alias.id)} className="rounded-[6px] px-2 py-1 text-[12px] text-red-400">Remove</button>
                </div>
              }
            >
              {alias.aliasTextRaw}
              {alias.canonicalExamName && <span className="text-rd-label-secondary"> → {alias.canonicalExamName}</span>}
            </Row>
          ))}
        </GroupedList>
      </section>

      {/* ── Appearance ────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <p className="px-1 text-[13px] font-medium text-rd-label-secondary">Appearance</p>
        <div className="rounded-[16px] bg-rd-surface p-3" style={{ boxShadow: 'var(--rd-shadow-card)' }}>
          <SegmentedControl
            options={[
              { value: 'system', label: 'Auto' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
            value={settings?.theme ?? 'dark'}
            onChange={setTheme}
          />
        </div>
      </section>

      {/* ── Compensation ──────────────────────────────────────────────── */}
      <section className="space-y-3">
        <p className="px-1 text-[13px] font-medium text-rd-label-secondary">Compensation</p>
        <GroupedList footer="Off by default. When set, Today and Trends show an estimated earned-$ footnote.">
          <Row footnote="Optional — leave blank to hide">
            <div className="flex items-center justify-between gap-3">
              <span>$ per wRVU</span>
              <input
                type="number"
                aria-label="Dollars per wRVU"
                value={merged.estimatedCompPerWrvu ?? ''}
                onChange={(e) => setCompRate(e.target.value === '' ? null : Number(e.target.value))}
                placeholder="Off"
                min={0}
                step={1}
                className="h-9 w-28 rounded-[8px] bg-rd-bg px-2 text-right text-[15px] text-rd-label-primary"
              />
            </div>
          </Row>
        </GroupedList>
      </section>

      {/* ── Data & privacy ────────────────────────────────────────────── */}
      <section className="space-y-3">
        <p className="px-1 text-[13px] font-medium text-rd-label-secondary">Data & privacy</p>

        <div className="rounded-[16px] bg-rd-surface p-4 space-y-3" style={{ boxShadow: 'var(--rd-shadow-card)' }}>
          <div className="flex items-center justify-between">
            <p className="text-[15px] text-rd-label-primary">CMS RVU file</p>
            <span className="text-[13px] text-rd-label-secondary">
              {cptCount !== null ? `${cptCount.toLocaleString()} codes` : 'Loading…'}
            </span>
          </div>
          <input ref={rvuFileRef} type="file" aria-label="Select CMS RVU file" accept=".zip,.csv,.txt" onChange={handleRvuFileImport} className="hidden" />
          <button
            onClick={() => rvuFileRef.current?.click()}
            disabled={importing}
            className="min-h-10 w-full rounded-[10px] bg-rd-bg text-[13px] font-medium text-rd-label-primary disabled:opacity-50"
          >
            {importing ? 'Importing…' : 'Select PPRRVU ZIP or CSV'}
          </button>
          {importError && <p className="text-[13px] text-red-400">{importError}</p>}
          {importResult && (
            <p className="text-[13px] text-rd-label-secondary">
              {importResult.success ? 'Import complete' : 'Import failed'} — added {importResult.rowsAdded}, updated {importResult.rowsUpdated}
            </p>
          )}
          <button onClick={handleResetCpt} className="text-[13px] text-rd-label-secondary">
            Reset to built-in seed data
          </button>
        </div>

        <details className="rounded-[16px] bg-rd-surface p-4" style={{ boxShadow: 'var(--rd-shadow-card)' }}>
          <summary className="cursor-pointer text-[15px] text-rd-label-primary">
            Institution procedure mappings {institutionMappings.length > 0 && `(${institutionMappings.length})`}
          </summary>
          <div className="mt-3 space-y-3">
            <p className="text-[13px] text-rd-label-secondary">Local MR, US, and CT procedure-to-CPT mappings. These outrank generic CMS fuzzy matching.</p>
            <input ref={institutionFileRef} type="file" aria-label="Upload institution procedure mappings" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={handleInstitutionMappingImport} className="hidden" />
            <div className="flex flex-wrap gap-2">
              <button onClick={() => institutionFileRef.current?.click()} disabled={institutionImporting} className="rounded-[8px] bg-rd-bg px-3 py-2 text-[13px] font-medium text-rd-label-primary disabled:opacity-50">
                {institutionImporting ? 'Importing…' : 'Upload .xlsx'}
              </button>
              {institutionMappings.length > 0 && (
                <button onClick={handleClearInstitutionMappings} className="rounded-[8px] px-3 py-2 text-[13px] font-medium text-red-400">
                  Clear mappings
                </button>
              )}
            </div>
            {institutionImportError && <p className="text-[13px] text-red-400">{institutionImportError}</p>}
            {institutionImportSummary && (
              <p className="text-[13px] text-rd-label-secondary">
                {institutionImportSummary.totalRows} rows · {institutionImportSummary.mappedRows} mapped
              </p>
            )}
          </div>
        </details>

        <details className="rounded-[16px] bg-rd-surface p-4" style={{ boxShadow: 'var(--rd-shadow-card)' }}>
          <summary className="cursor-pointer text-[15px] text-rd-label-primary">
            Radiology exam dictionary {examDictionary && `(${examDictionary.length})`}
          </summary>
          <div className="mt-3 max-h-80 space-y-2 overflow-y-auto pr-1">
            {(examDictionary?.length ?? 0) === 0 ? (
              <p className="text-[13px] text-rd-label-secondary">No dictionary entries yet.</p>
            ) : (
              (examDictionary ?? []).map((entry) => (
                <div key={entry.id} className="rounded-[10px] bg-rd-bg p-2.5">
                  <p className="truncate text-[13px] font-medium text-rd-label-primary">{entry.canonicalDisplayName}</p>
                  <p className="text-[12px] text-rd-label-secondary">{entry.cptCodes.join(' · ') || 'Reference only'}</p>
                </div>
              ))
            )}
          </div>
        </details>

        <details className="rounded-[16px] bg-rd-surface p-4" style={{ boxShadow: 'var(--rd-shadow-card)' }}>
          <summary className="cursor-pointer text-[15px] text-rd-label-primary">PowerScribe capture</summary>
          <div className="mt-3 space-y-3">
            {[
              ['autoImportClipboardScreenshots', 'Automatically import screenshots from clipboard', 'When this app is focused, pasted PowerScribe screenshots can go directly into Capture.'],
              ['alwaysProcessPowerScribeClipboard', 'Automatically process detected captures', 'Skip the Process/Ignore confirmation for future pasted screenshots.'],
              ['clearClipboardAfterImport', 'Clear clipboard after import', 'Requested for desktop wrapper support; browsers may block clipboard clearing.'],
            ].map(([key, label, description]) => (
              <label key={key} className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[15px] text-rd-label-primary">{label}</p>
                  <p className="text-[13px] text-rd-label-secondary">{description}</p>
                </div>
                <input
                  type="checkbox"
                  aria-label={label}
                  checked={Boolean((settings as any)?.[key])}
                  onChange={async () => {
                    const s = await ensureUserSettings();
                    await db.userSettings.put({ ...s, [key]: !(s as any)[key], updatedAt: new Date().toISOString() });
                  }}
                  className="size-5 accent-[color:var(--rd-accent)]"
                />
              </label>
            ))}
            <label className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[15px] text-rd-label-primary">Require crop before OCR</p>
                <p className="text-[13px] text-rd-label-secondary">
                  {settings?.requireCropBeforeOcr !== false ? 'On — protects patient identifiers' : 'Off — full photos sent to OCR without PHI removal'}
                </p>
              </div>
              <input
                type="checkbox"
                aria-label="Require crop before OCR"
                checked={settings?.requireCropBeforeOcr !== false}
                onChange={async () => {
                  const s = settings;
                  if (!s) return;
                  const newVal = s.requireCropBeforeOcr === false ? true : false;
                  if (!newVal) {
                    const ok = window.confirm(
                      'PHI warning\n\nDisabling crop before OCR may expose patient identifiers.\n\n' +
                      'Full PowerScribe screenshots contain: patient name, MRN, DOB, room number, and account number.\n\n' +
                      'Only disable this in fully de-identified demo/testing scenarios.\n\nContinue?',
                    );
                    if (!ok) return;
                  }
                  await db.userSettings.put({ ...s, requireCropBeforeOcr: newVal, updatedAt: new Date().toISOString() });
                }}
                className="size-5 accent-[color:var(--rd-accent)]"
              />
            </label>
            <p className="text-[13px] leading-relaxed text-rd-label-secondary">
              Original photos are deleted immediately after crop is confirmed, cropped images are cleared from memory after OCR
              completes, nothing is saved to camera roll/disk/cloud, and OCR runs entirely on-device. Study logs and RVU data stay
              on this device while remote persistence is disabled.
            </p>
          </div>
        </details>

        <div className="rounded-[16px] p-4 space-y-3" style={{ background: 'rgba(255,59,48,0.08)' }}>
          <p className="text-[15px] font-semibold text-red-400">Danger zone</p>
          <p className="text-[13px] text-rd-label-secondary">All data is stored locally in your browser while remote persistence is disabled. Clearing browser data will delete everything.</p>
          <button onClick={handleClearData} className="rounded-[10px] px-4 py-2 text-[13px] font-semibold text-red-400" style={{ background: 'rgba(255,59,48,0.12)' }}>
            Delete all study logs
          </button>
        </div>

        <p className="px-1 text-[13px] leading-relaxed text-rd-label-secondary">
          wRVU Tracker — personal productivity tool for radiologists. All data is stored on-device. Not for billing, coding, or compliance.
          Built on CY2026 CMS PPRRVU data.
        </p>
      </section>
    </div>
  );
}
