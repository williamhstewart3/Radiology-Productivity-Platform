import { useState, useRef } from 'react';
import { db } from '../db/database';
import { parseBulkText } from '../utils/bulkTextParser';
import { parseOcrLines } from '../utils/powerScribeParser';
import { findMatchCandidates, learnAlias } from '../utils/matching';
import { getDefaultOcrProvider } from '../utils/ocrProvider';
import { todayDateString } from '../utils/calculations';
import { checkBatchDuplicates, buildFingerprint } from '../utils/duplicateDetection';
import type { OcrReviewRow, MatchCandidate, StudyLog, DuplicateStatus } from '../types';
import { MODALITY_LABELS } from '../types';

interface ImportProps {
  onImported: () => void;
}

type Mode = 'paste' | 'ocr';
type Step = 'input' | 'review' | 'done';

// Rows auto-skipped as exact or very_likely — held separately for user override
interface SkippedRow {
  tempId: string;
  parsedExamName: string;
  cptCode: string | null;
  workRvu: number | null;
  duplicateStatus: DuplicateStatus;
  duplicateReason: string | null;
  duplicateExistingLogId: string | null;
  // Keep enough to re-import if user forces it
  fullRow: OcrReviewRow;
}

export function Import({ onImported }: ImportProps) {
  const [mode, setMode]           = useState<Mode>('paste');
  const [step, setStep]           = useState<Step>('input');
  const [pasteText, setPasteText] = useState('');
  const [ocrFile, setOcrFile]     = useState<File | null>(null);
  const [processing, setProcessing] = useState(false);
  const [reviewRows, setReviewRows]   = useState<OcrReviewRow[]>([]);
  const [skippedRows, setSkippedRows] = useState<SkippedRow[]>([]);
  const [logDate, setLogDate]     = useState(todayDateString());
  const [importing, setImporting] = useState(false);
  const [importedCount, setImportedCount]   = useState(0);
  const [skippedCount, setSkippedCount]     = useState(0);
  const [reviewNeeded, setReviewNeeded]     = useState(0);
  const [error, setError]         = useState<string | null>(null);
  const [showSkipped, setShowSkipped]       = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Build review rows from parsed entries ─────────────────────────────────
  async function buildReviewRows(
    entries: Array<{
      examName: string;
      rawText: string;
      studyDateTime: string | null;
      accessionNumber: string | null;
    }>,
    date: string,
  ): Promise<{ reviewRows: OcrReviewRow[]; skippedRows: SkippedRow[] }> {
    // Step 1: Match all entries
    const matched: Array<{ entry: typeof entries[0]; candidates: MatchCandidate[] }> = [];
    for (const entry of entries) {
      const candidates = await findMatchCandidates(entry.examName, 4);
      matched.push({ entry, candidates });
    }

    // Step 2: Build candidate structs for dupe check
    const dupeCandidates = matched.map(({ entry, candidates }) => ({
      examNameRaw: entry.examName,
      cptCode: candidates[0]?.cptCode ?? null,
      modifier: candidates[0]?.modifier ?? null,
      logDate: date,
      studyDateTime: entry.studyDateTime,
      accessionNumber: entry.accessionNumber,
      modality: candidates[0]?.modality ?? null,
    }));

    // Step 3: Batch duplicate check
    const dupeResults = await checkBatchDuplicates(dupeCandidates, date);

    // Step 4: Separate into review vs auto-skipped
    const reviewOut: OcrReviewRow[] = [];
    const skippedOut: SkippedRow[] = [];

    for (let i = 0; i < matched.length; i++) {
      const { entry, candidates } = matched[i];
      const dupeResult = dupeResults[i];
      const top = candidates[0];
      const autoAccept = top?.method === 'alias_match' && top?.confidence >= 0.95;
      const dupStatus: DuplicateStatus = dupeResult?.match?.confidence ?? null;
      const dupReason = dupeResult?.match?.reason ?? null;
      const dupLogId  = dupeResult?.match?.existingLog.id === 'batch-duplicate'
        ? null
        : dupeResult?.match?.existingLog.id ?? null;

      const row: OcrReviewRow = {
        tempId: crypto.randomUUID(),
        rawText: entry.rawText,
        parsedExamName: entry.examName,
        studyDateTime: entry.studyDateTime,
        accessionNumber: entry.accessionNumber,
        candidates,
        selectedCandidateIndex: candidates.length > 0 && candidates[0].confidence >= 0.75 ? 0 : null,
        needsReview: !autoAccept && (candidates.length === 0 || candidates[0].confidence < 0.75),
        included: true,
        duplicateStatus: dupStatus,
        duplicateExistingLogId: dupLogId,
        duplicateReason: dupReason,
      };

      // Auto-skip exact and very_likely duplicates
      if (dupStatus === 'exact' || dupStatus === 'very_likely') {
        skippedOut.push({
          tempId: row.tempId,
          parsedExamName: entry.examName,
          cptCode: top?.cptCode ?? null,
          workRvu: top?.workRvu ?? null,
          duplicateStatus: dupStatus,
          duplicateReason: dupReason,
          duplicateExistingLogId: dupLogId,
          fullRow: { ...row, included: true },
        });
        // Don't add to reviewOut
      } else {
        reviewOut.push(row);
      }
    }

    return { reviewRows: reviewOut, skippedRows: skippedOut };
  }

  async function handlePasteProcess() {
    if (!pasteText.trim()) return;
    setProcessing(true);
    setError(null);
    try {
      const rawEntries = parseBulkText(pasteText);
      const entries = rawEntries.map((e) => ({
        examName: e,
        rawText: e,
        studyDateTime: null,
        accessionNumber: null,
      }));
      const { reviewRows: rv, skippedRows: sk } = await buildReviewRows(entries, logDate);
      setReviewRows(rv);
      setSkippedRows(sk);
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
      const provider = getDefaultOcrProvider();
      const result   = await provider.extractText(ocrFile);
      const parsed   = parseOcrLines(result.lines);
      const entries  = parsed.map((p) => ({
        examName: p.examName,
        rawText: p.rawText,
        studyDateTime: p.studyDateTime,
        accessionNumber: p.accessionNumber,
      }));
      const { reviewRows: rv, skippedRows: sk } = await buildReviewRows(entries, logDate);
      setReviewRows(rv);
      setSkippedRows(sk);
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
      { ...skipped.fullRow, duplicateStatus: null, needsReview: true },
    ]);
  }

  async function handleCommit() {
    setImporting(true);
    setError(null);
    try {
      const now      = new Date().toISOString();
      const importId = crypto.randomUUID();
      let count    = 0;
      let needsRev = 0;

      for (const row of reviewRows) {
        if (!row.included) continue;
        if (row.selectedCandidateIndex === null) continue;
        const cand: MatchCandidate = row.candidates[row.selectedCandidateIndex];
        if (!cand) continue;

        const fingerprint = buildFingerprint(
          row.parsedExamName,
          cand.cptCode,
          logDate,
          row.studyDateTime,
          row.accessionNumber,
          cand.modality,
        );

        const isReview = cand.confidence < 0.75 || row.needsReview || row.duplicateStatus === 'possible';

        const log: StudyLog = {
          id: crypto.randomUUID(),
          logDate,
          studyDateTime: row.studyDateTime,
          examNameRaw: row.rawText,
          cptCode: cand.cptCode,
          modifier: cand.modifier,
          workRvu: cand.workRvu,
          modality: cand.modality,
          matchMethod: cand.method,
          matchConfidence: cand.confidence,
          needsReview: isReview,
          accessionNumber: row.accessionNumber,
          sessionId: null,
          sourceImportId: importId,
          notes: null,
          studyFingerprint: fingerprint,
          createdAt: now,
          updatedAt: now,
        };

        await db.studyLogs.add(log);
        await learnAlias(row.parsedExamName, cand.cptCode, cand.modifier, 'ocr_confirmed');
        count++;
        if (isReview) needsRev++;
      }

      setImportedCount(count);
      setSkippedCount(skippedRows.length);
      setReviewNeeded(needsRev);
      setStep('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  function updateRow(tempId: string, patch: Partial<OcrReviewRow>) {
    setReviewRows((rows) =>
      rows.map((r) => (r.tempId === tempId ? { ...r, ...patch } : r)),
    );
  }

  const includedCount  = reviewRows.filter((r) => r.included).length;
  const matchedCount   = reviewRows.filter((r) => r.included && r.selectedCandidateIndex !== null).length;
  const possibleDupes  = reviewRows.filter((r) => r.included && r.duplicateStatus === 'possible').length;

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
            className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 text-white text-sm font-semibold hover:opacity-90 transition-opacity"
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

        {/* ── Skipped duplicates panel ─────────────────────────────────── */}
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
                {skippedRows.map((s) => (
                  <div key={s.tempId} className="px-4 py-3 flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-slate-300 truncate">{s.parsedExamName}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {s.cptCode && (
                          <span className="text-xs font-mono text-slate-500">{s.cptCode}</span>
                        )}
                        {s.workRvu !== null && (
                          <span className="text-xs text-slate-500">{s.workRvu.toFixed(2)} wRVU</span>
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
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Review rows ──────────────────────────────────────────────── */}
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
                    <p className="text-sm text-white font-medium truncate">{row.parsedExamName}</p>
                    {row.accessionNumber && (
                      <p className="text-xs text-slate-500">Acc: {row.accessionNumber}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                    {/* Possible duplicate warning */}
                    {isPossibleDupe && row.included && (
                      <span
                        className="text-xs bg-orange-500/15 border border-orange-500/30 text-orange-300 px-2 py-0.5 rounded-lg"
                        title={row.duplicateReason ?? ''}
                      >
                        ⚠ Possible dup
                      </span>
                    )}
                    {/* Learned alias badge */}
                    {!row.needsReview && row.included && !isPossibleDupe &&
                      row.candidates[0]?.method === 'alias_match' &&
                      row.candidates[0]?.confidence >= 0.95 && (
                      <span className="text-xs bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 px-2 py-0.5 rounded-lg">
                        ✓ Learned
                      </span>
                    )}
                    {/* Needs review badge */}
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

                {/* Possible duplicate inline reason */}
                {isPossibleDupe && row.included && (
                  <div className="mb-2 px-3 py-2 rounded-lg bg-orange-500/8 border border-orange-500/20 text-xs text-orange-300/80">
                    {row.duplicateReason} — verify before saving or exclude this row.
                  </div>
                )}

                {row.candidates.length === 0 ? (
                  <p className="text-xs text-red-400 italic">No match found — will be excluded</p>
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
                              ? 'bg-indigo-500/15 border-indigo-500/40 text-white'
                              : 'bg-white/3 border-white/8 text-slate-400 hover:border-white/20'
                          }`}
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
                        </button>
                      );
                    })}
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
            disabled={importing || (matchedCount === 0 && reviewRows.length > 0) || (reviewRows.length === 0 && skippedRows.length > 0 && matchedCount === 0)}
            className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
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
        <p className="text-slate-400 text-sm mt-0.5">Bulk log from pasted text or screenshot OCR</p>
      </div>

      {/* Mode toggle */}
      <div className="flex gap-2 p-1 bg-white/5 rounded-xl">
        {(['paste', 'ocr'] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => { setMode(m); setError(null); }}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
              mode === m ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-slate-300'
            }`}
          >
            {m === 'paste' ? '📋 Paste Text' : '📸 Screenshot OCR'}
          </button>
        ))}
      </div>

      {mode === 'paste' ? (
        <div className="card space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider mb-1.5">
              Paste exam names or CPT codes
            </label>
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={`CT Abdomen Pelvis with contrast\nMRI Brain without contrast\n74177, 70553, 71046\n...one per line or comma-separated`}
              rows={10}
              className="input w-full resize-none font-mono text-sm"
            />
          </div>
          {/* Log date picker shown on input step too so user sets it before processing */}
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
            Supports: one per line, comma-separated, space-separated CPT codes, or mixed.
            Duplicates are detected automatically.
          </p>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            onClick={handlePasteProcess}
            disabled={!pasteText.trim() || processing}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {processing ? 'Processing…' : 'Match & Review'}
          </button>
        </div>
      ) : (
        <div className="card space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider mb-1.5">
              Upload PowerScribe screenshot
            </label>
            <div
              onClick={() => fileRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all duration-200 ${
                ocrFile
                  ? 'border-indigo-500/40 bg-indigo-500/5'
                  : 'border-white/15 hover:border-white/30 hover:bg-white/3'
              }`}
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
                  <p className="text-indigo-400 font-medium">{ocrFile.name}</p>
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
          {/* Log date for OCR too */}
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
            className="w-full py-3 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {processing ? 'Running OCR…' : 'Extract & Match'}
          </button>
        </div>
      )}
    </div>
  );
}
