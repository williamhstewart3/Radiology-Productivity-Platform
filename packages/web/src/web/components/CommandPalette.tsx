import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Search } from 'lucide-react';
import { db } from '../db/database';
import { useOrg } from '../hooks/useOrg';
import { pickProfessionalRow, tokenScore } from '../pages/CptExplorer';
import { todayDateString } from '../utils/calculations';
import { logConfirmedStudy } from '../utils/manualLog';
import type { CptRvuRow } from '../types';

export function CommandPalette({ open, onClose, onNavigate, onOpenMini }: { open: boolean; onClose: () => void; onNavigate: (path: string) => void; onOpenMini?: () => void }) {
  const { activeProfile } = useOrg();
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const rows = useLiveQuery(() => db.cptRvuTable.where('statusCategory').equals('active').toArray(), [], []);
  useEffect(() => {
    if (!open) setQuery('');
    else requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim();
    if (!q) return [];
    const byCode = new Map<string, CptRvuRow[]>();
    for (const row of rows) {
      if (row.pcTcIndicator === 'technical' || (row.workRvu ?? 0) <= 0) continue;
      byCode.set(row.cptCode, [...(byCode.get(row.cptCode) ?? []), row]);
    }
    return [...byCode.values()]
      .map(pickProfessionalRow)
      .filter((row): row is CptRvuRow => Boolean(row))
      .map((row) => ({ row, score: tokenScore(row, q) }))
      .filter(({ score }) => score >= 60)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map(({ row }) => row);
  }, [query, rows]);

  if (!open) return null;
  const navigate = (path: string) => { onClose(); onNavigate(path); };
  const logRow = async (row: CptRvuRow) => {
    await logConfirmedStudy({
      examTitle: row.description,
      candidate: {
        cptCode: row.cptCode,
        modifier: row.modifier,
        description: row.description,
        workRvu: row.workRvu,
        modality: row.modality,
        confidence: 1,
        method: 'manual_cpt',
      },
      logDate: todayDateString(),
      profileId: activeProfile?.id ?? null,
    });
    navigate('/today');
  };
  return (
    <div className="fixed inset-0 z-[100] bg-black/60 p-3 pt-[12vh]">
      <button type="button" aria-label="Close command palette" onClick={onClose} className="absolute inset-0 cursor-default" />
      <dialog open className="relative mx-auto w-full max-w-xl overflow-hidden rounded-[16px] border border-rd-separator bg-rd-surface p-0 text-left shadow-2xl" aria-label="Command palette">
        <label className="flex min-h-14 items-center gap-3 border-b border-rd-separator px-4">
          <Search className="size-5 text-rd-label-secondary" />
          <span className="sr-only">Search commands and CPT codes</span>
          <input ref={inputRef} aria-label="Search commands and CPT codes" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Go anywhere or search CPT codes…" className="min-w-0 flex-1 bg-transparent text-[17px] text-rd-label-primary outline-none placeholder:text-rd-label-secondary" />
          <kbd className="text-[12px] text-rd-label-secondary">Esc</kbd>
        </label>
        <div className="max-h-[55vh] overflow-auto p-2">
          {!query.trim() && [
            ['/today', 'Today'], ['/inbox', 'Inbox'], ['/history', 'History'], ['/log', 'Capture'], ['/settings', 'Settings'],
          ].map(([path, label]) => <button key={path} type="button" onClick={() => navigate(path)} className="flex min-h-11 w-full items-center rounded-[10px] px-3 text-left text-[15px] text-rd-label-primary hover:bg-rd-surface-2">{label}</button>)}
          {!query.trim() && onOpenMini && (
            <button
              type="button"
              onClick={() => { onClose(); onOpenMini(); }}
              className="flex min-h-11 w-full items-center justify-between rounded-[10px] px-3 text-left text-[15px] text-rd-label-primary hover:bg-rd-surface-2"
            >
              <span>Mini window</span>
              <kbd className="text-[12px] text-rd-label-secondary">⌘M</kbd>
            </button>
          )}
          {results.map((row) => (
            <button key={`${row.cptCode}-${row.modifier}`} type="button" onClick={() => void logRow(row)} className="flex min-h-12 w-full items-center justify-between gap-3 rounded-[10px] px-3 text-left hover:bg-rd-surface-2">
              <span className="min-w-0"><span className="block truncate text-[15px] text-rd-label-primary">{row.description}</span><span className="font-mono text-[12px] text-rd-label-secondary">{row.cptCode}</span></span>
              <span className="shrink-0 text-[13px] text-rd-label-secondary">{row.workRvu?.toFixed(2)} wRVU · log it</span>
            </button>
          ))}
        </div>
      </dialog>
    </div>
  );
}
