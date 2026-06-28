import { useLiveQuery } from 'dexie-react-hooks';
import { useState, useRef } from 'react';
import { db, ensureUserSettings } from '../db/database';
import { importRvuFile } from '../utils/rvuFileImporter';
import { buildSeedCptRows } from '../data/seedCptData';
import type { UserSettings } from '../types';
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
              : 'bg-gradient-to-r from-indigo-500 to-violet-600 text-white hover:opacity-90'
          }`}
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
                <span className="w-4 h-4 border border-indigo-400 border-t-transparent rounded-full animate-spin" />
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
