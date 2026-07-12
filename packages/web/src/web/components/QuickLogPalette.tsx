import { useCallback, useEffect, useRef, useState } from 'react';
import { findMatchCandidates } from '../utils/matching';
import { checkOneDuplicate, buildFingerprint } from '../utils/duplicateDetection';
import { db } from '../db/database';
import { useProfile } from '../hooks/useProfile';
import { todayDateString } from '../utils/calculations';
import { rememberManualEntry } from '../services/memoryLearningService';
import { CptExplorer } from '../pages/CptExplorer';
import type { MatchCandidate, StudyLog } from '../types';
import { MODALITY_LABELS } from '../types';
import type { DuplicateMatch } from '../utils/duplicateDetection';

interface QuickLogPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function QuickLogPalette({ open, onClose }: QuickLogPaletteProps) {
  const { activeProfile, activePractice } = useProfile();
  const [view, setView] = useState<'search' | 'browse'>('search');
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<MatchCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [logDate, setLogDate] = useState(todayDateString());
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [dupeWarning, setDupeWarning] = useState<{ candidate: MatchCandidate; match: DuplicateMatch } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setView('search');
    setQuery('');
    setCandidates([]);
    setMoreOpen(false);
    setLogDate(todayDateString());
    setNotes('');
    setSaved(null);
    setDupeWarning(null);
    const timer = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open || view !== 'search') return;
    const q = query.trim();
    if (!q) { setCandidates([]); return; }
    setSearching(true);
    const timer = setTimeout(async () => {
      const results = await findMatchCandidates(q, 6, activeProfile?.id ?? null);
      setCandidates(results);
      setSearching(false);
    }, 250);
    return () => clearTimeout(timer);
  }, [query, open, view, activeProfile?.id]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const logCandidate = useCallback(
    async (candidate: MatchCandidate, skipDupeCheck = false) => {
      setSaving(true);
      try {
        if (!skipDupeCheck) {
          const dupeMatch = await checkOneDuplicate(
            {
              examNameRaw: query.trim(),
              cptCode: candidate.cptCode,
              modifier: candidate.modifier,
              logDate,
              studyDateTime: null,
              studyDate: logDate,
              accessionNumber: null,
              rowIndex: null,
              modality: candidate.modality,
            },
            undefined,
          );
          if (dupeMatch && (dupeMatch.confidence === 'very_likely' || dupeMatch.confidence === 'possible')) {
            setDupeWarning({ candidate, match: dupeMatch });
            setSaving(false);
            return;
          }
        }

        const fp = buildFingerprint(query.trim(), candidate.cptCode, logDate, null, null, candidate.modality);
        const now = new Date().toISOString();
        const log: StudyLog = {
          id: crypto.randomUUID(),
          profileId: activeProfile?.id ?? null,
          logDate,
          studyDateTime: null,
          studyDate: logDate,
          dateTimeConfidence: 0,
          dateTimeSource: 'manual',
          examNameRaw: query.trim(),
          cptCode: candidate.cptCode,
          modifier: candidate.modifier,
          workRvu: candidate.workRvu,
          modality: candidate.modality,
          matchMethod: candidate.method,
          matchConfidence: candidate.confidence,
          needsReview: candidate.confidence < 0.75,
          accessionNumber: null,
          sessionId: null,
          sourceImportId: null,
          notes: notes.trim() || null,
          studyFingerprint: fp,
          createdAt: now,
          updatedAt: now,
        };
        await db.studyLogs.add(log);
        await rememberManualEntry({
          rawText: query.trim(),
          candidate,
          notes: notes.trim() || null,
          profileId: activeProfile?.id ?? null,
          siteId: activePractice?.id ?? null,
          sessionId: null,
          logDate,
        });
        setDupeWarning(null);
        setSaved(`${candidate.cptCode} logged · ${candidate.workRvu?.toFixed(2) ?? '0.00'} wRVU`);
        setTimeout(() => onClose(), 700);
      } finally {
        setSaving(false);
      }
    },
    [query, logDate, notes, activeProfile, activePractice, onClose],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center bg-black/60 px-4 pt-[10vh]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-2xl shadow-2xl"
        style={{ background: '#0c1c2eee', border: '1px solid rgba(91,184,212,0.18)' }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b px-3 py-2" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
          <button
            type="button"
            onClick={() => setView('search')}
            className="rounded-md px-2.5 py-1 text-xs font-semibold"
            style={{
              background: view === 'search' ? 'rgba(91,184,212,0.14)' : 'transparent',
              color: view === 'search' ? '#9be8ff' : 'var(--theme-text-disabled)',
            }}
          >
            Search
          </button>
          <button
            type="button"
            onClick={() => setView('browse')}
            className="rounded-md px-2.5 py-1 text-xs font-semibold"
            style={{
              background: view === 'browse' ? 'rgba(91,184,212,0.14)' : 'transparent',
              color: view === 'browse' ? '#9be8ff' : 'var(--theme-text-disabled)',
            }}
          >
            Browse
          </button>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-md px-2 py-1 text-xs"
            style={{ color: 'var(--theme-text-disabled)' }}
          >
            Esc
          </button>
        </div>

        {view === 'browse' ? (
          <div className="max-h-[70vh] overflow-y-auto p-3">
            <CptExplorer onNavigate={onClose} />
          </div>
        ) : (
          <div className="p-3">
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by name or CPT code…"
              className="h-11 w-full rounded-lg bg-transparent px-3 text-base outline-none"
              style={{ border: '1px solid rgba(91,184,212,0.24)', color: 'var(--theme-text-primary)' }}
              autoComplete="off"
            />

            {dupeWarning ? (
              <div className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 space-y-2">
                <p className="text-sm font-semibold text-amber-300">
                  {dupeWarning.match.confidence === 'very_likely' ? 'Very likely duplicate' : 'Possible duplicate'}
                </p>
                <p className="text-xs text-amber-200/70">{dupeWarning.match.reason}</p>
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => logCandidate(dupeWarning.candidate, true)}
                    className="flex-1 rounded-lg py-2 text-xs font-semibold text-amber-300"
                    style={{ background: 'rgba(245,158,11,0.16)', border: '1px solid rgba(245,158,11,0.3)' }}
                  >
                    Log anyway
                  </button>
                  <button
                    type="button"
                    onClick={() => setDupeWarning(null)}
                    className="flex-1 rounded-lg py-2 text-xs font-semibold"
                    style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--theme-text-muted)' }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-2 max-h-[46vh] overflow-y-auto rounded-lg">
                {searching && (
                  <p className="px-2 py-3 text-xs" style={{ color: 'var(--theme-text-disabled)' }}>Searching…</p>
                )}
                {!searching && query.trim() && candidates.length === 0 && (
                  <p className="px-2 py-3 text-xs" style={{ color: 'var(--theme-text-disabled)' }}>
                    No matches. Try a CPT code directly.
                  </p>
                )}
                {candidates.map((candidate) => (
                  <button
                    key={`${candidate.cptCode}-${candidate.modifier ?? 'none'}`}
                    type="button"
                    disabled={saving}
                    onClick={() => logCandidate(candidate)}
                    className="flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-white/5 disabled:opacity-50"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-bold" style={{ color: '#9be8ff' }}>
                          {candidate.cptCode}{candidate.modifier ? `-${candidate.modifier}` : ''}
                        </span>
                        <span
                          className="rounded px-1.5 py-0.5 text-[10px]"
                          style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--theme-text-muted)' }}
                        >
                          {MODALITY_LABELS[candidate.modality]}
                        </span>
                      </div>
                      <p className="truncate text-xs" style={{ color: 'var(--theme-text-muted)' }}>
                        {candidate.description}
                      </p>
                    </div>
                    <span className="shrink-0 font-mono text-sm font-bold" style={{ color: 'var(--theme-text-primary)' }}>
                      {candidate.workRvu?.toFixed(2) ?? '—'}
                    </span>
                  </button>
                ))}
              </div>
            )}

            <details
              className="mt-2"
              open={moreOpen}
              onToggle={(event) => setMoreOpen((event.target as HTMLDetailsElement).open)}
            >
              <summary className="cursor-pointer text-xs" style={{ color: 'var(--theme-text-disabled)' }}>
                More options
              </summary>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <label className="grid gap-1 text-[11px]" style={{ color: 'var(--theme-text-disabled)' }}>
                  Date
                  <input
                    type="date"
                    value={logDate}
                    onChange={(event) => setLogDate(event.target.value)}
                    className="h-9 rounded-md px-2 text-sm"
                    style={{
                      background: 'rgba(255,255,255,0.045)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      color: 'var(--theme-text-primary)',
                      colorScheme: 'dark',
                    }}
                  />
                </label>
                <label className="grid gap-1 text-[11px]" style={{ color: 'var(--theme-text-disabled)' }}>
                  Notes
                  <input
                    type="text"
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder="Optional"
                    className="h-9 rounded-md px-2 text-sm"
                    style={{
                      background: 'rgba(255,255,255,0.045)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      color: 'var(--theme-text-primary)',
                    }}
                  />
                </label>
              </div>
            </details>

            {saved && <p className="mt-2 text-xs text-emerald-400">{saved}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
