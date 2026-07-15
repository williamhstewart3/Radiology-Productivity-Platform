import { useEffect, useState } from 'react';
import { Database, Pin, RefreshCw } from 'lucide-react';
import { db } from '../db/database';
import { supabasePersistence, type RvuDatasetMetadata } from '../services/supabasePersistence';
import { useMiniPaceWindow } from '../components/MiniPaceWindowProvider';

export function AdminData() {
  const [dataset, setDataset] = useState<RvuDatasetMetadata | null>(null);
  const [localCount, setLocalCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const { openMiniWindow, alwaysOnTopSupported } = useMiniPaceWindow();

  async function refresh() {
    setLoading(true);
    setMessage(null);
    try {
      const active = await supabasePersistence.getActiveRvuDataset();
      setDataset(active);
      setLocalCount(await db.cptRvuTable.count());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load data status.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const supabaseReady = supabasePersistence.isConfigured();
  const supabaseCredentialsPresent = supabasePersistence.hasCredentials();

  return (
    <div className="mx-auto max-w-3xl space-y-5 animate-in fade-in duration-300">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Admin Data</h1>
          <p className="text-slate-400 text-sm mt-0.5">RVU dataset, persistence, and mini window behavior</p>
        </div>
        <button onClick={refresh} className="desk-icon" title="Refresh status">
          <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="card space-y-4">
        <div className="flex items-start gap-3">
          <div className="desk-empty-icon shrink-0"><Database className="size-5" /></div>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-white uppercase tracking-wider">Active RVU Dataset</h2>
            <p className="text-xs text-slate-400 mt-1">
              Remote persistence is privacy-gated and off by default. With it off, RVU data stays on this device.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <p className="text-xs text-slate-500">Remote persistence</p>
            <p className={`text-sm font-semibold mt-1 ${supabaseReady ? 'text-emerald-400' : 'text-amber-400'}`}>
              {supabaseReady ? 'Enabled' : supabaseCredentialsPresent ? 'Disabled' : 'Not configured'}
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <p className="text-xs text-slate-500">Active year</p>
            <p className="text-sm font-semibold text-white mt-1">{dataset?.year ?? 'None'}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <p className="text-xs text-slate-500">Row count</p>
            <p className="text-sm font-semibold text-white mt-1">
              {(dataset?.rowCount ?? localCount ?? 0).toLocaleString()}
            </p>
          </div>
        </div>

        {dataset ? (
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs text-emerald-300">
            Active: {dataset.filename} · Uploaded {new Date(dataset.uploadedAt).toLocaleString()}
          </div>
        ) : (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-300">
            {supabaseReady
              ? 'No active Supabase RVU dataset found. Import the CMS/PPRRVU ZIP to create one.'
              : 'Using the local RVU dataset. Remote requests are disabled.'}
          </div>
        )}

        {message && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-300">
            {message}
          </div>
        )}
      </div>

      <div className="card space-y-4">
        <div className="flex items-start gap-3">
          <div className="desk-empty-icon shrink-0">
            <Pin className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-white uppercase tracking-wider">Mini Window</h2>
            <p className="text-xs text-slate-400 mt-1">
              The mini pace window uses the browser's true always-on-top Picture-in-Picture surface and remains above PACS and other applications while it is open.
            </p>
          </div>
        </div>

        <button
          onClick={() => void openMiniWindow()}
          disabled={!alwaysOnTopSupported}
          className="w-full rounded-xl border border-cyan-400/40 bg-cyan-400/15 px-4 py-3 text-sm font-semibold text-cyan-200 transition-colors disabled:border-white/15 disabled:bg-white/5 disabled:text-slate-500"
        >
          {alwaysOnTopSupported ? 'Open always-on-top mini window' : 'Always-on-top requires current Chrome or Edge'}
        </button>
      </div>
    </div>
  );
}
