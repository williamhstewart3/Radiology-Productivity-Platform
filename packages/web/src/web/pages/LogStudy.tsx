/**
 * LogStudy.tsx

 *
 * Single-study manual entry form. Uses ManualImportProvider to produce an
 * ImportedStudy and feeds it through the shared importPipeline — exactly the
 * same path as OCR, CSV, and future PowerScribe imports.
 *
 * Alias learning and duplicate detection are handled by the pipeline,
 * not duplicated here.
 */

import { useState, useEffect, useCallback } from 'react';
import { theme } from '../lib/theme';
import { findMatchCandidates } from '../utils/matching';
import { checkOneDuplicate } from '../utils/duplicateDetection';
import { useProfile } from '../hooks/useProfile';
import { todayDateString } from '../utils/calculations';
import { commitPipelineResults } from '../pipeline/importPipeline';
import type { PipelineReviewRow } from '../pipeline/importPipeline';
import { normalizeRadiologyDescription } from '../utils/radiologyDescriptionNormalization';
import type { MatchCandidate } from '../types';
import { MODALITY_LABELS } from '../types';
import type { DuplicateMatch, StudyCandidate } from '../utils/duplicateDetection';
import type { ImportedStudy } from '../types/importProvider';

interface LogStudyProps {
  onSaved: () => void;
}

export function LogStudy({ onSaved }: LogStudyProps) {
  const { activeProfile } = useProfile();
  const [examInput, setExamInput] = useState('');
  const [logDate, setLogDate] = useState(todayDateString());
  const [candidates, setCandidates] = useState<MatchCandidate[]>([]);
  const [selected, setSelected] = useState<MatchCandidate | null>(null);
  const [notes, setNotes] = useState('');
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dupeWarning, setDupeWarning] = useState<DuplicateMatch | null>(null);
  const [forceSave, setForceSave] = useState(false);

  const search = useCallback(async (q: string) => {
    if (!q.trim()) { setCandidates([]); return; }
    setSearching(true);
    try {
      const results = await findMatchCandidates(q, 6, activeProfile?.id ?? null);
      setCandidates(results);
      if (results.length > 0 && results[0].confidence >= 0.9) {
        setSelected(results[0]);
      } else {
        setSelected(null);
      }
    } finally {
      setSearching(false);
    }
  }, [activeProfile?.id]);

  useEffect(() => {
    const timer = setTimeout(() => search(examInput), 300);
    return () => clearTimeout(timer);
  }, [examInput, search]);

  async function handleSave(skipDupeCheck = false) {
    if (!selected) { setError('Select a CPT code first'); return; }
    setSaving(true);
    setError(null);

    try {
      // ── Duplicate check ───────────────────────────────────────────────────
      if (!skipDupeCheck && !forceSave) {
        const candidate: StudyCandidate = {
          examNameRaw: examInput.trim(),
          cptCode: selected.cptCode,
          modifier: selected.modifier,
          logDate,
          studyDateTime: null,
          studyDate: logDate,
          accessionNumber: null,
          rowIndex: null,
          modality: selected.modality,
        };
        const dupeMatch = await checkOneDuplicate(candidate, undefined);
        if (dupeMatch && (dupeMatch.confidence === 'very_likely' || dupeMatch.confidence === 'possible')) {
          setDupeWarning(dupeMatch);
          setSaving(false);
          return;
        }
      }

      // ── Route through the shared import pipeline's commit path ───────────
      // Same commit function OCR/CSV/PowerScribe use: centralized fingerprinting,
      // alias learning, and Supabase sync — not a bespoke direct DB write.
      const study: ImportedStudy = {
        examTitle: examInput.trim(),
        canonicalExam: null,
        cpt: selected.cptCode,
        workRvu: selected.workRvu,
        studyDate: logDate,
        studyTime: null,
        modality: selected.modality,
        accessionNumber: null,
        patientMRN: null,
        source: 'manual',
        importedAt: new Date().toISOString(),
        dateTimeConfidence: 0,
        dateTimeSource: 'manual',
      };

      const row: PipelineReviewRow = {
        tempId: crypto.randomUUID(),
        source: study,
        candidates: [selected],
        selectedCandidateIndex: 0,
        selectedCandidateIndices: [0],
        displayTitle: examInput.trim(),
        needsReview: false,
        duplicateStatus: null,
        duplicateExistingLogId: null,
        duplicateReason: null,
        included: true,
        autoSkipped: false,
        autoApproved: true,
        autoApprovalLevel: null,
        approvalStatus: 'manual_approved',
        reviewReason: null,
        notes: notes.trim() || null,
      };

      await commitPipelineResults([row], logDate, 0, activeProfile?.id ?? null);

      setDupeWarning(null);
      setForceSave(false);
      setSaved(true);
      setTimeout(() => {
        setExamInput('');
        setCandidates([]);
        setSelected(null);
        setNotes('');
        setSaved(false);
        onSaved();
      }, 800);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const confidenceColor = (c: number) => {
    if (c >= 0.85) return 'text-emerald-400';
    if (c >= 0.65) return 'text-amber-400';
    return 'text-red-400';
  };

  const confidenceBg = (c: number, isSelected: boolean) => {
    if (!isSelected) return 'bg-white/3 border-white/8 hover:border-white/20';
    if (c >= 0.85) return 'bg-emerald-500/10 border-emerald-500/40';
    if (c >= 0.65) return 'bg-amber-500/10 border-amber-500/40';
    return 'bg-red-500/10 border-red-500/40';
  };

  const matchExplanationText = (candidate: MatchCandidate) => {
    const normalized = candidate.explanation?.normalizedText ?? normalizeRadiologyDescription(examInput);
    const source = candidate.explanation?.source ?? candidate.method.replace(/_/g, ' ');
    return `Raw: ${examInput} | Normalized: ${normalized} | Source: ${source} | Method: ${candidate.method} | CMS: ${candidate.description}`;
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-in fade-in duration-300">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">Log Study</h1>
        <p className="text-slate-400 text-sm mt-0.5">Enter an exam name or CPT code</p>
      </div>

      <div className="card space-y-4">
        {/* Date */}
        <div>
          <label htmlFor="log-study-date" className="block text-xs font-medium text-slate-400 uppercase tracking-wider mb-1.5">
            Date
          </label>
          <input
            id="log-study-date"
            aria-label="Date"
            type="date"
            value={logDate}
            onChange={(e) => setLogDate(e.target.value)}
            className="input w-full"
          />
        </div>

        {/* Exam input */}
        <div>
          <label htmlFor="log-study-exam" className="block text-xs font-medium text-slate-400 uppercase tracking-wider mb-1.5">
            Exam Name or CPT Code
          </label>
          <div className="relative">
            <input
              id="log-study-exam"
              aria-label="Exam Name or CPT Code"
              type="text"
              value={examInput}
              onChange={(e) => setExamInput(e.target.value)}
              placeholder="e.g. CT Abdomen Pelvis w contrast, or 74178"
              className="input w-full pr-8"
            />
            {searching && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <div className="w-4 h-4 border border-t-transparent rounded-full animate-spin" style={{ borderColor: `${theme.colors.primary} transparent transparent transparent` }} />
              </div>
            )}
          </div>
        </div>

        {/* Match candidates */}
        {candidates.length > 0 && (
          <div>
            <p className="block text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">
              Matches — select one
            </p>
            <div className="space-y-2">
              {candidates.map((c) => {
                const isSelected = selected?.cptCode === c.cptCode && selected?.modifier === c.modifier;
                return (
                  <button
                    key={`${c.cptCode}-${c.modifier ?? 'null'}`}
                    onClick={() => setSelected(c)}
                    aria-label={`${c.cptCode}${c.modifier ? `-${c.modifier}` : ''}, ${c.description}, ${c.workRvu?.toFixed(2) ?? 'N/A'} wRVU, ${Math.round(c.confidence * 100)}% confidence`}
                    className={`w-full text-left rounded-xl border p-3 transition-all duration-200 ${confidenceBg(c.confidence, isSelected)}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-sm font-bold text-white">
                            {c.cptCode}{c.modifier ? `-${c.modifier}` : ''}
                          </span>
                          <span className="text-xs px-1.5 py-0.5 rounded bg-white/10 text-slate-300">
                            {MODALITY_LABELS[c.modality]}
                          </span>
                          {isSelected && (
                            <span className="text-xs" style={{ color: theme.colors.accent }}>✓ Selected</span>
                          )}
                        </div>
                        <p className="text-slate-300 text-xs mt-0.5 line-clamp-2">{c.description}</p>
                        <p className="text-[10px] text-slate-500 mt-1 leading-snug">{matchExplanationText(c)}</p>
                        {c.confidence < 0.75 && candidates.length > 1 && (
                          <p className="text-[10px] text-amber-300/80 mt-0.5">
                            Alternatives: {candidates.filter((alt) => alt !== c).slice(0, 3).map((alt) => `${alt.cptCode}${alt.modifier ? `-${alt.modifier}` : ''} ${Math.round(alt.confidence * 100)}%`).join(' | ')}
                          </p>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-white font-bold text-sm">{c.workRvu?.toFixed(2) ?? 'N/A'}</p>
                        <p className="text-[10px] text-slate-400">wRVU</p>
                        <p className={`text-[10px] font-medium mt-0.5 ${confidenceColor(c.confidence)}`}>
                          {Math.round(c.confidence * 100)}%
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* No results */}
        {examInput.trim().length > 2 && !searching && candidates.length === 0 && (
          <div className="text-center py-4 rounded-xl bg-white/3 border border-white/8">
            <p className="text-slate-400 text-sm">No matches found</p>
            <p className="text-slate-500 text-xs mt-1">
              Try a CPT code directly, or import a CMS RVU file in Settings
            </p>
          </div>
        )}

        {/* Notes */}
        <div>
          <label htmlFor="log-study-notes" className="block text-xs font-medium text-slate-400 uppercase tracking-wider mb-1.5">
            Notes (optional)
          </label>
          <textarea
            id="log-study-notes"
            aria-label="Notes (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Accession number, patient context, etc."
            rows={2}
            className="input w-full resize-none"
          />
        </div>

        {/* Selected summary */}
        {selected && (
          <div className="p-3 rounded-xl" style={{ background: 'rgba(37,99,168,0.12)', border: '1px solid rgba(37,99,168,0.3)' }}>
            <div className="flex justify-between items-center">
              <div>
                <p className="text-xs font-medium" style={{ color: theme.colors.accent }}>Ready to log</p>
                <p className="text-white font-semibold text-sm mt-0.5">
                  {selected.cptCode} — {selected.workRvu?.toFixed(2)} wRVU
                </p>
              </div>
              {selected.confidence < 0.75 && (
                <span className="text-xs bg-amber-500/20 border border-amber-500/30 text-amber-300 px-2 py-1 rounded-lg">
                  ⚠️ Low confidence
                </span>
              )}
            </div>
          </div>
        )}

        {/* Duplicate warning banner */}
        {dupeWarning && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 space-y-2">
            <div className="flex items-start gap-2">
              <span className="text-amber-400 text-base leading-none mt-0.5">⚠</span>
              <div className="min-w-0">
                <p className="text-amber-300 text-sm font-semibold">
                  {dupeWarning.confidence === 'very_likely' ? 'Very likely duplicate' : 'Possible duplicate'}
                </p>
                <p className="text-amber-200/70 text-xs mt-0.5">{dupeWarning.reason}</p>
                <p className="text-slate-400 text-xs mt-1">
                  Existing: <span className="text-slate-300">{dupeWarning.existingLog.examNameRaw}</span>
                  {' · '}{dupeWarning.existingLog.logDate}
                  {dupeWarning.existingLog.workRvu != null && ` · ${dupeWarning.existingLog.workRvu.toFixed(2)} wRVU`}
                </p>
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => { setForceSave(true); handleSave(true); }}
                className="flex-1 py-2 rounded-lg text-xs font-semibold bg-amber-500/20 border border-amber-500/30 text-amber-300 hover:bg-amber-500/30 transition-colors"
              >
                Log anyway
              </button>
              <button
                onClick={() => setDupeWarning(null)}
                className="flex-1 py-2 rounded-lg text-xs font-semibold bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {error && (
          <p className="text-red-400 text-sm">{error}</p>
        )}

        <button
          onClick={() => handleSave(false)}
          disabled={!selected || saving || saved}
          className={`w-full py-3 rounded-xl font-semibold text-sm transition-all duration-200 ${
            saved
              ? 'bg-emerald-500/20 border border-emerald-500/30 text-emerald-400'
              : selected
              ? 'text-white hover:opacity-90 shadow-lg'
              : 'bg-white/5 text-slate-500 cursor-not-allowed'
          }`}
          style={!saved && selected ? {
            background: `linear-gradient(135deg, ${theme.colors.primary}, ${theme.colors.accent})`,
            boxShadow: `0 4px 14px rgba(37,99,168,0.35)`,
          } : {}}
        >
          {saving ? 'Saving…' : saved ? '✓ Saved!' : 'Log Study'}
        </button>
      </div>
    </div>
  );
}
