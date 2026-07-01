/**
 * Import.tsx
 *
 * Import screen — routes each import mode through the shared OCR workflow
 * service, then merges the returned rows into the active review session.
 *
 * Architecture placeholder:
 *   powerscribe → PowerScribeImportProvider (disabled, "Coming Soon")
 */

import { useState, useRef, useEffect } from 'react';
import { theme } from '../lib/theme';
import { searchExamLibrary } from '../utils/matching';
import { normalizeRadiologyDescription } from '../utils/radiologyDescriptionNormalization';
import { useProfile } from '../hooks/useProfile';
import { todayDateString } from '../utils/calculations';
import { db, ensureUserSettings } from '../db/database';
import {
  createTimelineEvent,
  discardActiveReviewSession,
  finalizeReviewSession,
  getSelectedCandidateIndices,
  getSelectedCandidates,
  getSelectedWorkRvu,
  loadActiveReviewSession,
  mergeReviewSessionRows,
  normalizedExamKey,
  persistActiveReviewSession,
  type TimelineEvent,
} from '../services/reviewSessionService';
import { rememberCorrectedExam } from '../services/memoryLearningService';
import { processOcrImport, processTextImport } from '../services/ocrWorkflowService';
import type { PipelineReviewRow } from '../pipeline/importPipeline';
import type { DuplicateStatus, MatchCandidate } from '../types';

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

function candidateKey(candidate: MatchCandidate): string {
  return `${candidate.cptCode}-${candidate.modifier ?? ''}`;
}

function candidateExplanationText(candidate: MatchCandidate, rawText: string): string {
  const normalized = candidate.explanation?.normalizedText ?? normalizeRadiologyDescription(rawText);
  const source = candidate.explanation?.source ?? candidate.method.replace(/_/g, ' ');
  return `Raw: ${rawText} | Normalized: ${normalized} | Source: ${source} | Method: ${candidate.method} | CMS: ${candidate.description}`;
}

function isRadiologyCpt(candidate: MatchCandidate): boolean {
  return /^7\d{4}$/.test(candidate.cptCode);
}

function isProductivityCandidate(candidate: MatchCandidate): boolean {
  return candidate.modifier === '26' && (candidate.workRvu ?? 0) > 0;
}

function hasProcedureSignal(row: PipelineReviewRow): boolean {
  const text = `${row.source.examTitle} ${row.candidates.map((c) => c.description).join(' ')}`.toLowerCase();
  return /\b(?:biopsy|lesion|drain|drainage|aspirat|injection|catheter|tube|port|line|needle|arthrogram|myelogram|guided|guidance|stereo|procedure)\b/.test(text) ||
    row.candidates.some((candidate) => candidate.modality === 'PROCEDURE');
}

function hasMultiplePossibleCptMatches(row: PipelineReviewRow): boolean {
  const plausible = row.candidates.filter(
    (candidate) => isProductivityCandidate(candidate) && candidate.confidence >= 0.65,
  );
  return plausible.length > 1 || getSelectedCandidates(row).length > 1;
}

function safeAutoApprovalCandidate(row: PipelineReviewRow): MatchCandidate | null {
  const selected = getSelectedCandidates(row).filter(isProductivityCandidate);
  const candidate = selected.length === 1 ? selected[0] : row.candidates.find(isProductivityCandidate);
  if (!candidate) return null;
  if (!isRadiologyCpt(candidate)) return null;
  if ((candidate.workRvu ?? 0) <= 0) return null;
  if (candidate.confidence < 0.85) return null;
  if (hasMultiplePossibleCptMatches(row)) return null;
  if (hasProcedureSignal(row)) return null;
  return candidate;
}

function isSafeAutoApprovalRow(row: PipelineReviewRow): boolean {
  return Boolean(row.included && row.duplicateStatus !== 'possible' && safeAutoApprovalCandidate(row));
}

function isPriorApprovedMappingRow(row: PipelineReviewRow): boolean {
  const candidate = safeAutoApprovalCandidate(row);
  return Boolean(candidate && candidate.method === 'alias_match' && candidate.confidence >= 0.95);
}

function confidenceLabel(row: PipelineReviewRow, candidate?: MatchCandidate): { label: string; tone: 'green' | 'sky' | 'amber' | 'red' } {
  const current = candidate ?? getSelectedCandidates(row)[0] ?? row.candidates[0];
  if (!current) return { label: 'No match', tone: 'red' };
  if (current.method === 'alias_match' && current.confidence >= 0.95) {
    return { label: 'Exact alias match', tone: 'green' };
  }
  if (current.confidence >= 0.85 && current.method === 'radiology_match') {
    return { label: 'High-confidence normalized match', tone: 'sky' };
  }
  return { label: 'Fuzzy match needs review', tone: 'amber' };
}

function labelClass(tone: 'green' | 'sky' | 'amber' | 'red'): string {
  if (tone === 'green') return 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400';
  if (tone === 'sky') return 'bg-sky-500/15 border-sky-500/30 text-sky-300';
  if (tone === 'amber') return 'bg-amber-500/15 border-amber-500/30 text-amber-300';
  return 'bg-red-500/15 border-red-500/30 text-red-300';
}

function manualReviewReason(row: PipelineReviewRow): string | null {
  const selected = getSelectedCandidates(row);
  const candidate = selected[0] ?? row.candidates[0];
  if (!candidate) return 'No match';
  if (selected.length > 1) return 'Multiple CPTs selected';
  if ((candidate.workRvu ?? 0) <= 0 || candidate.modifier !== '26') return 'Not modifier 26 productivity RVU';
  if (!isRadiologyCpt(candidate)) return 'Non-7xxxx CPT requires explicit selection';
  if (candidate.confidence < 0.85) return 'Low confidence';
  if (hasMultiplePossibleCptMatches(row)) return 'Multiple possible CPT matches';
  if (hasProcedureSignal(row)) return 'Possible multi-CPT/procedure exam';
  if (row.duplicateStatus === 'possible') return 'Possible duplicate';
  return null;
}

function buildManualSelectionPatch(
  row: PipelineReviewRow,
  candidatesToSelect: MatchCandidate[],
  forceReviewed = false,
): Pick<PipelineReviewRow, 'candidates' | 'selectedCandidateIndex' | 'selectedCandidateIndices' | 'needsReview'> {
  const updatedCandidates = [...row.candidates];
  const existingKeys = new Set(updatedCandidates.map(candidateKey));
  for (const candidate of candidatesToSelect) {
    if (!existingKeys.has(candidateKey(candidate))) {
      updatedCandidates.push(candidate);
      existingKeys.add(candidateKey(candidate));
    }
  }

  const selectedKeys = new Set(getSelectedCandidates(row).map(candidateKey));
  candidatesToSelect.forEach((candidate) => selectedKeys.add(candidateKey(candidate)));
  const selectedCandidateIndices = updatedCandidates
    .map((candidate, index) => (selectedKeys.has(candidateKey(candidate)) ? index : -1))
    .filter((index) => index >= 0);
  const nextRow = { ...row, candidates: updatedCandidates, selectedCandidateIndices, selectedCandidateIndex: selectedCandidateIndices[0] ?? null };

  return {
    candidates: updatedCandidates,
    selectedCandidateIndex: selectedCandidateIndices[0] ?? null,
    selectedCandidateIndices,
    needsReview: forceReviewed ? false : Boolean(manualReviewReason(nextRow)),
  };
}

function buildApprovalPatch(row: PipelineReviewRow): Pick<PipelineReviewRow, 'selectedCandidateIndex' | 'selectedCandidateIndices' | 'needsReview'> | null {
  const candidate = safeAutoApprovalCandidate(row);
  if (!candidate) return null;
  const index = row.candidates.findIndex((existing) => candidateKey(existing) === candidateKey(candidate));
  if (index < 0) return null;
  return { selectedCandidateIndex: index, selectedCandidateIndices: [index], needsReview: false };
}

function getCandidatesFromPatch(
  patch: Pick<PipelineReviewRow, 'candidates' | 'selectedCandidateIndices'>,
): MatchCandidate[] {
  return (patch.selectedCandidateIndices ?? [])
    .map((index) => patch.candidates[index])
    .filter(Boolean);
}

interface ImportProps {
  onImported: () => void;
}

type Mode = 'paste' | 'ocr' | 'powerscribe';
type Step = 'input' | 'review' | 'done';
type ReviewMode = 'unknowns' | 'everything' | 'auto' | 'low';
const WATCHER_REVIEW_KEY = 'wrvu_pending_watcher_review';

export function Import({ onImported }: ImportProps) {
  const { activeProfile, activePractice } = useProfile();
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
  const [reviewMode, setReviewMode] = useState<ReviewMode>('unknowns');
  const [clipboardFile, setClipboardFile] = useState<File | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem(WATCHER_REVIEW_KEY);
    if (!raw) return;
    try {
      const rows = JSON.parse(raw) as PipelineReviewRow[];
      if (Array.isArray(rows) && rows.length > 0) {
        setReviewRows(rows);
        setSkippedRows([]);
        setLogDate(rows[0]?.source.studyDate ?? todayDateString());
        setStep('review');
      }
    } finally {
      sessionStorage.removeItem(WATCHER_REVIEW_KEY);
    }
  }, []);

  useEffect(() => {
    loadActiveReviewSession(activeProfile?.id ?? null).then((session) => {
      if (!session || reviewRows.length > 0) return;
      setSessionId(session.sessionId);
      setReviewRows(session.rows);
      setSkippedRows(session.skippedRows);
      setTimeline(session.timeline);
      setLogDate(session.readingDate);
      setStep('review');
    });
  }, [activeProfile?.id]);

  useEffect(() => {
    if (step !== 'review' || reviewRows.length === 0) return;
    const id = sessionId ?? crypto.randomUUID();
    if (!sessionId) setSessionId(id);
    void persistActiveReviewSession({
      sessionId: id,
      profileId: activeProfile?.id ?? null,
      readingDate: logDate,
      rows: reviewRows,
      skippedRows,
      timeline,
    });
  }, [step, reviewRows, skippedRows, timeline, logDate, activeProfile?.id, sessionId]);

  useEffect(() => {
    db.userSettings.get('default').then((settings) => {
      if (!settings) return;
      if (settings.reviewOnlyLowConfidence) setReviewMode('low');
      else if (settings.reviewAutoApprovedExams) setReviewMode('auto');
      else if (settings.unknownsOnlyReview === false) setReviewMode('everything');
      else setReviewMode('unknowns');
    });
  }, []);

  useEffect(() => {
    if (mode !== 'ocr') return;
    function handlePaste(event: ClipboardEvent) {
      const imageItem = Array.from(event.clipboardData?.items ?? []).find((item) => item.type.startsWith('image/'));
      if (!imageItem) return;
      const blob = imageItem.getAsFile();
      if (!blob) return;
      const file = new File([blob], `powerscribe-clipboard-${Date.now()}.png`, { type: blob.type || 'image/png' });
      event.preventDefault();
      setClipboardFile(file);
      db.userSettings.get('default').then((settings) => {
        if (settings?.autoImportClipboardScreenshots || settings?.alwaysProcessPowerScribeClipboard) {
          setOcrFile(file);
          setClipboardFile(null);
        }
      });
    }
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [mode]);

  // ── Process helpers ───────────────────────────────────────────────────────

  function addTimeline(label: string) {
    setTimeline((events) => [
      ...events,
      createTimelineEvent(label),
    ]);
  }

  function appendPipelineRows(nextRows: PipelineReviewRow[], nextSkippedRows: PipelineReviewRow[], label: string) {
    const merged = mergeReviewSessionRows(reviewRows, skippedRows, nextRows, nextSkippedRows);
    setReviewRows(merged.reviewRows);
    setSkippedRows(merged.skippedRows);
    addTimeline(label);
    setStep('review');
  }

  async function handlePasteProcess() {
    if (!pasteText.trim()) return;
    setProcessing(true);
    setError(null);
    try {
      const processed = await processTextImport(pasteText, {
        profileId: activeProfile?.id ?? null,
        siteId: activePractice?.id ?? null,
        sessionId,
        logDate,
      });
      appendPipelineRows(processed.result.reviewRows, processed.result.skippedRows, processed.timelineLabel);
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
      const processed = await processOcrImport(ocrFile, {
        profileId: activeProfile?.id ?? null,
        siteId: activePractice?.id ?? null,
        sessionId,
        logDate,
      }, { filename: ocrFile.name, size: ocrFile.size });
      appendPipelineRows(processed.result.reviewRows, processed.result.skippedRows, processed.timelineLabel);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'OCR failed — try paste mode instead');
    } finally {
      setProcessing(false);
    }
  }

  async function alwaysProcessClipboard(file: File) {
    const settings = await ensureUserSettings();
    await db.userSettings.put({
      ...settings,
      autoImportClipboardScreenshots: true,
      alwaysProcessPowerScribeClipboard: true,
      updatedAt: new Date().toISOString(),
    });
    setOcrFile(file);
    setClipboardFile(null);
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
      const result = await finalizeReviewSession({
        sessionId,
        profileId: activeProfile?.id ?? null,
        siteId: activePractice?.id ?? null,
        logDate,
        rows: reviewRows,
        skippedRows,
        timeline,
      });
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

  async function discardSession() {
    if (!confirm('Discard this active review session? No productivity history will be saved.')) return;
    await discardActiveReviewSession({
      sessionId,
      profileId: activeProfile?.id ?? null,
      siteId: activePractice?.id ?? null,
      logDate,
      reviewRowCount: reviewRows.length,
      skippedRowCount: skippedRows.length,
    });
    setSessionId(null);
    setReviewRows([]);
    setSkippedRows([]);
    setTimeline([]);
    setStep('input');
  }

  function updateRow(tempId: string, patch: Partial<PipelineReviewRow>) {
    setReviewRows((rows) =>
      rows.map((r) => (r.tempId === tempId ? { ...r, ...patch } : r)),
    );
  }

  function setSelectedCandidates(row: PipelineReviewRow, indices: number[]) {
    const uniqueIndices = Array.from(new Set(indices)).filter((index) => Boolean(row.candidates[index]));
    const selected = uniqueIndices.map((index) => row.candidates[index]);
    const nextRow = { ...row, selectedCandidateIndex: uniqueIndices[0] ?? null, selectedCandidateIndices: uniqueIndices };
    updateRow(row.tempId, {
      selectedCandidateIndex: uniqueIndices[0] ?? null,
      selectedCandidateIndices: uniqueIndices,
      needsReview: uniqueIndices.length === 0 || selected.length !== 1 || Boolean(manualReviewReason(nextRow)),
    });
  }

  function approveRows(predicate: (row: PipelineReviewRow) => boolean) {
    setReviewRows((rows) =>
      rows.map((row) => {
        if (!predicate(row)) return row;
        const patch = buildApprovalPatch(row);
        return patch ? { ...row, ...patch } : row;
      }),
    );
  }

  function approveHighConfidence() {
    approveRows((row) => isSafeAutoApprovalRow(row));
  }

  function approvePriorMappings() {
    approveRows((row) => isPriorApprovedMappingRow(row));
  }

  function approveSameNormalizedDescription(tempId: string) {
    const sourceRow = reviewRows.find((row) => row.tempId === tempId);
    if (!sourceRow) return;
    const patch = buildApprovalPatch(sourceRow);
    if (!patch) return;
    const sourceCandidate = sourceRow.candidates[patch.selectedCandidateIndex ?? -1];
    if (!sourceCandidate) return;
    const sourceKey = normalizedExamKey(sourceRow);

    setReviewRows((rows) =>
      rows.map((row) => {
        if (normalizedExamKey(row) !== sourceKey || !row.included) return row;
        if (manualReviewReason({ ...row, candidates: row.candidates, selectedCandidateIndex: patch.selectedCandidateIndex, selectedCandidateIndices: patch.selectedCandidateIndices })) {
          const manualPatch = buildManualSelectionPatch(row, [sourceCandidate], true);
          return { ...row, ...manualPatch };
        }
        const approvalPatch = buildManualSelectionPatch(row, [sourceCandidate], true);
        return { ...row, ...approvalPatch };
      }),
    );
  }

  async function handleManualSelect(tempId: string, candidate: MatchCandidate) {
    const row = reviewRows.find((r) => r.tempId === tempId);
    if (!row) return;

    const normalizedSourceKey = normalizedExamKey(row);
    const rowsToUpdate = reviewRows.filter(
      (reviewRow) => normalizedExamKey(reviewRow) === normalizedSourceKey,
    );

    const patchesByTempId = new Map<string, ReturnType<typeof buildManualSelectionPatch>>();
    for (const reviewRow of rowsToUpdate) {
      patchesByTempId.set(reviewRow.tempId, buildManualSelectionPatch(reviewRow, [candidate], true));
    }

    setReviewRows((rows) =>
      rows.map((reviewRow) => {
        const patch = patchesByTempId.get(reviewRow.tempId);
        return patch ? { ...reviewRow, ...patch } : reviewRow;
      }),
    );

    const rowsByRawTitle = new Map<string, PipelineReviewRow>();
    rowsToUpdate.forEach((reviewRow) => rowsByRawTitle.set(reviewRow.source.examTitle, reviewRow));

    for (const aliasRow of rowsByRawTitle.values()) {
      const patch = patchesByTempId.get(aliasRow.tempId);
      const selectedForAlias = patch ? getCandidatesFromPatch(patch) : [];
      if (!selectedForAlias.length) continue;

      await rememberCorrectedExam({
        rawText: aliasRow.source.examTitle,
        candidates: selectedForAlias.map((c) => ({
          cptCode: c.cptCode,
          modifier: c.modifier,
          workRvu: c.workRvu,
          description: c.description,
          modality: c.modality,
        })),
        profileId: activeProfile?.id ?? null,
        siteId: activePractice?.id ?? null,
        sessionId,
        logDate,
      });
    }

    setSearchPanelTempId(null);
  }

  const includedCount = reviewRows.filter((r) => r.included).length;
  const matchedCount = reviewRows.filter((r) => r.included && getSelectedCandidates(r).length > 0).length;
  const selectedCodeCount = reviewRows
    .filter((r) => r.included)
    .reduce((sum, row) => sum + getSelectedCandidates(row).length, 0);
  const possibleDupes = reviewRows.filter(
    (r) => r.included && r.duplicateStatus === 'possible',
  ).length;
  const safeApprovalCount = reviewRows.filter(isSafeAutoApprovalRow).length;
  const priorMappingCount = reviewRows.filter(isPriorApprovedMappingRow).length;
  const autoCodedCount = reviewRows.filter((row) => row.included && !row.needsReview).length;
  const requiresReviewCount = reviewRows.filter((row) => row.included && row.needsReview).length;
  const autoCodingPct = includedCount ? (autoCodedCount / includedCount) * 100 : 0;
  const estimatedMinutesSaved = Math.round(autoCodedCount * 0.35);
  const visibleReviewRows = reviewRows.filter((row) => {
    if (reviewMode === 'everything') return true;
    if (reviewMode === 'auto') return row.autoApproved || !row.needsReview;
    if (reviewMode === 'low') return row.included && row.needsReview && (row.candidates[0]?.confidence ?? 0) < 0.95;
    return row.included && row.needsReview;
  });

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
              sessionStorage.removeItem(WATCHER_REVIEW_KEY);
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

        <div className="card space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-white">Active Review Session</p>
              <p className="text-xs text-slate-500">Temporary worklist. Nothing is saved to productivity history until Finalize Day.</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setStep('input')}
                className="px-3 py-1.5 rounded-lg border border-white/12 text-xs text-slate-300 hover:text-white hover:border-white/25"
              >
                Continue Later / Add Screenshots
              </button>
              <button
                onClick={discardSession}
                className="px-3 py-1.5 rounded-lg border border-red-500/25 text-xs text-red-400 hover:bg-red-500/10"
              >
                Discard Session
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            <div className="rounded-lg border border-white/8 bg-white/3 px-3 py-2">
              <p className="text-[10px] uppercase tracking-wider text-slate-500">Total exams</p>
              <p className="text-lg font-bold text-white">{includedCount}</p>
            </div>
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/8 px-3 py-2">
              <p className="text-[10px] uppercase tracking-wider text-emerald-500/80">Confirmed</p>
              <p className="text-lg font-bold text-emerald-300">
                {reviewRows.filter((row) => row.included && !row.needsReview).reduce((sum, row) => sum + getSelectedWorkRvu(row), 0).toFixed(1)}
              </p>
            </div>
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/8 px-3 py-2">
              <p className="text-[10px] uppercase tracking-wider text-amber-500/80">Pending est.</p>
              <p className="text-lg font-bold text-amber-300">
                {reviewRows.filter((row) => row.included && row.needsReview).reduce((sum, row) => sum + getSelectedWorkRvu(row), 0).toFixed(1)}
              </p>
            </div>
            <div className="rounded-lg border border-sky-500/20 bg-sky-500/8 px-3 py-2">
              <p className="text-[10px] uppercase tracking-wider text-sky-500/80">Projected</p>
              <p className="text-lg font-bold text-sky-300">
                {reviewRows.filter((row) => row.included).reduce((sum, row) => sum + getSelectedWorkRvu(row), 0).toFixed(1)}
              </p>
            </div>
            <div className="rounded-lg border border-red-500/20 bg-red-500/8 px-3 py-2">
              <p className="text-[10px] uppercase tracking-wider text-red-400/80">Needs review</p>
              <p className="text-lg font-bold text-red-300">{requiresReviewCount}</p>
            </div>
            <div className="rounded-lg border border-orange-500/20 bg-orange-500/8 px-3 py-2">
              <p className="text-[10px] uppercase tracking-wider text-orange-400/80">Duplicates</p>
              <p className="text-lg font-bold text-orange-300">{skippedRows.length + possibleDupes}</p>
            </div>
          </div>
        </div>

        <div className="card flex flex-wrap items-center gap-2">
          <button
            onClick={approveHighConfidence}
            disabled={safeApprovalCount === 0}
            className="btn-ghost text-xs disabled:opacity-40"
          >
            Approve all high-confidence matches ({safeApprovalCount})
          </button>
          <button
            onClick={approvePriorMappings}
            disabled={priorMappingCount === 0}
            className="btn-ghost text-xs disabled:opacity-40"
          >
            Approve all prior mappings ({priorMappingCount})
          </button>
          <span className="text-xs text-slate-500 ml-auto">
            Low-confidence, ambiguous, procedure, 0.0 wRVU, and non-7xxxx rows stay in review.
          </span>
        </div>

        {timeline.length > 0 && (
          <div className="card space-y-2">
            <p className="text-sm font-semibold text-white">Daily Timeline</p>
            <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
              {timeline.slice(-8).map((event) => (
                <div key={event.id} className="flex items-center gap-2 text-xs">
                  <span className="font-mono text-slate-500 w-12">
                    {new Date(event.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                  </span>
                  <span className="text-slate-300">{event.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {[
            ['Uploaded', includedCount.toLocaleString()],
            ['Auto-coded', autoCodedCount.toLocaleString()],
            ['Requires review', requiresReviewCount.toLocaleString()],
            ['Auto-coding', `${autoCodingPct.toFixed(0)}%`],
            ['Time saved', `${estimatedMinutesSaved} min`],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border border-white/8 bg-white/3 px-3 py-2">
              <p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
              <p className="text-lg font-bold text-white">{value}</p>
            </div>
          ))}
        </div>

        <div className="card flex flex-wrap items-center gap-2">
          {[
            ['unknowns', 'Unknowns Only'],
            ['everything', 'Review Everything'],
            ['auto', 'Review Auto-approved'],
            ['low', 'Low-confidence Only'],
          ].map(([modeId, label]) => (
            <button
              key={modeId}
              onClick={() => setReviewMode(modeId as ReviewMode)}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                reviewMode === modeId
                  ? 'border-sky-500/40 bg-sky-500/15 text-sky-300'
                  : 'border-white/10 text-slate-400 hover:border-white/25 hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
          <span className="text-xs text-slate-500 ml-auto">
            Showing {visibleReviewRows.length} of {reviewRows.length} rows.
          </span>
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
          {visibleReviewRows.map((row, i) => {
            const isPossibleDupe = row.duplicateStatus === 'possible';
            const selectedIndices = getSelectedCandidateIndices(row);
            const selected = getSelectedCandidates(row);
            const selectedTotal = getSelectedWorkRvu(row);
            const label = confidenceLabel(row);
            const reviewReason = manualReviewReason(row);
            const canApproveSame = Boolean(buildApprovalPatch(row));
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
                    {/* Date/time row with source confidence indicator */}
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      {row.source.studyTime ? (
                        <span className="text-xs font-mono text-slate-300">
                          {new Date(row.source.studyTime).toLocaleString('en-US', {
                            month: 'numeric', day: 'numeric',
                            hour: 'numeric', minute: '2-digit', hour12: true,
                          })}
                        </span>
                      ) : row.source.studyDate ? (
                        <span className="text-xs font-mono text-slate-300">
                          {new Date(row.source.studyDate + 'T12:00:00').toLocaleDateString('en-US', {
                            month: 'numeric', day: 'numeric', year: 'numeric',
                          })}
                        </span>
                      ) : null}
                      {/* Source confidence badge */}
                      {row.source.dateTimeSource === 'ocr' && (row.source.dateTimeConfidence ?? 0) >= 1.0 ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/25 text-emerald-400 font-medium">
                          OCR ✓
                        </span>
                      ) : row.source.dateTimeSource === 'ocr' && (row.source.dateTimeConfidence ?? 0) > 0 ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/15 border border-sky-500/25 text-sky-400 font-medium">
                          OCR date
                        </span>
                      ) : (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/25 text-amber-400/80 font-medium" title="Date was not extracted from OCR — using the log date you selected">
                          ⚠ inferred
                        </span>
                      )}
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${labelClass(label.tone)}`}>
                        {label.label}
                      </span>
                      {reviewReason && row.included && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded border border-amber-500/25 bg-amber-500/10 text-amber-300">
                          {reviewReason}
                        </span>
                      )}
                    </div>
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
                    {canApproveSame && row.included && (
                      <button
                        onClick={() => approveSameNormalizedDescription(row.tempId)}
                        className="text-xs px-2 py-1 rounded-lg border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                      >
                        Approve same
                      </button>
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
                {row.included && selected.length > 0 && (
                  <div className="mb-2 rounded-lg border border-sky-500/20 bg-sky-500/8 px-3 py-2">
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-sky-300">
                        Selected CPTs
                      </span>
                      <span className="text-xs font-semibold text-white">
                        {selectedTotal.toFixed(2)} wRVU total
                      </span>
                    </div>
                    <div className="flex flex-wrap items-stretch gap-2">
                      {selected.map((candidate, candidateIndex) => (
                        <div key={candidateKey(candidate)} className="contents">
                          {candidateIndex > 0 && (
                            <span className="self-center text-sky-300 text-sm font-bold px-0.5">+</span>
                          )}
                          <div className="min-w-[11rem] max-w-full flex-1 sm:flex-none rounded-xl border border-white/12 bg-white/5 px-3 py-2">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="text-xs font-medium text-white truncate">
                                  {candidate.description.slice(0, 52)}
                                  {candidate.description.length > 52 ? '...' : ''}
                                </p>
                                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                  <span className="font-mono text-[11px] font-bold text-sky-300">{candidate.cptCode}</span>
                                  {candidate.modifier && <span className="text-[10px] text-slate-400">mod {candidate.modifier}</span>}
                                  <span className="text-[10px] text-emerald-400">{candidate.workRvu?.toFixed(2)} wRVU</span>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  setSelectedCandidates(
                                    row,
                                    selectedIndices.filter((index) => candidateKey(row.candidates[index]) !== candidateKey(candidate)),
                                  )
                                }
                                className="text-slate-500 hover:text-red-300 transition-colors"
                                title="Remove this study bubble"
                              >
                                x
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

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
                      const isSelected = selectedIndices.includes(ci);
                      const candidateLabel = confidenceLabel(row, c);
                      return (
                        <button
                          key={`${c.cptCode}-${c.modifier}-${ci}`}
                          onClick={() =>
                            setSelectedCandidates(
                              row,
                              isSelected
                                ? selectedIndices.filter((index) => index !== ci)
                                : [...selectedIndices, ci],
                            )
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
                          <span className={`ml-1.5 text-[10px] font-semibold uppercase tracking-wide ${
                            candidateLabel.tone === 'green' ? 'text-emerald-500/70' :
                            candidateLabel.tone === 'sky' ? 'text-sky-400/80' :
                            candidateLabel.tone === 'amber' ? 'text-amber-500/70' : 'text-red-400/80'
                          }`}>
                            {candidateLabel.label}
                          </span>
                          {isSelected && (
                            <span className="ml-1.5 text-sky-300 text-[10px] font-semibold uppercase tracking-wide">
                              selected
                            </span>
                          )}
                          <span className="mt-1 block text-[10px] leading-snug text-slate-500">
                            {candidateExplanationText(c, row.source.examTitle)}
                          </span>
                          {c.confidence < 0.75 && row.candidates.length > 1 && (
                            <span className="mt-0.5 block text-[10px] text-amber-300/80">
                              Alternatives: {row.candidates.filter((alt, altIndex) => altIndex !== ci).slice(0, 3).map((alt) => `${alt.cptCode}${alt.modifier ? `-${alt.modifier}` : ''} ${Math.round(alt.confidence * 100)}%`).join(' | ')}
                            </span>
                          )}
                        </button>
                      );
                    })}
                    {/* Add another CPT is always available for combined-code studies. */}
                    <div className="flex items-center justify-end pt-0.5">
                      <button
                        onClick={() =>
                          setSearchPanelTempId(
                            searchPanelTempId === row.tempId ? null : row.tempId,
                          )
                        }
                        className="text-[11px] text-slate-500 hover:text-sky-400 transition-colors"
                      >
                        {searchPanelTempId === row.tempId ? '↑ Close search' : 'Add another CPT'}
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
              (selectedCodeCount === 0 && reviewRows.length > 0) ||
              (reviewRows.length === 0 && skippedRows.length > 0 && matchedCount === 0)
            }
            className="flex-1 py-2.5 rounded-xl text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
            style={{ background: `linear-gradient(135deg, ${theme.colors.primary}, ${theme.colors.accent})` }}
          >
            {importing
              ? 'Saving…'
              : reviewRows.length === 0
              ? 'All Duplicates — Nothing to Import'
              : `Finalize Day: ${matchedCount} ${matchedCount === 1 ? 'Study' : 'Studies'} (${selectedCodeCount} CPT${selectedCodeCount === 1 ? '' : 's'})`}
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
            Live PowerScribe sync is architecturally supported — the provider interface and pipeline are ready. Authentication and site configuration coming soon.
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
          {clipboardFile && (
            <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 p-3 space-y-3">
              <p className="text-sm font-semibold text-sky-300">PowerScribe screenshot detected - Process?</p>
              <p className="text-xs text-slate-400">
                The pasted image will be processed in memory for OCR, then discarded. Only parsed exam/CPT productivity data is stored.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => { setOcrFile(clipboardFile); setClipboardFile(null); }}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white"
                  style={{ background: `linear-gradient(135deg, ${theme.colors.primary}, ${theme.colors.accent})` }}
                >
                  Process
                </button>
                <button
                  onClick={() => setClipboardFile(null)}
                  className="px-3 py-1.5 rounded-lg border border-white/12 text-xs text-slate-400 hover:text-white"
                >
                  Ignore
                </button>
                <button
                  onClick={() => alwaysProcessClipboard(clipboardFile)}
                  className="px-3 py-1.5 rounded-lg border border-sky-500/30 text-xs text-sky-300 hover:bg-sky-500/10"
                >
                  Always process PowerScribe screenshots
                </button>
              </div>
            </div>
          )}
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
                  <p className="text-slate-300 text-sm font-medium">Paste, drop, or click to upload</p>
                  <p className="text-slate-500 text-xs mt-1">Alt+Print Screen, then paste here. Images are not stored.</p>
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
