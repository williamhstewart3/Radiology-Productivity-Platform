import { useState, useRef } from 'react';
import { db } from '../db/database';
import { parseBulkText } from '../utils/bulkTextParser';
import { parseOcrLines } from '../utils/powerScribeParser';
import { findMatchCandidates, learnAlias } from '../utils/matching';
import { getDefaultOcrProvider } from '../utils/ocrProvider';
import { todayDateString } from '../utils/calculations';
import type { OcrReviewRow, MatchCandidate, StudyLog } from '../types';
import { MODALITY_LABELS } from '../types';

interface ImportProps {
  onImported: () => void;
}

type Mode = 'paste' | 'ocr';
type Step = 'input' | 'review' | 'done';

export function Import({ onImported }: ImportProps) {
  const [mode, setMode] = useState<Mode>('paste');
  const [step, setStep] = useState<Step>('input');
  const [pasteText, setPasteText] = useState('');
  const [ocrFile, setOcrFile] = useState<File | null>(null);
  const [processing, setProcessing] = useState(false);
  const [reviewRows, setReviewRows] = useState<OcrReviewRow[]>([]);
  const [logDate, setLogDate] = useState(todayDateString());
  const [importing, setImporting] = useState(false);
  const [importedCount, setImportedCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handlePasteProcess() {
    if (!pasteText.trim()) return;
    setProcessing(true);
    setError(null);
    try {
      const entries = parseBulkText(pasteText);
      const rows: OcrReviewRow[] = [];
      for (const entry of entries) {
        const candidates = await findMatchCandidates(entry, 4);
        rows.push({
          tempId: crypto.randomUUID(),
          rawText: entry,
          parsedExamName: entry,
          studyDateTime: null,
          accessionNumber: null,
          candidates,
          selectedCandidateIndex: candidates.length > 0 && candidates[0].confidence >= 0.75 ? 0 : null,
          needsReview: candidates.length === 0 || candidates[0].confidence < 0.75,
          included: true,
        });
      }
      setReviewRows(rows);
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
      const result = await provider.extractText(ocrFile);
      const parsed = parseOcrLines(result.lines);
      const rows: OcrReviewRow[] = [];
      for (const p of parsed) {
        const candidates = await findMatchCandidates(p.examName, 4);
        rows.push({
          tempId: crypto.randomUUID(),
          rawText: p.rawText,
          parsedExamName: p.examName,
          studyDateTime: p.studyDateTime,
          accessionNumber: p.accessionNumber,
          candidates,
          selectedCandidateIndex: candidates.length > 0 && candidates[0].confidence >= 0.75 ? 0 : null,
          needsReview: candidates.length === 0 || candidates[0].confidence < 0.75,
          included: true,
        });
      }
      setReviewRows(rows);
      setStep('review');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'OCR failed — try the paste mode instead');
    } finally {
      setProcessing(false);
    }
  }

  async function handleCommit() {
    setImporting(true);
    setError(null);
    try {
      const now = new Date().toISOString();
      const importId = crypto.randomUUID();
      let count = 0;

      for (const row of reviewRows) {
        if (!row.included) continue;
        if (row.selectedCandidateIndex === null) continue;
        const cand: MatchCandidate = row.candidates[row.selectedCandidateIndex];
        if (!cand) continue;

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
          needsReview: cand.confidence < 0.75 || row.needsReview,
          accessionNumber: row.accessionNumber,
          sessionId: null,
          sourceImportId: importId,
          notes: null,
          createdAt: now,
          updatedAt: now,
        };

        await db.studyLogs.add(log);
        await learnAlias(row.parsedExamName, cand.cptCode, cand.modifier, 'ocr_confirmed');
        count++;
      }

      setImportedCount(count);
      setStep('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  function updateRow(tempId: string, patch: Partial<OcrReviewRow>) {
    setReviewRows((rows) =>
      rows.map((r) => (r.tempId === tempId ? { ...r, ...patch } : r))
    );
  }

  const includedCount = reviewRows.filter((r) => r.included).length;
  const matchedCount = reviewRows.filter((r) => r.included && r.selectedCandidateIndex !== null).length;

  if (step === 'done') {
    return (
      <div className="max-w-lg mx-auto text-center space-y-6 py-16 animate-in fade-in duration-300">
        <div className="w-20 h-20 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center mx-auto text-4xl">
          ✓
        </div>
        <div>
          <h2 className="text-2xl font-bold text-white">Import Complete</h2>
          <p className="text-slate-400 mt-2">
            {importedCount} {importedCount === 1 ? 'study' : 'studies'} logged for {logDate}
          </p>
        </div>
        <div className="flex gap-3 justify-center">
          <button
            onClick={() => { setStep('input'); setPasteText(''); setOcrFile(null); setReviewRows([]); }}
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

  if (step === 'review') {
    return (
      <div className="space-y-5 animate-in fade-in duration-300">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Review Matches</h1>
            <p className="text-slate-400 text-sm mt-0.5">
              {matchedCount}/{includedCount} matched · verify before saving
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

        {/* Review rows */}
        <div className="space-y-3">
          {reviewRows.map((row, i) => (
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
                <div className="flex items-center gap-2 shrink-0">
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

              {row.candidates.length === 0 ? (
                <p className="text-xs text-red-400 italic">No match found — will be excluded</p>
              ) : (
                <div className="space-y-1">
                  {row.candidates.map((c, ci) => {
                    const isSelected = row.selectedCandidateIndex === ci;
                    return (
                      <button
                        key={`${c.cptCode}-${c.modifier}-${ci}`}
                        onClick={() => updateRow(row.tempId, {
                          selectedCandidateIndex: ci,
                          needsReview: c.confidence < 0.75,
                        })}
                        className={`w-full text-left rounded-lg border px-3 py-2 text-xs transition-all ${
                          isSelected
                            ? 'bg-indigo-500/15 border-indigo-500/40 text-white'
                            : 'bg-white/3 border-white/8 text-slate-400 hover:border-white/20'
                        }`}
                      >
                        <span className="font-mono font-bold mr-2">{c.cptCode}</span>
                        <span className="mr-2">{c.description.slice(0, 60)}{c.description.length > 60 ? '…' : ''}</span>
                        <span className="font-medium">{c.workRvu?.toFixed(2)} wRVU</span>
                        <span className={`ml-2 ${c.confidence >= 0.85 ? 'text-emerald-400' : c.confidence >= 0.65 ? 'text-amber-400' : 'text-red-400'}`}>
                          {Math.round(c.confidence * 100)}%
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
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
            disabled={importing || matchedCount === 0}
            className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {importing ? 'Saving…' : `Save ${matchedCount} Studies`}
          </button>
        </div>
      </div>
    );
  }

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
              mode === m
                ? 'bg-white/10 text-white'
                : 'text-slate-400 hover:text-slate-300'
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
          <p className="text-xs text-slate-500">
            Supports: one per line, comma-separated, space-separated CPT codes, or mixed
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
          <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
            <p className="text-amber-300 text-xs font-medium">⚡ OCR Tips</p>
            <p className="text-amber-300/70 text-xs mt-1">
              Higher resolution screenshots work best. Crop to just the study list. 
              OCR runs locally — nothing leaves your device.
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
