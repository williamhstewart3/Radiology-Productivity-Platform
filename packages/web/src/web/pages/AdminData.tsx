import { useEffect, useState } from 'react';
import { Database, ExternalLink, Pin, PinOff, RefreshCw } from 'lucide-react';
import { db } from '../db/database';
import { supabasePersistence, type RvuDatasetMetadata } from '../services/supabasePersistence';

const ALWAYS_ON_TOP_KEY = 'wrvu_always_on_top_preference';

function readAlwaysOnTopPreference(): boolean {
  return localStorage.getItem(ALWAYS_ON_TOP_KEY) === 'true';
}

function writeAlwaysOnTopPreference(enabled: boolean) {
  localStorage.setItem(ALWAYS_ON_TOP_KEY, String(enabled));
  window.dispatchEvent(new CustomEvent('wrvu-always-on-top-changed', { detail: { enabled } }));
}

export function AdminData() {
  const [dataset, setDataset] = useState<RvuDatasetMetadata | null>(null);
  const [localCount, setLocalCount] = useState<number | null>(null);
  const [alwaysOnTop, setAlwaysOnTop] = useState(readAlwaysOnTopPreference());
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

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

  function toggleAlwaysOnTop() {
    const next = !alwaysOnTop;
    setAlwaysOnTop(next);
    writeAlwaysOnTopPreference(next);
  }

  const supabaseReady = supabasePersistence.isConfigured();

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
              CPT/RVU lookup reads from Supabase on app load when Vercel env vars are configured.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <p className="text-xs text-slate-500">Supabase</p>
            <p className={`text-sm font-semibold mt-1 ${supabaseReady ? 'text-emerald-400' : 'text-amber-400'}`}>
              {supabaseReady ? 'Configured' : 'Not configured'}
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
            No active Supabase RVU dataset found. Import the CMS/PPRRVU ZIP after configuring Supabase.
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
            {alwaysOnTop ? <Pin className="size-5" /> : <PinOff className="size-5" />}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-white uppercase tracking-wider">Mini Window</h2>
            <p className="text-xs text-slate-400 mt-1">
              Browser tabs cannot force true system-wide always-on-top. This keeps the mini window visually pinned and remembers the preference. Use the Electron shell for native always-on-top.
            </p>
          </div>
        </div>

        <button
          onClick={toggleAlwaysOnTop}
          className={`w-full rounded-xl border px-4 py-3 text-sm font-semibold transition-colors ${
            alwaysOnTop
              ? 'border-cyan-400/40 bg-cyan-400/15 text-cyan-200'
              : 'border-white/15 bg-white/5 text-slate-300 hover:border-white/30'
          }`}
        >
          Always on Top: {alwaysOnTop ? 'On' : 'Off'}
        </button>

        <a
          href="/mini-pace"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 text-xs text-slate-400 hover:text-white transition-colors"
        >
          <ExternalLink className="size-3" /> Open mini pace window
        </a>
      </div>
    </div>
  );
}
