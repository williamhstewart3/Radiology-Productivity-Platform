/**
 * Import.tsx
 *
 * Import screen — routes each import mode through its provider and the
 * shared importPipeline. Adding a new source (e.g. PowerScribe live sync)
 * requires only: instantiate the provider, call runImportPipeline(), done.
 *
 * Active providers:
 *   paste  → CSVImportProvider (single-column / paste-style)
 *   ocr    → OCRImportProvider
 *
 * Architecture placeholder:
 *   powerscribe → PowerScribeImportProvider (disabled, "Coming Soon")
 */

import { useState, useRef, useEffect } from 'react';
import { theme } from '../lib/theme';
import { OCRImportProvider } from '../providers/OCRImportProvider';
import { CSVImportProvider } from '../providers/CSVImportProvider';
import { runImportPipeline, commitPipelineResults } from '../pipeline/importPipeline';
import { searchExamLibrary, learnAlias } from '../utils/matching';
import { useProfile } from '../hooks/useProfile';
import { todayDateString } from '../utils/calculations';
import type { PipelineReviewRow } from '../pipeline/importPipeline';
import type { DuplicateStatus, MatchCandidate } from '../types';
import { MODALITY_LABELS } from '../types';

// ─── ExamSearchPanel ─────────────────────────────────────────────────────────

interface ExamSearchPanelProps {
  /** Raw OCR / paste text to pre-populate the search */
  initialQuery: string;
  onSelect: (candidate: MatchCandidate) => void;
  onClose: () => void;
}

function ExamSearchPanel({ initialQuery, onSelect, onClose }: ExamSearchPanelProps) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<MatchCandidate[]>([]);
  const [searching, setSearching] = useState(false);

  // Auto-search on mount and whenever query changes (debounced)
  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const hits = await searchExamLibrary(query, 8);
        setResults(hits);
      } finally {
        setSearching(false);
      }
    }, 280);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <div className="mt-2 rounded-xl border border-sky-500/30 bg-slate-900/95 shadow-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/8">
        <span className="text-sky-400 text-xs font-semibold uppercase tracking-wider">Search Exam Library</span>
        <button
          onClick={onClose}
          className="ml-auto text-slate-500 hover:text-slate-300 text-xs px-1.5 py-0.5 rounded transition-colors"
        >
          ✕ Close
        </button>
      </div>

      {/* Search input */}
      <div className="px-3 py-2 border-b border-white/6">
        <input
          autoFocus
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, CPT code, modality…"
          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-500/50"
        />
      </div>

      {/* Results */}
      <div className="max-h-64 overflow-y-auto divide-y divide-white/5">
        {searching && (
          <div className="px-4 py-3 text-xs text-slate-400 italic">Searching…</div>
        )}
        {!searching && results.length === 0 && query.trim() && (
          <div className="px-4 py-3 text-xs text-slate-400 italic">No results — try different terms or CPT code</div>
        )}
        {results.map((c, ci) => (
          <button
            key={`${c.cptCode}-${c.modifier ?? ''}-${ci}`}
            onClick={() => onSelect(c)}
            className="w-full text-left px-3 py-2.5 text-xs hover:bg-white/5 transition-colors"
          >
            <div className="flex items-baseline gap-2">
              <span className="font-mono font-bold text-white">{c.cptCode}</span>
              {c.modifier && (
                <span className="text-slate-500">mod {c.modifier}</span>
              )}
              <span
                className={`ml-auto shrink-0 font-medium ${
                  c.confidence >= 0.70 ? 'text-emerald-400' :
                  c.confidence >= 0.50 ? 'text-amber-400' : 'text-slate-400'
                }`}
              >
                {Math.round(c.confidence * 100)}%
              </span>
            </div>
            <div className="text-slate-300 mt-0.5 leading-snug">
              {c.description.slice(0, 90)}{c.description.length > 90 ? '…' : ''}
            </div>
            {c.workRvu != null && (
              <div className="text-slate-500 mt-0.5">{c.workRvu.toFixed(2)} wRVU</div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── ImportProps ──────────────────────────────────────────────────────────────

interface ImportProps {
  onImported: () => void;
}

type Mode = 'paste' | 'ocr' | 'powerscribe';
type Step = 'input' | 'review' | 'done';

export function Import({ onImported }: ImportProps) {
  const { activeProfile } = useProfile();
  const [mode, setMode]           = useState<Mode>('paste');
  const [step, setStep]           = useState<Step>('input');
  const [pasteText, setPasteText] = useState('');
  const [ocrFile, setOcrFile]     = useState<File | null>(null);
  const [processing, setProcessing] = useState(false);
  const [reviewRows, setReviewRows]   = useState<PipelineReviewRow[]>([]);
  const [skippedRows, setSkippedRows] = useState<PipelineReviewRow[]>([]);
  const [logDate, setLogDate]     = useState(todayDateString());
  const [importing, setImporting] = useState(false);
  const [importedCount, setImportedCount]   = useState(0);
  const [skippedCount, setSkippedCount]     = useState(0);
  const [reviewNeeded, setReviewNeeded]     = useState(0);
  const [error, setError]         = useState<string | null>(null);
  const [showSkipped, setShowSkipped]       = useState(false);
  const [searchPanelTempId, setSearchPanelTempId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Process helpers ───────────────────────────────────────────────────────

  async function handlePasteProcess() {
    if (!pasteText.trim()) return;
    setProcessing(true);
    setError(null);
    try {
      const provider = new CSVImportProvider(pasteText, logDate);
      const studies  = await provider.importStudies();
      const result   = await runImportPipeline(studies, logDate, activeProfile?.id);
      setReviewRows(result.reviewRows);
      setSkippedRows(result.skippedRows);
      setStep('review');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Processing failed');
    } finally {
      setProcessing(false);
    }
  }

  async function handleOcrProcess() {
    if (!ocrFile) return;
    setProcessing(true);
    setError(null);
    try {
      const provider = new OCRImportProvider(ocrFile, logDate);
      const studies  = await provider.importStudies();
      const result   = await runImportPipeline(studies, logDate, activeProfile?.id);
      setReviewRows(result.reviewRows);
      setSkippedRows(result.skippedRows);
      setStep('review');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'OCR failed — try paste mode instead');
    } finally {
      setProcessing(false);
    }
  }

  // Restore a skipped row back into the review list
  function forceIncludeSkipped(tempId: string) {
    const skipped = skippedRows.find((s) => s.tempId === tempId);
    if (!skipped) return;
    setSkippedRows((s) => s.filter((x) => x.tempId !== tempId));
    setReviewRows((rows) => [
      ...rows,
      { ...skipped, duplicateStatus: null as DuplicateStatus, needsReview: true, included: true, autoSkipped: false },
    ]);
  }

  async function handleCommit() {
    setImporting(true);
    setError(null);
    try {
      const result = await commitPipelineResults(reviewRows, logDate, skippedRows.length, activeProfile?.id);
      setImportedCount(result.importedCount);
      setSkippedCount(result.skippedCount);
      setReviewNeeded(result.reviewNeededCount);
      setStep('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  function updateRow(tempId: string, patch: Partial<PipelineReviewRow>) {
    setReviewRows((rows) =>
      rows.map((r) => (r.tempId === tempId ? { ...r, ...patch } : r)),
    );
  }

  async function handleManualSelect(tempId: string, candidate: MatchCandidate) {
    const row = reviewRows.find((r) => r.tempId === tempId);
    if (!row) return;

    // Inject the manually chosen candidate at position 0 (auto-selected)
    const updatedCandidates = [candidate, ...row.candidates.filter(
      (c) => !(c.cptCode === candidate.cptCode && c.modifier === candidate.modifier),
    )];
    updateRow(tempId, {
      candidates: updatedCandidates,
      selectedCandidateIndex: 0,
      needsReview: false,
    });

    // Learn the alias immediately — next import benefits right away
    await learnAlias(row.source.examTitle, candidate.cptCode, candidate.modifier ?? null, 'user');

    setSearchPanelTempId(null);
  }

  const includedCount = reviewRows.filter((r) => r.included).length;
  const matchedCount  = reviewRows.filter(
    (r) => r.included && r.selectedCandidateIndex !== null,
  ).length;
  const possibleDupes = reviewRows.filter(
    (r) => r.included && r.duplicateStatus === 'possible',
  ).length;

  // ── Done screen ───────────────────────────────────────────────────────────
  if (step === 'done') {
    return (
      <div className="max-w-lg mx-auto text-center space-y-6 py-16 animate-in fade-in duration-300">
        <div className="w-20 h-20 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center mx-auto text-4xl">
          ✓
        </div>
        <div>
          <h2 className="text-2xl font-bold text-white">Import Complete</h2>
          <div className="mt-3 space-y-1.5">
            <p className="text-emerald-400 text-sm font-medium">
              Imported: {importedCount} {importedCount === 1 ? 'study' : 'studies'}
            </p>
            {skippedCount > 0 && (
              <p className="text-slate-400 text-sm">
                Skipped duplicates: {skippedCount}
              </p>
            )}
            {reviewNeeded > 0 && (
              <p className="text-amber-400 text-sm">
                Needs review: {reviewNeeded}
              </p>
            )}
          </div>
        </div>
        <div className="flex gap-3 justify-center">
          <button
            onClick={() => {
              setStep('input');
              setPasteText('');
              setOcrFile(null);
              setReviewRows([]);
              setSkippedRows([]);
              setShowSkipped(false);
            }}
            className="px-6 py-2.5 rounded-xl border border-white/15 text-slate-300 text-sm hover:border-white/30 transition-colors"
          >
            Import More
          </button>
          <button
            onClick={onImported}
            className="px-6 py-2.5 rounded-xl text-white text-sm font-semibold hover:opacity-90 transition-opacity"
            style={{ background: `linear-gradient(135deg, ${theme.colors.primary}, ${theme.colors.accent})` }}
          >
            View Dashboard
          </button>
        </div>
      </div>
    );
  }

  // ── Review screen ─────────────────────────────────────────────────────────
  if (step === 'review') {
    return (
      <div className="space-y-5 animate-in fade-in duration-300">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Review Matches</h1>
            <p className="text-slate-400 text-sm mt-0.5">
              {matchedCount}/{includedCount} matched
              {skippedRows.length > 0 && ` · ${skippedRows.length} duplicates skipped`}
              {possibleDupes > 0 && ` · ${possibleDupes} possible dup${possibleDupes > 1 ? 's' : ''}`}
            </p>
          </div>
          <button
            onClick={() => setStep('input')}
            className="text-sm text-slate-400 hover:text-white transition-colors"
          >
            ← Back
          </button>
        </div>

        {/* Date picker */}
        <div className="card">
          <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider mb-1.5">
            Log Date (all studies)
          </label>
          <input
            type="date"
            value={logDate}
            onChange={(e) => setLogDate(e.target.value)}
            className="input"
          />
        </div>

        {/* ── Skipped duplicates panel ──────────────────────────────────── */}
        {skippedRows.length > 0 && (
          <div className="rounded-xl border border-slate-700/60 bg-slate-800/40 overflow-hidden">
            <button
              onClick={() => setShowSkipped((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-white/3 transition-colors"
            >
              <span className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-slate-600/60 flex items-center justify-center text-xs text-slate-300 font-bold">
                  {skippedRows.length}
                </span>
                <span className="text-slate-300 font-medium">Skipped duplicates</span>
              </span>
              <span className="text-slate-500 text-xs">{showSkipped ? 'Hide ▲' : 'Show ▼'}</span>
            </button>

            {showSkipped && (
              <div className="border-t border-slate-700/50 divide-y divide-slate-700/30">
                {skippedRows.map((s) => {
                  const top = s.candidates[0];
                  return (
                    <div key={s.tempId} className="px-4 py-3 flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-slate-300 truncate">{s.source.examTitle}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          {top?.cptCode && (
                            <span className="text-xs font-mono text-slate-500">{top.cptCode}</span>
                          )}
                          {top?.workRvu != null && (
                            <span className="text-xs text-slate-500">{top.workRvu.toFixed(2)} wRVU</span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5 italic">{s.duplicateReason}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`text-xs px-2 py-0.5 rounded-lg border font-medium ${
                          s.duplicateStatus === 'exact'
                            ? 'bg-red-500/10 border-red-500/25 text-red-400'
                            : 'bg-amber-500/10 border-amber-500/25 text-amber-400'
                        }`}>
                          {s.duplicateStatus === 'exact' ? 'Exact dup' : 'Very likely dup'}
                        </span>
                        <button
                          onClick={() => forceIncludeSkipped(s.tempId)}
                          className="text-xs px-2.5 py-1 rounded-lg border border-white/12 text-slate-400 hover:border-white/25 hover:text-white transition-colors"
                        >
                          Import anyway
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Review rows ───────────────────────────────────────────────── */}
        <div className="space-y-3">
          {reviewRows.map((row, i) => {
            const isPossibleDupe = row.duplicateStatus === 'possible';
            return (
              <div
                key={row.tempId}
                className={`card transition-opacity duration-200 ${!row.included ? 'opacity-40' : ''}`}
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="min-w-0">
                    <p className="text-xs text-slate-400">#{i + 1}</p>
                    <p className="text-sm text-white font-medium truncate">{row.source.examTitle}</p>
                    {row.source.accessionNumber && (
                      <p className="text-xs text-slate-500">Acc: {row.source.accessionNumber}</p>
                    )}
                    {row.source.source !== 'paste' && (
                      <p className="text-xs text-slate-600 uppercase tracking-wider">{row.source.source}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                    {isPossibleDupe && row.included && (
                      <span
                        className="text-xs bg-orange-500/15 border border-orange-500/30 text-orange-300 px-2 py-0.5 rounded-lg"
                        title={row.duplicateReason ?? ''}
                      >
                        ⚠ Possible dup
                      </span>
                    )}
                    {!row.needsReview && row.included && !isPossibleDupe &&
                      row.candidates[0]?.method === 'alias_match' &&
                      row.candidates[0]?.confidence >= 0.95 && (
                      <span className="text-xs bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 px-2 py-0.5 rounded-lg">
                        ✓ Learned
                      </span>
                    )}
                    {row.needsReview && row.included && (
                      <span className="text-xs bg-amber-500/20 border border-amber-500/30 text-amber-300 px-2 py-0.5 rounded-lg">
                        Review
                      </span>
                    )}
                    <button
                      onClick={() => updateRow(row.tempId, { included: !row.included })}
                      className={`text-xs px-2 py-1 rounded-lg border transition-colors ${
                        row.included
                          ? 'bg-red-500/15 border-red-500/30 text-red-400 hover:bg-red-500/25'
                          : 'bg-white/5 border-white/15 text-slate-400 hover:border-white/30'
                      }`}
                    >
                      {row.included ? 'Exclude' : 'Include'}
                    </button>
                  </div>
                </div>

                {isPossibleDupe && row.included && (
                  <div className="mb-2 px-3 py-2 rounded-lg bg-orange-500/8 border border-orange-500/20 text-xs text-orange-300/80">
                    {row.duplicateReason} — verify before saving or exclude this row.
                  </div>
                )}

                {/* ── Candidate list or no-match state ─────────────── */}
                {row.candidates.length === 0 ? (
                  <div className="space-y-2">
                    <p className="text-xs text-red-400 italic">
                      No confident match found — search the exam library to assign manually.
                    </p>
                    <button
                      onClick={() =>
                        setSearchPanelTempId(
                          searchPanelTempId === row.tempId ? null : row.tempId,
                        )
                      }
                      className="text-xs px-3 py-1.5 rounded-lg border border-sky-500/35 text-sky-400 hover:border-sky-400/60 hover:bg-sky-500/8 transition-all font-medium"
                    >
                      {searchPanelTempId === row.tempId ? '↑ Close search' : '🔍 Search exam library'}
                    </button>
                    {searchPanelTempId === row.tempId && (
                      <ExamSearchPanel
                        initialQuery={row.source.examTitle}
                        onSelect={(c) => handleManualSelect(row.tempId, c)}
                        onClose={() => setSearchPanelTempId(null)}
                      />
                    )}
                  </div>
                ) : (
                  <div className="space-y-1">
                    {row.candidates.map((c, ci) => {
                      const isSelected = row.selectedCandidateIndex === ci;
                      return (
                        <button
                          key={`${c.cptCode}-${c.modifier}-${ci}`}
                          onClick={() =>
                            updateRow(row.tempId, {
                              selectedCandidateIndex: ci,
                              needsReview: c.confidence < 0.75,
                            })
                          }
                          className={`w-full text-left rounded-lg border px-3 py-2 text-xs transition-all ${
                            isSelected
                              ? 'text-white'
                              : 'bg-white/3 border-white/8 text-slate-400 hover:border-white/20'
                          }`}
                          style={isSelected ? {
                            background: 'rgba(37,99,168,0.15)',
                            borderColor: 'rgba(37,99,168,0.4)',
                          } : {}}
                        >
                          <span className="font-mono font-bold mr-2">{c.cptCode}</span>
                          {c.modifier && (
                            <span className="mr-1.5 text-slate-500">mod {c.modifier}</span>
                          )}
                          <span className="mr-2">
                            {c.description.slice(0, 55)}
                            {c.description.length > 55 ? '…' : ''}
                          </span>
                          <span className="font-medium">{c.workRvu?.toFixed(2)} wRVU</span>
                          <span
                            className={`ml-2 ${
                              c.confidence >= 0.85
                                ? 'text-emerald-400'
                                : c.confidence >= 0.65
                                ? 'text-amber-400'
                                : 'text-red-400'
                            }`}
                          >
                            {Math.round(c.confidence * 100)}%
                          </span>
                          {c.method === 'alias_match' && (
                            <span className="ml-1.5 text-emerald-500/70 text-[10px] font-semibold uppercase tracking-wide">
                              learned
                            </span>
                          )}
                          {c.method === 'radiology_match' && c.confidence < 0.75 && (
                            <span className="ml-1.5 text-amber-500/70 text-[10px] font-semibold uppercase tracking-wide">
                              low conf
                            </span>
                          )}
                        </button>
                      );
                    })}
                    {/* "Can't find it?" — always available, surfaces search panel */}
                    <div className="flex items-center justify-end pt-0.5">
                      <button
                        onClick={() =>
                          setSearchPanelTempId(
                            searchPanelTempId === row.tempId ? null : row.tempId,
                          )
                        }
                        className="text-[11px] text-slate-500 hover:text-sky-400 transition-colors"
                      >
                        {searchPanelTempId === row.tempId ? '↑ Close search' : "Can't find it? Search library →"}
                      </button>
                    </div>
                    {searchPanelTempId === row.tempId && (
                      <ExamSearchPanel
                        initialQuery={row.source.examTitle}
                        onSelect={(c) => handleManualSelect(row.tempId, c)}
                        onClose={() => setSearchPanelTempId(null)}
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {reviewRows.length === 0 && skippedRows.length > 0 && (
            <div className="text-center py-10">
              <p className="text-2xl mb-3">✓</p>
              <p className="text-white font-medium">All studies are already logged</p>
              <p className="text-slate-400 text-sm mt-1">
                {skippedRows.length} duplicate{skippedRows.length > 1 ? 's' : ''} detected and skipped.
              </p>
            </div>
          )}
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <div className="flex gap-3">
          <button
            onClick={() => setStep('input')}
            className="px-5 py-2.5 rounded-xl border border-white/15 text-slate-300 text-sm hover:border-white/30 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleCommit}
            disabled={
              importing ||
              (matchedCount === 0 && reviewRows.length > 0) ||
              (reviewRows.length === 0 && skippedRows.length > 0 && matchedCount === 0)
            }
            className="flex-1 py-2.5 rounded-xl text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
            style={{ background: `linear-gradient(135deg, ${theme.colors.primary}, ${theme.colors.accent})` }}
          >
            {importing
              ? 'Saving…'
              : reviewRows.length === 0
              ? 'All Duplicates — Nothing to Import'
              : `Save ${matchedCount} ${matchedCount === 1 ? 'Study' : 'Studies'}`}
          </button>
        </div>
      </div>
    );
  }

  // ── Input screen ──────────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-in fade-in duration-300">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">Import Studies</h1>
        <p className="text-slate-400 text-sm mt-0.5">Bulk log from pasted text, screenshot OCR, or CSV</p>
      </div>

      {/* Mode toggle */}
      <div className="flex gap-2 p-1 bg-white/5 rounded-xl">
        <button
          onClick={() => { setMode('paste'); setError(null); }}
          className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
            mode === 'paste' ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-slate-300'
          }`}
        >
          📋 Paste / CSV
        </button>
        <button
          onClick={() => { setMode('ocr'); setError(null); }}
          className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
            mode === 'ocr' ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-slate-300'
          }`}
        >
          📸 Screenshot OCR
        </button>
        {/* PowerScribe — architecture ready, live sync coming */}
        <button
          disabled
          title="PowerScribe live sync — architecture implemented, activation coming soon"
          className="flex-1 py-2 rounded-lg text-sm font-medium text-slate-600 cursor-not-allowed relative group"
        >
          <span>⚡ PowerScribe</span>
          <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
            Soon
          </span>
          {/* Tooltip on hover */}
          <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-52 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none text-left shadow-xl z-10">
            Live PowerScribe sync is architecturally supported — the provider interface and pipeline are ready. Authentication and API integration coming soon.
          </span>
        </button>
      </div>

      {mode === 'paste' && (
        <div className="card space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider mb-1.5">
              Paste exam names, CPT codes, or CSV
            </label>
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={`CT Abdomen Pelvis with contrast\nMRI Brain without contrast\n74177, 70553, 71046\n...one per line, comma-separated, or CSV with headers`}
              rows={10}
              className="input w-full resize-none font-mono text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider mb-1.5">
              Log Date
            </label>
            <input
              type="date"
              value={logDate}
              onChange={(e) => setLogDate(e.target.value)}
              className="input"
            />
          </div>
          <p className="text-xs text-slate-500">
            Supports: one per line, comma-separated CPT codes, or CSV with headers
            (examTitle, cpt, studyDate, accessionNumber, modality…).
            Duplicates detected automatically.
          </p>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            onClick={handlePasteProcess}
            disabled={!pasteText.trim() || processing}
            className="w-full py-3 rounded-xl text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
            style={{ background: `linear-gradient(135deg, ${theme.colors.primary}, ${theme.colors.accent})` }}
          >
            {processing ? 'Processing…' : 'Match & Review'}
          </button>
        </div>
      )}

      {mode === 'ocr' && (
        <div className="card space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider mb-1.5">
              Upload PowerScribe screenshot
            </label>
            <div
              onClick={() => fileRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all duration-200 ${
                ocrFile ? '' : 'border-white/15 hover:border-white/30 hover:bg-white/3'
              }`}
              style={ocrFile ? {
                borderColor: 'rgba(37,99,168,0.4)',
                background: 'rgba(37,99,168,0.06)',
              } : {}}
            >
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => setOcrFile(e.target.files?.[0] ?? null)}
              />
              {ocrFile ? (
                <div>
                  <p className="font-medium" style={{ color: theme.colors.accent }}>{ocrFile.name}</p>
                  <p className="text-slate-400 text-xs mt-1">
                    {(ocrFile.size / 1024).toFixed(0)} KB · Click to change
                  </p>
                </div>
              ) : (
                <div>
                  <p className="text-4xl mb-3">📸</p>
                  <p className="text-slate-300 text-sm font-medium">Drop or click to upload</p>
                  <p className="text-slate-500 text-xs mt-1">PNG, JPG, HEIC — any screenshot</p>
                </div>
              )}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider mb-1.5">
              Log Date
            </label>
            <input
              type="date"
              value={logDate}
              onChange={(e) => setLogDate(e.target.value)}
              className="input"
            />
          </div>
          <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
            <p className="text-amber-300 text-xs font-medium">⚡ OCR Tips</p>
            <p className="text-amber-300/70 text-xs mt-1">
              Higher resolution screenshots work best. Crop to just the study list.
              OCR runs locally — nothing leaves your device. Already-imported studies are auto-skipped.
            </p>
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            onClick={handleOcrProcess}
            disabled={!ocrFile || processing}
            className="w-full py-3 rounded-xl text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
            style={{ background: `linear-gradient(135deg, ${theme.colors.primary}, ${theme.colors.accent})` }}
          >
            {processing ? 'Running OCR…' : 'Extract & Match'}
          </button>
        </div>
      )}

      {mode === 'powerscribe' && (
        /* This branch is unreachable while the button is disabled.
           It will be wired up when PowerScribeImportProvider goes live. */
        <div className="card text-center py-10 space-y-3">
          <p className="text-2xl">⚡</p>
          <p className="text-white font-semibold">PowerScribe Live Sync</p>
          <p className="text-slate-400 text-sm max-w-sm mx-auto">
            The import pipeline is architected to accept PowerScribe as a native
            source. Authentication and site configuration coming soon.
          </p>
        </div>
      )}
    </div>
  );
}
