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
import { BaptistLogoMark } from '../components/BaptistLogo';
import { theme } from '../lib/theme';
import { searchExamLibrary } from '../utils/matching';
import { normalizeRadiologyDescription } from '../utils/radiologyDescriptionNormalization';
import { useProfile } from '../hooks/useProfile';
import { getDesktopAPI } from '../lib/desktop';
import { todayDateString } from '../utils/calculations';
import { getImportReviewState } from '../utils/importReviewState';
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
import {
  buildCorrectedTitleRow,
  buildSplitRows,
  createAssistantArtifacts,
  generateFeedbackSummary,
  type AssistantResponse,
} from '../services/aiReviewAssistantService';
import { processOcrImport, processStructuredPowerScribeOcrImport, processTextImport, type ProcessedImportResult } from '../services/ocrWorkflowService';
import { dedupeReasons } from '../utils/reviewReasons';
import type { PipelineReviewRow } from '../pipeline/importPipeline';
import type { CorrectionAction, FeedbackEvent, FeedbackEventCategory, DuplicateStatus, MatchCandidate, UserSettings } from '../types';

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

function OcrDebugPanel({ debug, imageFile }: { debug: ProcessedImportResult['ocrDebug']; imageFile?: File | Blob | null }) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!imageFile) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(imageFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  if (!debug) return null;
  const debugStats = [
    ['Provider', debug.ocrProvider],
    ['Raw lines', debug.rawLineCount ?? debug.ocrLines.length],
    ['Cleaned lines', debug.cleanedLineCount ?? debug.ocrLines.length],
    ['Procedure OCR lines', debug.columnLineCounts?.procedure ?? 'n/a'],
    ['Exam date OCR lines', debug.columnLineCounts?.examDate ?? 'n/a'],
    ['Modified OCR lines', debug.columnLineCounts?.modifiedDate ?? 'n/a'],
    ['Reconstructed rows', debug.reconstructedRowCount ?? debug.ocrLines.length],
    ['Parsed rows', debug.parsedRowCount ?? debug.detectedRows.length],
    ['Rejected rows', debug.rejectedRowCount ?? 0],
    ['Duplicates skipped', debug.duplicateSkippedCount ?? 0],
    ['Review rows', debug.finalReviewRowCount ?? debug.detectedRows.length],
    ['Auto-approved rows', debug.autoApprovedRowCount ?? 0],
    ['Manual-approved rows', debug.manuallyApprovedRowCount ?? 0],
    ['Possible duplicates', debug.possibleDuplicateRowCount ?? 0],
    ['Exact duplicates skipped', debug.exactDuplicateSkippedCount ?? 0],
    ['Excluded rows', debug.excludedRowCount ?? 0],
  ];

  return (
    <details className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs">
      <summary className="cursor-pointer font-semibold text-slate-300">
        OCR debug: {debug.parsedRowCount ?? debug.detectedRows.length} parsed / {debug.rawLineCount ?? debug.ocrLines.length} raw lines, {Math.round(debug.ocrConfidence * 100)}% text confidence
      </summary>
      <div className="mt-3 grid gap-3">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {debugStats.map(([label, value]) => (
            <div key={label} className="rounded-lg border border-white/8 bg-black/20 p-2">
              <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">{label}</p>
              <p className="mt-1 font-mono text-[11px] text-slate-300">{value}</p>
            </div>
          ))}
        </div>
        {debug.crop && (
          <div className="rounded-lg border border-white/8 bg-black/20 p-2">
            <p className="font-medium text-slate-300">
              Crop: {debug.crop.method} ({Math.round(debug.crop.confidence * 100)}%)
            </p>
            <p className="mt-1 font-mono text-[11px] text-slate-400">
              x {debug.crop.rect.x.toFixed(3)}, y {debug.crop.rect.y.toFixed(3)}, w {debug.crop.rect.width.toFixed(3)}, h {debug.crop.rect.height.toFixed(3)}, bottom {(debug.crop.rect.y + debug.crop.rect.height).toFixed(3)}
            </p>
          </div>
        )}
        {previewUrl && debug.crop && (
          <div className="rounded-lg border border-white/8 bg-black/20 p-2">
            <p className="font-medium text-slate-300">Crop preview</p>
            <div className="relative mt-2 overflow-hidden rounded-lg border border-white/10 bg-black/30">
              <img src={previewUrl} alt="OCR crop debug preview" className="block w-full opacity-80" />
              <div
                className="absolute border-2 border-sky-400/90 bg-sky-400/10"
                style={{
                  left: `${debug.crop.rect.x * 100}%`,
                  top: `${debug.crop.rect.y * 100}%`,
                  width: `${debug.crop.rect.width * 100}%`,
                  height: `${debug.crop.rect.height * 100}%`,
                }}
              />
              {debug.columnCrops?.map((column) => (
                <div
                  key={column.name}
                  className={`absolute border ${column.name === 'procedure' ? 'border-emerald-300/90 bg-emerald-300/10' : column.name === 'examDate' ? 'border-amber-300/90 bg-amber-300/10' : 'border-fuchsia-300/90 bg-fuchsia-300/10'}`}
                  title={column.name}
                  style={{
                    left: `${column.rect.x * 100}%`,
                    top: `${column.rect.y * 100}%`,
                    width: `${column.rect.width * 100}%`,
                    height: `${column.rect.height * 100}%`,
                  }}
                />
              ))}
            </div>
          </div>
        )}
        <div className="rounded-lg border border-white/8 bg-black/20 p-2">
          <p className="font-medium text-slate-300">Detected rows</p>
          <div className="mt-2 max-h-36 overflow-y-auto space-y-1">
            {debug.detectedRows.length === 0 ? (
              <p className="text-slate-500">No exam rows were detected from the OCR text.</p>
            ) : (
              debug.detectedRows.map((row, index) => (
                <p key={`${row.rawText}-${index}`} className="font-mono text-[11px] text-slate-400">
                  {index + 1}. {row.cleanedExamName ?? row.examName}
                  {row.rawProcedureColumnText ? ` | proc "${row.rawProcedureColumnText}"` : ''}
                  {row.rawExamDateColumnText ? ` | exam raw "${row.rawExamDateColumnText}"` : ''}
                  {row.rawModifiedDateColumnText ? ` | read raw "${row.rawModifiedDateColumnText}"` : ''}
                  {` | exam ${row.examDateTime ?? row.examDate ?? row.studyDate ?? 'none'}`}
                  {` | read ${row.modifiedDateTime ?? row.modifiedDate ?? 'none'}`}
                  {` | acc ${row.accessionNumber ?? 'none'}`}
                  {` | log ${row.modifiedDateTime ?? row.studyDateTime ?? 'none'}`}
                  {` | parser ${Math.round((row.extractionConfidence ?? 0) * 100)}%`}
                  {row.matchResult?.topCandidate ? ` | match ${row.matchResult.topCandidate}` : ' | no match'}
                  {row.matchResult?.confidence != null ? ` ${Math.round(row.matchResult.confidence * 100)}%` : ''}
                  {row.matchResult?.duplicateKey ? ` | dupe ${row.matchResult.duplicateKey}` : ''}
                  {row.reviewReason ?? row.matchResult?.reviewReason ? ` | review: ${row.reviewReason ?? row.matchResult?.reviewReason}` : ''}
                </p>
              ))
            )}
          </div>
        </div>
        {debug.rejectedRows && debug.rejectedRows.length > 0 && (
          <div className="rounded-lg border border-white/8 bg-black/20 p-2">
            <p className="font-medium text-slate-300">Rejected rows</p>
            <div className="mt-2 max-h-32 overflow-y-auto space-y-1">
              {debug.rejectedRows.map((row, index) => (
                <p key={`${row.reason}-${row.rawText}-${index}`} className="font-mono text-[11px] text-slate-400">
                  {index + 1}. {row.reason}: {row.rawText}
                </p>
              ))}
            </div>
          </div>
        )}
        <div className="rounded-lg border border-white/8 bg-black/20 p-2">
          <p className="font-medium text-slate-300">OCR text</p>
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-slate-400">
            {debug.ocrText}
          </pre>
        </div>
        {debug.columnText && (
          <div className="grid gap-2 md:grid-cols-3">
            {(['procedure', 'examDate', 'modifiedDate'] as const).map((column) => (
              <div key={column} className="rounded-lg border border-white/8 bg-black/20 p-2">
                <p className="font-medium text-slate-300">{column}</p>
                <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-slate-400">
                  {debug.columnText?.[column]}
                </pre>
              </div>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}

function candidateKey(candidate: MatchCandidate): string {
  return `${candidate.cptCode}-${candidate.modifier ?? ''}`;
}
function procedureNameForSource(source: { procedureName?: string | null; cleanedExamName?: string | null; cleanedText?: string | null; examTitle: string }): string {
  return (source.procedureName ?? source.cleanedExamName ?? source.cleanedText ?? source.examTitle).trim();
}

export function shouldShowAccession(accessionNumber?: string | null): boolean {
  return Boolean(accessionNumber?.trim());
}

function formatOcrTime(time: string): string {
  const match = time.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return time;
  const hour24 = Number(match[1]);
  const minute = match[2];
  const period = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${minute} ${period}`;
}

export function formatOcrDateTime(date?: string | null, time?: string | null, fallbackDateTime?: string | null): string | null {
  const fallbackTime = fallbackDateTime?.match(/T(\d{2}:\d{2})(?::\d{2})?/)?.[1] ?? null;
  const displayTime = time ?? fallbackTime;
  if (date) {
    const [year, month, day] = date.split('-');
    if (year && month && day) {
      const shortYear = year.slice(-2);
      return `${Number(month)}/${Number(day)}/${shortYear}${displayTime ? ` ${formatOcrTime(displayTime)}` : ''}`;
    }
  }
  if (!fallbackDateTime) return null;
  const parsed = new Date(fallbackDateTime);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleString('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function structuredSourceValue(source: PipelineReviewRow['source'], keys: string[]): string | null {
  const raw = source as unknown as Record<string, unknown>;
  for (const key of keys) {
    const value = raw[key];
    if (Array.isArray(value) && value.length > 0) return value.join(', ');
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function StructuredDetails({
  row,
  selected,
  reviewReason,
}: {
  row: PipelineReviewRow;
  selected: MatchCandidate[];
  reviewReason: string | null;
}) {
  const procedureName = procedureNameForSource(row.source);
  const topCandidate = selected[0] ?? row.candidates[0];
  const normalized = topCandidate?.explanation?.normalizedText ?? normalizeRadiologyDescription(procedureName);
  const rawOcr = row.source.parserRawLine ?? row.source.examTitle;
  const dedupedReviewReason = dedupeReasons(row.reviewReason, row.source.parserReviewReason, reviewReason);
  const detailRows: Array<[string, string]> = [
    ['Modality', row.source.modality ?? topCandidate?.modality ?? ''],
    ['Anatomy/body regions', structuredSourceValue(row.source, ['bodyRegions', 'bodyRegion', 'anatomy']) ?? ''],
    ['Contrast', structuredSourceValue(row.source, ['contrast', 'contrastStatus']) ?? ''],
    ['CPT(s)', selected.length > 0 ? selected.map((candidate) => candidate.cptCode).join(' + ') : ''],
    ['Exam date', row.source.examDate ?? row.source.studyDate ?? ''],
    ['Exam time', row.source.examTime ?? ''],
    ['Modified date', row.source.modifiedDate ?? row.source.modifiedDateTime?.slice(0, 10) ?? ''],
    ['Modified time', row.source.modifiedTime ?? row.source.modifiedDateTime?.slice(11, 16) ?? ''],
    ['Accession', shouldShowAccession(row.source.accessionNumber) ? (row.source.accessionNumber as string) : ''],
    ['Source row', row.source.rowIndex ?? ''],
    ['Review reasons', dedupedReviewReason ?? ''],
  ].filter(([, value]) => value.trim().length > 0);

  return (
    <div className="mb-2 rounded-xl border border-white/10 bg-white/[0.025] px-3 py-2 text-xs">
      <div className="grid gap-3">
        {detailRows.length > 0 && (
          <div className="grid gap-2 md:grid-cols-3">
            {detailRows.map(([label, value]) => (
              <div key={label} className="rounded-lg border border-white/8 bg-black/15 px-2.5 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
                <p className="mt-1 break-words font-mono text-[11px] leading-snug text-slate-300">{value}</p>
              </div>
            ))}
          </div>
        )}
        <div className="grid gap-2 lg:grid-cols-2">
          <div className="rounded-lg border border-white/8 bg-black/15 p-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Raw OCR text</p>
            <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-slate-400">{rawOcr}</pre>
          </div>
          <div className="rounded-lg border border-white/8 bg-black/15 p-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Normalized text</p>
            <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-slate-400">{normalized}</pre>
          </div>
        </div>
      </div>
    </div>
  );
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
  const text = `${procedureNameForSource(row.source)} ${row.candidates.map((c) => c.description).join(' ')}`.toLowerCase();
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

export function hasValidSelectedProductivityRvu(row: PipelineReviewRow): boolean {
  return row.included && getSelectedCandidates(row).some(isProductivityCandidate);
}

export function canApproveReviewRow(row: PipelineReviewRow): boolean {
  return hasValidSelectedProductivityRvu(row) && row.duplicateStatus !== 'exact';
}

export function isRowFinalizableAfterApproval(row: PipelineReviewRow): boolean {
  if (!hasValidSelectedProductivityRvu(row)) return false;
  if (row.autoSkipped || row.approvalStatus === 'excluded' || row.approvalStatus === 'exact_duplicate_skipped') return false;
  return !row.needsReview ||
    row.approvalStatus === 'auto_approved' ||
    row.approvalStatus === 'manual_approved' ||
    row.approvalStatus === 'approved_as_new';
}

export function approvalButtonLabel(row: PipelineReviewRow): string {
  if (!hasValidSelectedProductivityRvu(row)) return 'Add CPT';
  if (row.duplicateStatus === 'possible') return 'Approve as new';
  return 'Approve';
}

export function reviewRowStatusLabel(row: PipelineReviewRow): string {
  if (!row.included) return row.duplicateStatus === 'exact' ? 'Exact duplicate skipped' : 'Excluded';
  if (!hasValidSelectedProductivityRvu(row)) return 'Missing CPT/RVU';
  if (!row.needsReview) {
    if (row.approvalStatus === 'approved_as_new') return 'Approved as new';
    if (row.approvalStatus === 'manual_approved') return 'Manually approved';
    return row.autoApproved ? 'Auto-approved' : 'Approved';
  }
  if (row.duplicateStatus === 'possible') return 'Possible duplicate pending approval';
  return 'Pending approval';
}

/**
 * Collapses the previous badge zoo (pending/inferred/OCR%/confidence/multi-CPT/
 * missing-CPT) into the single status a reviewer actually needs to act on.
 */
export function computeCardStatus(row: PipelineReviewRow): { label: string; tone: 'green' | 'amber' | 'gray' } {
  if (!row.included) return { label: 'Excluded', tone: 'gray' };
  if (row.duplicateStatus === 'possible') return { label: 'Possible duplicate', tone: 'amber' };
  const reason = dedupeReasons(row.reviewReason, manualReviewReason(row));
  if (reason && /exam date|modified date/i.test(reason)) return { label: 'Check dates', tone: 'amber' };
  if (!hasValidSelectedProductivityRvu(row) || reason) return { label: 'Check CPT', tone: 'amber' };
  return { label: 'Ready to approve', tone: 'green' };
}

/** A row that needs a click but has no substantive date/CPT/duplicate problem. */
export function isBenignFlagRow(row: PipelineReviewRow): boolean {
  return row.included && row.needsReview && computeCardStatus(row).label === 'Ready to approve';
}

export function buildUserApprovalPatch(row: PipelineReviewRow): Partial<PipelineReviewRow> | null {
  if (!canApproveReviewRow(row)) return null;
  const selectedIndices = getSelectedCandidateIndices(row);
  if (selectedIndices.length === 0) return null;
  const priorDuplicateReason = row.duplicateReason;
  return {
    needsReview: false,
    included: true,
    duplicateStatus: row.duplicateStatus === 'possible' ? null : row.duplicateStatus,
    duplicateReason: row.duplicateStatus === 'possible' ? null : row.duplicateReason,
    duplicateExistingLogId: row.duplicateStatus === 'possible' ? null : row.duplicateExistingLogId,
    approvalStatus: row.duplicateStatus === 'possible' ? 'approved_as_new' : 'manual_approved',
    reviewReason: row.duplicateStatus === 'possible'
      ? `Approved as new despite possible duplicate warning${priorDuplicateReason ? `: ${priorDuplicateReason}` : ''}`
      : row.reviewReason,
  };
}

export function summarizeReviewApproval(rows: PipelineReviewRow[], skippedRows: PipelineReviewRow[]) {
  const included = rows.filter((row) => row.included);
  const approvedRows = included.filter(isRowFinalizableAfterApproval);
  const pendingRows = included.filter((row) => !isRowFinalizableAfterApproval(row) && hasValidSelectedProductivityRvu(row));
  const possibleDuplicateRows = pendingRows.filter((row) => row.duplicateStatus === 'possible');
  const noValidCptRows = included.filter((row) => !hasValidSelectedProductivityRvu(row));
  const excludedRows = rows.filter((row) => !row.included);
  const exactSkippedRows = skippedRows.filter((row) => row.duplicateStatus === 'exact' || row.autoSkipped);

  return {
    approvedRows: approvedRows.length,
    approvedWrvu: approvedRows.reduce((sum, row) => sum + getSelectedWorkRvu(row), 0),
    pendingRows: pendingRows.length,
    pendingWrvu: pendingRows.reduce((sum, row) => sum + getSelectedWorkRvu(row), 0),
    possibleDuplicateRows: possibleDuplicateRows.length,
    possibleDuplicateWrvu: possibleDuplicateRows.reduce((sum, row) => sum + getSelectedWorkRvu(row), 0),
    exactDuplicateRows: exactSkippedRows.length,
    exactDuplicateWrvu: exactSkippedRows.reduce((sum, row) => sum + getSelectedWorkRvu(row), 0),
    excludedRows: excludedRows.length,
    excludedWrvu: excludedRows.reduce((sum, row) => sum + getSelectedWorkRvu(row), 0),
    noValidCptRows: noValidCptRows.length,
    finalizableRows: approvedRows.length,
    finalizableWrvu: approvedRows.reduce((sum, row) => sum + getSelectedWorkRvu(row), 0),
  };
}

function dateAttributionWarning(row: PipelineReviewRow): string | null {
  if (row.source.modifiedDate || row.source.modifiedDateTime) return null;
  if (row.source.examDate || row.source.examDateTime) {
    return 'Missing Modified time/date - productivity date will use selected log date unless corrected.';
  }
  return 'Missing Exam and Modified dates - productivity date will use selected log date after approval.';
}

function buildManualSelectionPatch(
  row: PipelineReviewRow,
  candidatesToSelect: MatchCandidate[],
  forceReviewed = false,
): Pick<PipelineReviewRow, 'candidates' | 'selectedCandidateIndex' | 'selectedCandidateIndices' | 'needsReview' | 'approvalStatus'> {
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
    approvalStatus: forceReviewed ? 'manual_approved' : 'pending',
  };
}

function buildApprovalPatch(row: PipelineReviewRow): Pick<PipelineReviewRow, 'selectedCandidateIndex' | 'selectedCandidateIndices' | 'needsReview' | 'approvalStatus'> | null {
  const candidate = safeAutoApprovalCandidate(row);
  if (!candidate) return null;
  const index = row.candidates.findIndex((existing) => candidateKey(existing) === candidateKey(candidate));
  if (index < 0) return null;
  return { selectedCandidateIndex: index, selectedCandidateIndices: [index], needsReview: false, approvalStatus: 'manual_approved' };
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
  onOpenQuickLog?: () => void;
}

type Step = 'input' | 'review' | 'done';
type ReviewMode = 'unknowns' | 'everything' | 'auto' | 'low';
type ImportToastTone = 'info' | 'success' | 'warning' | 'danger';

type AssistantQuickOption = { label: string; category: FeedbackEventCategory; prompt: string };

export const CAPTURE_PROCESSING_LABEL = 'Processing...';
export const CAPTURE_PROMPT_TITLE = 'PowerScribe capture detected';
export const CAPTURE_PRIVACY_COPY = 'The screenshot is processed in memory and discarded after parsing. Only extracted productivity data is stored.';

export function shouldAutoProcessPowerScribeCaptures(settings: Pick<UserSettings, 'alwaysProcessPowerScribeClipboard'> | null | undefined): boolean {
  return Boolean(settings?.alwaysProcessPowerScribeClipboard);
}

interface AssistantPanelState {
  rowId: string;
  response: AssistantResponse;
  feedbackEvent: FeedbackEvent;
  actions: CorrectionAction[];
}

interface ImportToast {
  id: string;
  tone: ImportToastTone;
  title: string;
  body?: string;
}

function ImportToastStack({ toasts }: { toasts: ImportToast[] }) {
  if (toasts.length === 0) return null;
  const toneClass: Record<ImportToastTone, string> = {
    info: 'border-sky-500/25 bg-sky-500/10 text-sky-200',
    success: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200',
    warning: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
    danger: 'border-red-500/30 bg-red-500/10 text-red-200',
  };

  return (
    <div className="fixed bottom-5 right-5 z-50 flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`rounded-2xl border px-4 py-3 shadow-2xl backdrop-blur-xl animate-in fade-in slide-in-from-bottom-2 duration-200 ${toneClass[toast.tone]}`}
        >
          <p className="text-sm font-semibold">{toast.title}</p>
          {toast.body && <p className="mt-1 text-xs leading-relaxed opacity-80">{toast.body}</p>}
        </div>
      ))}
    </div>
  );
}

function CaptureProcessingState() {
  return (
    <div className="rounded-xl border border-sky-500/25 bg-sky-500/8 px-4 py-5 text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-sky-500/25 bg-slate-950/40">
        <div className="animate-pulse">
          <BaptistLogoMark size={42} />
        </div>
      </div>
      <p className="mt-3 text-sm font-semibold text-white">{CAPTURE_PROCESSING_LABEL}</p>
      <p className="mt-1 text-xs text-slate-400">Preparing extracted studies for review.</p>
    </div>
  );
}

function formatLogDateLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const formatted = new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  return dateStr === todayDateString() ? `today, ${formatted}` : formatted;
}

function LogDateLine({
  logDate,
  editing,
  onEdit,
  onChange,
}: {
  logDate: string;
  editing: boolean;
  onEdit: () => void;
  onChange: (value: string) => void;
}) {
  if (editing) {
    return (
      <input
        type="date"
        value={logDate}
        autoFocus
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => onChange(logDate)}
        className="input text-xs w-auto"
      />
    );
  }
  return (
    <p className="text-xs text-slate-500">
      Logging to {formatLogDateLabel(logDate)} ·{' '}
      <button onClick={onEdit} className="underline hover:text-slate-300">Change</button>
    </p>
  );
}

const ASSISTANT_QUICK_OPTIONS: AssistantQuickOption[] = [
  { label: 'Wrong CPT', category: 'wrong_cpt', prompt: 'The selected CPT is wrong.' },
  { label: 'Not a duplicate', category: 'wrong_duplicate', prompt: 'This is not a duplicate.' },
  { label: 'Should be duplicate', category: 'wrong_duplicate', prompt: 'This should be marked as a duplicate.' },
  { label: 'Missing time', category: 'missing_datetime', prompt: 'The exam or read time is missing or wrong.' },
  { label: 'Bad OCR text', category: 'bad_ocr', prompt: 'The OCR text is wrong.' },
  { label: 'Bad cleanup', category: 'bad_exam_cleanup', prompt: 'The normalized exam name is wrong.' },
  { label: 'Two exams merged', category: 'merged_ocr_rows', prompt: 'This is two exams recognized as one. The second modality starts a new row.' },
  { label: 'Should auto-approve', category: 'should_auto_approve', prompt: 'This should auto-approve.' },
  { label: 'Should require review', category: 'bad_auto_approval', prompt: 'This should require review.' },
  { label: 'Add mapping', category: 'institution_mapping_needed', prompt: 'This should have matched the institution dictionary.' },
];

export function Import({ onImported, onOpenQuickLog }: ImportProps) {
  const { activeProfile, activePractice } = useProfile();
  const [step, setStep]           = useState<Step>('input');
  const [pasteText, setPasteText] = useState('');
  const [ocrFile, setOcrFile]     = useState<File | null>(null);
  const [processing, setProcessing] = useState(false);
  const [reviewRows, setReviewRows]   = useState<PipelineReviewRow[]>([]);
  const [skippedRows, setSkippedRows] = useState<PipelineReviewRow[]>([]);
  const [logDate, setLogDate]     = useState(todayDateString());
  const [importing, setImporting] = useState(false);
  const [importedCount, setImportedCount]   = useState(0);
  const [importedWrvu, setImportedWrvu]     = useState(0);
  const [skippedCount, setSkippedCount]     = useState(0);
  const [reviewNeeded, setReviewNeeded]     = useState(0);
  const [alreadySavedCount, setAlreadySavedCount] = useState(0);
  const [blockedNoValidCptCount, setBlockedNoValidCptCount] = useState(0);
  const [error, setError]         = useState<string | null>(null);
  const [showSkipped, setShowSkipped]       = useState(false);
  const [showAutoApproved, setShowAutoApproved] = useState(false);
  const [logDateEditing, setLogDateEditing] = useState(false);
  const [moreActionsOpen, setMoreActionsOpen] = useState(false);
  const [hasSeenCaptureTip, setHasSeenCaptureTip] = useState(
    () => typeof localStorage !== 'undefined' && localStorage.getItem('wrvu-capture-tip-seen') === '1',
  );
  const [hasSeenAutosaveNotice, setHasSeenAutosaveNotice] = useState(
    () => typeof localStorage !== 'undefined' && localStorage.getItem('wrvu-autosave-notice-seen') === '1',
  );
  const [searchPanelTempId, setSearchPanelTempId] = useState<string | null>(null);
  const [reviewMode, setReviewMode] = useState<ReviewMode>('unknowns');
  const [clipboardFile, setClipboardFile] = useState<File | null>(null);
  const [ocrDebug, setOcrDebug] = useState<ProcessedImportResult['ocrDebug']>(null);
  const [lastExtractedCount, setLastExtractedCount] = useState(0);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [toasts, setToasts] = useState<ImportToast[]>([]);
  const [assistantTempId, setAssistantTempId] = useState<string | null>(null);
  const [assistantPrompt, setAssistantPrompt] = useState('');
  const [assistantPanel, setAssistantPanel] = useState<AssistantPanelState | null>(null);
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [feedbackQueueOpen, setFeedbackQueueOpen] = useState(false);
  const [feedbackEvents, setFeedbackEvents] = useState<FeedbackEvent[]>([]);
  const [feedbackSummary, setFeedbackSummary] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const processingRef = useRef(false);
  const lastClipboardImageHashRef = useRef<string | null>(null);

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
    if (!feedbackQueueOpen) return;
    db.feedbackEvents
      .orderBy('createdAt')
      .reverse()
      .limit(100)
      .toArray()
      .then((events) => {
        setFeedbackEvents(events);
        setFeedbackSummary(null);
      });
  }, [feedbackQueueOpen]);

  useEffect(() => {
    processingRef.current = processing;
  }, [processing]);

  useEffect(() => {
    if (step !== 'input') return;
    function handlePaste(event: ClipboardEvent) {
      // Let form fields (e.g. the log-date input) handle their own paste.
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;

      const imageItem = Array.from(event.clipboardData?.items ?? []).find((item) => item.type.startsWith('image/'));
      if (imageItem) {
        const blob = imageItem.getAsFile();
        if (!blob) return;
        const file = new File([blob], `powerscribe-clipboard-${Date.now()}.png`, { type: blob.type || 'image/png' });
        event.preventDefault();
        void queueClipboardImage(file, 'clipboard paste');
        return;
      }

      const text = event.clipboardData?.getData('text/plain')?.trim();
      if (text) {
        event.preventDefault();
        void handlePasteProcess(text);
      }
    }
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [step, activeProfile?.id, activePractice?.id, sessionId, logDate, reviewRows, skippedRows]);

  useEffect(() => {
    if (step !== 'input') return;
    if (!navigator.clipboard?.read) return;

    let cancelled = false;
    let busy = false;

    async function pollClipboard() {
      if (cancelled || busy || processingRef.current || !document.hasFocus()) return;
      busy = true;
      try {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          const imageType = item.types.find((type) => type.startsWith('image/'));
          if (!imageType) continue;
          const blob = await item.getType(imageType);
          const file = new File([blob], `powerscribe-clipboard-${Date.now()}.png`, { type: imageType });
          await queueClipboardImage(file, 'clipboard monitor');
          break;
        }
      } catch {
        // Browser/OS may deny polling; manual Paste remains available.
      } finally {
        busy = false;
      }
    }

    void pollClipboard();
    const id = window.setInterval(() => void pollClipboard(), 1500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [step, activeProfile?.id, activePractice?.id, sessionId, logDate, reviewRows, skippedRows]);

  // ── Process helpers ───────────────────────────────────────────────────────

  function addTimeline(label: string) {
    setTimeline((events) => [
      ...events,
      createTimelineEvent(label),
    ]);
  }

  function pushToast(tone: ImportToastTone, title: string, body?: string) {
    const id = crypto.randomUUID();
    setToasts((items) => [...items, { id, tone, title, body }].slice(-4));
    window.setTimeout(() => {
      setToasts((items) => items.filter((item) => item.id !== id));
    }, tone === 'danger' ? 7000 : 4800);
  }

  function appendPipelineRows(nextRows: PipelineReviewRow[], nextSkippedRows: PipelineReviewRow[], label: string, extractedCount?: number) {
    if (extractedCount != null) setLastExtractedCount(extractedCount);
    const merged = mergeReviewSessionRows(reviewRows, skippedRows, nextRows, nextSkippedRows);
    setReviewRows(merged.reviewRows);
    setSkippedRows(merged.skippedRows);
    addTimeline(label);
    setStep('review');
    if (nextRows.length > 0 || nextSkippedRows.length > 0) {
      localStorage.setItem('wrvu-capture-tip-seen', '1');
      setHasSeenCaptureTip(true);
    }
    const readyCount = nextRows.length;
    const estimatedRvu = nextRows.reduce((sum, row) => sum + getSelectedWorkRvu(row), 0);
    const reviewCount = nextRows.filter((row) => row.needsReview).length;
    pushToast(
      reviewCount > 0 ? 'warning' : 'success',
      readyCount === 0 && nextSkippedRows.length === 0
        ? 'No studies found'
        : `Ready to review ${readyCount} exam${readyCount === 1 ? '' : 's'}`,
      `+${estimatedRvu.toFixed(1)} wRVUs pending - ${nextSkippedRows.length} duplicate${nextSkippedRows.length === 1 ? '' : 's'} skipped - ${reviewCount} require review`,
    );
  }

  async function hashImageBlob(blob: Blob): Promise<string> {
    const buffer = await blob.arrayBuffer();
    if (!crypto.subtle) return `${blob.size}:${blob.type}:${buffer.byteLength}`;
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }

  async function processOcrFile(file: File, timelineSource: string) {
    setProcessing(true);
    setError(null);
    setOcrFile(file);
    pushToast('info', 'Processing capture...', 'Reading the screenshot and preparing extracted study rows.');
    try {
      const processed = await processOcrImport(file, {
        profileId: activeProfile?.id ?? null,
        siteId: activePractice?.id ?? null,
        sessionId,
        logDate,
      }, { filename: file.name, size: file.size });
      pushToast('info', 'Matching CPT codes...', 'Running aliases, active CPT filters, and review checks.');
      setOcrDebug(processed.ocrDebug ?? null);
      appendPipelineRows(processed.result.reviewRows, processed.result.skippedRows, `${processed.timelineLabel} from ${timelineSource}`, processed.extractedCount);
      setClipboardFile(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'OCR failed - try paste mode instead');
      pushToast('danger', 'OCR failed', e instanceof Error ? e.message : 'Try paste mode instead.');
    } finally {
      setProcessing(false);
    }
  }

  async function processWindowsClipboardCapture(file: File, timelineSource: string): Promise<boolean> {
    const desktop = getDesktopAPI();
    if (desktop?.platform !== 'win32' || !desktop.extractPowerScribeClipboardRows) return false;

    try {
      pushToast('info', 'Reading PowerScribe...', 'Using the Windows structured OCR helper.');
      const helperResult = await desktop.extractPowerScribeClipboardRows();
      if (helperResult.rows.length === 0) return false;
      pushToast('info', 'Matching CPT codes...', 'Using structured procedure names only.');
      const processed = await processStructuredPowerScribeOcrImport(helperResult.rows, {
        profileId: activeProfile?.id ?? null,
        siteId: activePractice?.id ?? null,
        sessionId,
        logDate,
      }, helperResult.accounting);
      setOcrFile(file);
      setOcrDebug(processed.ocrDebug ?? null);
      addTimeline(`Windows structured OCR extracted ${processed.extractedCount} rows`);
      appendPipelineRows(processed.result.reviewRows, processed.result.skippedRows, `${processed.timelineLabel} from ${timelineSource}`, processed.extractedCount);
      setClipboardFile(null);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      addTimeline(`Windows structured OCR failed: ${message}`);
      pushToast('warning', 'Windows OCR helper failed', `${message} — falling back to browser OCR.`);
      return false;
    }
  }

  async function processPowerScribeCapture(file: File, timelineSource: string) {
    if (processingRef.current) return;
    setProcessing(true);
    setError(null);
    setOcrFile(file);
    setClipboardFile(null);
    pushToast('info', 'Processing PowerScribe capture...', 'Extracting studies and preparing the review list.');
    try {
      const desktop = getDesktopAPI();
      const attemptedStructuredHelper = desktop?.platform === 'win32' && Boolean(desktop.extractPowerScribeClipboardRows);
      const usedStructuredHelper = await processWindowsClipboardCapture(file, timelineSource);
      if (!usedStructuredHelper) {
        if (attemptedStructuredHelper) {
          addTimeline('Using browser OCR fallback');
          pushToast('info', 'Browser OCR fallback', 'Reading the screenshot with the in-app OCR engine instead.');
        }
        await processOcrFile(file, timelineSource);
      }
    } finally {
      setProcessing(false);
    }
  }

  async function queueClipboardImage(file: File, timelineSource: string) {
    const hash = await hashImageBlob(file);
    if (hash === lastClipboardImageHashRef.current) return;
    lastClipboardImageHashRef.current = hash;
    pushToast('info', 'Screenshot captured', `PowerScribe image received from ${timelineSource}.`);
    const settings = await ensureUserSettings();
    if (shouldAutoProcessPowerScribeCaptures(settings)) {
      await processPowerScribeCapture(file, timelineSource);
      return;
    }
    setClipboardFile(file);
  }

  async function handlePasteProcess(textOverride?: string) {
    const text = (textOverride ?? pasteText).trim();
    if (!text) return;
    setProcessing(true);
    setError(null);
    pushToast('info', 'Matching CPT codes...', 'Parsing pasted studies and preparing the review queue.');
    try {
      const processed = await processTextImport(text, {
        profileId: activeProfile?.id ?? null,
        siteId: activePractice?.id ?? null,
        sessionId,
        logDate,
      });
      appendPipelineRows(processed.result.reviewRows, processed.result.skippedRows, processed.timelineLabel, processed.extractedCount);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Processing failed');
      pushToast('danger', 'Processing failed', e instanceof Error ? e.message : 'Could not parse the pasted study list.');
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
    pushToast('success', 'PowerScribe captures will be processed automatically.');
    await processPowerScribeCapture(file, 'trusted clipboard');
  }

  // Restore a skipped row back into the review list
  function forceIncludeSkipped(tempId: string) {
    const skipped = skippedRows.find((s) => s.tempId === tempId);
    if (!skipped) return;
    setSkippedRows((s) => s.filter((x) => x.tempId !== tempId));
    setReviewRows((rows) => [
      ...rows,
      {
        ...skipped,
        duplicateStatus: null as DuplicateStatus,
        duplicateReason: skipped.duplicateReason ? `Imported anyway despite duplicate warning: ${skipped.duplicateReason}` : null,
        needsReview: false,
        included: true,
        autoSkipped: false,
        approvalStatus: 'approved_as_new',
      },
    ]);
  }

  async function handleCommit() {
    setImporting(true);
    setError(null);
    try {
      const selectedRvu = reviewRows
        .filter(isRowFinalizableAfterApproval)
        .reduce((sum, row) => sum + getSelectedWorkRvu(row), 0);
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
      setImportedWrvu(selectedRvu);
      setSkippedCount(result.skippedCount);
      setReviewNeeded(result.reviewNeededCount);
      setAlreadySavedCount(result.alreadySavedCount);
      setBlockedNoValidCptCount(result.blockedNoValidCptCount);
      setStep('done');
      pushToast(
        result.reviewNeededCount > 0 ? 'warning' : 'success',
        `Imported ${result.importedCount} exam${result.importedCount === 1 ? '' : 's'}`,
        `+${selectedRvu.toFixed(1)} wRVUs - ${result.skippedCount} duplicate${result.skippedCount === 1 ? '' : 's'} skipped - ${result.reviewNeededCount} require review` +
          (result.alreadySavedCount > 0 ? ` - ${result.alreadySavedCount} already saved` : '') +
          (result.blockedNoValidCptCount > 0 ? ` - ${result.blockedNoValidCptCount} blocked (no valid CPT)` : ''),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed');
      pushToast('danger', 'Import failed', e instanceof Error ? e.message : 'The review session was not saved.');
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

  function approveReviewRow(tempId: string) {
    const row = reviewRows.find((item) => item.tempId === tempId);
    if (!row) return;
    const patch = buildUserApprovalPatch(row);
    if (!patch) {
      setSearchPanelTempId(tempId);
      return;
    }
    updateRow(tempId, patch);
    pushToast('success', row.duplicateStatus === 'possible' ? 'Approved as new' : 'Study approved', `${getSelectedWorkRvu(row).toFixed(1)} wRVUs added to finalizable total.`);
  }

  function approveAllReviewable(includeWarnings: boolean) {
    let approved = 0;
    let approvedWrvu = 0;
    setReviewRows((rows) =>
      rows.map((row) => {
        if (!row.needsReview) return row;
        if (!includeWarnings && row.duplicateStatus === 'possible') return row;
        const patch = buildUserApprovalPatch(row);
        if (!patch) return row;
        approved++;
        approvedWrvu += getSelectedWorkRvu(row);
        return { ...row, ...patch };
      }),
    );
    if (approved > 0) {
      pushToast('success', `Approved ${approved} reviewable stud${approved === 1 ? 'y' : 'ies'}`, `+${approvedWrvu.toFixed(1)} wRVUs now finalizable.`);
    }
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
    rowsToUpdate.forEach((reviewRow) => rowsByRawTitle.set(procedureNameForSource(reviewRow.source), reviewRow));

    for (const aliasRow of rowsByRawTitle.values()) {
      const patch = patchesByTempId.get(aliasRow.tempId);
      const selectedForAlias = patch ? getCandidatesFromPatch(patch) : [];
      if (!selectedForAlias.length) continue;

      await rememberCorrectedExam({
        rawText: procedureNameForSource(aliasRow.source),
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

  async function askAssistant(
    row: PipelineReviewRow,
    rowIndex: number,
    requestText: string,
    categoryHint?: FeedbackEventCategory,
  ) {
    const trimmed = requestText.trim();
    if (!trimmed) return;
    setAssistantBusy(true);
    setError(null);
    try {
      const artifacts = createAssistantArtifacts({
        requestText: trimmed,
        categoryHint,
        profileId: activeProfile?.id ?? null,
        siteId: activePractice?.id ?? null,
        sessionId,
        logDate,
        row,
        rowIndex,
        rows: reviewRows,
      });
      await db.feedbackEvents.add(artifacts.feedbackEvent);
      if (feedbackQueueOpen) {
        setFeedbackEvents((events) => [artifacts.feedbackEvent, ...events]);
      }
      if (artifacts.correctionActions.length > 0) {
        await db.correctionActions.bulkAdd(artifacts.correctionActions);
      }
      setAssistantPanel({
        rowId: row.tempId,
        response: artifacts.response,
        feedbackEvent: artifacts.feedbackEvent,
        actions: artifacts.correctionActions,
      });
      setAssistantTempId(row.tempId);
      pushToast('info', 'Assistant reviewed row', artifacts.response.explanation);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Assistant failed');
      pushToast('danger', 'Assistant failed', e instanceof Error ? e.message : 'Could not create feedback.');
    } finally {
      setAssistantBusy(false);
    }
  }

  async function applyAssistantAction(action: CorrectionAction) {
    const row = reviewRows.find((item) => item.tempId === action.targetRowId);
    if (!row) return;

    setAssistantBusy(true);
    try {
      if (action.actionType === 'correct_exam_title') {
        const proposed = action.proposedRowJson ? JSON.parse(action.proposedRowJson) as { procedureName?: string } : {};
        if (!proposed.procedureName) throw new Error('No corrected title was proposed.');
        const corrected = await buildCorrectedTitleRow(row, proposed.procedureName, activeProfile?.id ?? null);
        setReviewRows((rows) => rows.map((item) => item.tempId === row.tempId ? corrected : item));
      } else if (action.actionType === 'correct_cpt') {
        const proposed = action.proposedRowJson ? JSON.parse(action.proposedRowJson) as { cptCodes?: string[] } : {};
        const codes = proposed.cptCodes ?? [];
        const candidates: MatchCandidate[] = [];
        for (const code of codes) {
          const results = await searchExamLibrary(code, 4);
          const valid = results.find((candidate) => candidate.cptCode === code && candidate.modifier === '26' && (candidate.workRvu ?? 0) > 0);
          if (valid) candidates.push(valid);
        }
        if (candidates.length === 0) throw new Error('No modifier 26 RVU row was found for the requested CPT.');
        const patch = buildManualSelectionPatch(row, candidates, true);
        updateRow(row.tempId, {
          ...patch,
          needsReview: false,
          reviewReason: 'Corrected by AI Assistant / user approved',
          duplicateStatus: null,
          duplicateReason: null,
          duplicateExistingLogId: null,
          autoApproved: false,
          autoApprovalLevel: null,
        });
      } else if (action.actionType === 'split_merged_row') {
        const proposedRows = action.proposedNewRowsJson
          ? JSON.parse(action.proposedNewRowsJson) as Array<{ procedureName: string; examDateTime: string | null; modifiedDateTime: string | null; dateTimePairingConfidence: number; reviewReason: string }>
          : [];
        if (proposedRows.length === 0) throw new Error('No split rows were proposed.');
        const splitRows = await buildSplitRows(row, proposedRows, activeProfile?.id ?? null);
        setReviewRows((rows) => rows.flatMap((item) => item.tempId === row.tempId ? splitRows : [item]));
      } else if (action.actionType === 'mark_not_duplicate') {
        updateRow(row.tempId, {
          duplicateStatus: null,
          duplicateReason: null,
          duplicateExistingLogId: null,
          autoSkipped: false,
          included: true,
          needsReview: false,
          approvalStatus: 'approved_as_new',
          reviewReason: 'Marked not duplicate by AI Assistant / user approved',
        });
      } else if (action.actionType === 'mark_duplicate') {
        updateRow(row.tempId, {
          duplicateStatus: 'exact',
          duplicateReason: 'Marked duplicate by user-approved assistant correction',
          included: false,
          approvalStatus: 'exact_duplicate_skipped',
          needsReview: true,
          reviewReason: 'Marked duplicate by AI Assistant / user approved',
        });
      }

      await db.correctionActions.update(action.id, {
        approvedByUser: true,
        appliedAt: new Date().toISOString(),
      });
      addTimeline(`Assistant correction applied: ${action.actionType.replace(/_/g, ' ')}`);
      pushToast('success', 'Assistant correction applied', action.explanation);
      setAssistantPanel((panel) =>
        panel
          ? {
              ...panel,
              actions: panel.actions.map((item) =>
                item.id === action.id ? { ...item, approvedByUser: true, appliedAt: new Date().toISOString() } : item,
              ),
            }
          : panel,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Correction failed');
      pushToast('danger', 'Correction failed', e instanceof Error ? e.message : 'The row was not changed.');
    } finally {
      setAssistantBusy(false);
    }
  }

  function saveAssistantFeedbackOnly() {
    setAssistantPanel(null);
    setAssistantPrompt('');
    pushToast('success', 'Feedback saved', 'No review rows were changed.');
  }

  function showFeedbackSummary() {
    const summary = generateFeedbackSummary(feedbackEvents);
    setFeedbackSummary(summary.codexPrompt);
  }

  const includedCount = reviewRows.filter((r) => r.included).length;
  const matchedCount = reviewRows.filter((r) => r.included && getSelectedCandidates(r).length > 0).length;
  const selectedCodeCount = reviewRows
    .filter((r) => r.included)
    .reduce((sum, row) => sum + getSelectedCandidates(row).length, 0);
  const safeApprovalCount = reviewRows.filter(isSafeAutoApprovalRow).length;
  const priorMappingCount = reviewRows.filter(isPriorApprovedMappingRow).length;
  const autoApprovedRows = reviewRows.filter((row) => row.included && !row.needsReview);
  const autoCodedCount = autoApprovedRows.length;
  const autoApprovedWrvu = autoApprovedRows.reduce((sum, row) => sum + getSelectedWorkRvu(row), 0);
  const requiresReviewCount = reviewRows.filter((row) => row.included && row.needsReview).length;
  const approvalSummary = summarizeReviewApproval(reviewRows, skippedRows);
  const reviewableWarningCount = reviewRows.filter((row) => row.needsReview && row.duplicateStatus === 'possible' && canApproveReviewRow(row)).length;
  const reviewableCleanCount = reviewRows.filter((row) => row.needsReview && row.duplicateStatus !== 'possible' && canApproveReviewRow(row)).length;
  const visibleReviewRows = reviewRows.filter((row) => {
    if (reviewMode === 'everything') return true;
    if (reviewMode === 'auto') return row.autoApproved || !row.needsReview;
    if (reviewMode === 'low') return row.included && row.needsReview && (row.candidates[0]?.confidence ?? 0) < 0.95;
    return row.included && row.needsReview;
  });

  // ── Done screen ───────────────────────────────────────────────────────────
  if (step === 'done') {
    const doneParts = [
      `Saved ${importedCount} ${importedCount === 1 ? 'study' : 'studies'}`,
      `${importedWrvu.toFixed(1)} wRVU`,
      skippedCount > 0 ? `${skippedCount} skipped as duplicate${skippedCount === 1 ? '' : 's'}` : null,
      reviewNeeded > 0 ? `${reviewNeeded} still need review` : null,
      blockedNoValidCptCount > 0 ? `${blockedNoValidCptCount} blocked (no CPT)` : null,
    ].filter(Boolean);

    return (
      <>
        <div className="max-w-lg mx-auto text-center space-y-5 py-16 animate-in fade-in duration-300">
          <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center mx-auto text-3xl">
            ✓
          </div>
          <p className="text-white text-base">{doneParts.join(' · ')}.</p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => {
                setStep('input');
                setPasteText('');
                setOcrFile(null);
                setReviewRows([]);
                setSkippedRows([]);
                setLastExtractedCount(0);
                setShowSkipped(false);
                sessionStorage.removeItem(WATCHER_REVIEW_KEY);
              }}
              className="px-6 py-2.5 rounded-xl border border-white/15 text-slate-300 text-sm hover:border-white/30 transition-colors"
            >
              Capture more
            </button>
            <button
              onClick={onImported}
              className="px-6 py-2.5 rounded-xl text-white text-sm font-semibold hover:opacity-90 transition-opacity"
              style={{ background: `linear-gradient(135deg, ${theme.colors.primary}, ${theme.colors.accent})` }}
            >
              Done
            </button>
          </div>
        </div>
        <ImportToastStack toasts={toasts} />
      </>
    );
  }

  // ── Review screen ─────────────────────────────────────────────────────────
  if (step === 'review') {
    const reviewState = getImportReviewState({
      extractedCount: lastExtractedCount,
      reviewRowCount: reviewRows.length,
      skippedRowCount: skippedRows.length,
      matchedCount,
      selectedCodeCount,
      importing,
    });

    return (
      <>
      <div className="space-y-5 animate-in fade-in duration-300">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-white">Review matches</h1>
          <button
            onClick={() => setStep('input')}
            className="text-sm text-slate-400 hover:text-white transition-colors"
          >
            ← Back
          </button>
        </div>

        <p className="text-sm text-slate-300">
          {includedCount} studies · {approvalSummary.finalizableRows} ready to save · {requiresReviewCount} need review · {approvalSummary.pendingWrvu.toFixed(1)} wRVU pending
          {approvalSummary.exactDuplicateRows > 0 && ` · ${approvalSummary.exactDuplicateRows} exact dup${approvalSummary.exactDuplicateRows > 1 ? 's' : ''} skipped`}
          {approvalSummary.excludedRows > 0 && ` · ${approvalSummary.excludedRows} excluded`}
        </p>

        {ocrDebug?.reconciliationWarning && (
          <div className="flex items-start gap-3 rounded-xl px-4 py-3 border border-red-500/40 bg-red-500/10">
            <span className="text-lg mt-0.5">⚠️</span>
            <div>
              <p className="text-sm font-semibold text-red-300">Row-count reconciliation failed</p>
              <p className="text-xs mt-0.5 text-red-300/80">{ocrDebug.reconciliationWarning}</p>
            </div>
          </div>
        )}

        <LogDateLine
          logDate={logDate}
          editing={logDateEditing}
          onEdit={() => setLogDateEditing(true)}
          onChange={(value) => { setLogDate(value); setLogDateEditing(false); }}
        />

        {!hasSeenAutosaveNotice && (
          <p className="text-xs text-slate-500">
            Session saves automatically.{' '}
            <button
              onClick={() => { localStorage.setItem('wrvu-autosave-notice-seen', '1'); setHasSeenAutosaveNotice(true); }}
              className="underline hover:text-slate-300"
            >
              Got it
            </button>
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {reviewableCleanCount > 0 && (
            <button
              onClick={() => approveAllReviewable(false)}
              className="btn-primary text-xs"
            >
              Approve all ready ({reviewableCleanCount})
            </button>
          )}
          <div className="relative">
            <button
              onClick={() => setMoreActionsOpen((v) => !v)}
              className="text-xs px-3 py-1.5 rounded-lg border border-white/10 text-slate-400 hover:text-white hover:border-white/25 transition-colors"
            >
              More ⌄
            </button>
            {moreActionsOpen && (
              <div className="absolute z-10 mt-1 w-64 rounded-xl border border-white/10 bg-slate-900 shadow-xl p-1">
                {reviewableWarningCount > 0 && (
                  <button
                    onClick={() => { approveAllReviewable(true); setMoreActionsOpen(false); }}
                    className="w-full text-left px-3 py-2 rounded-lg text-xs text-slate-300 hover:bg-white/5"
                  >
                    Approve all warning rows as new ({reviewableWarningCount})
                  </button>
                )}
                {safeApprovalCount > 0 && (
                  <button
                    onClick={() => { approveHighConfidence(); setMoreActionsOpen(false); }}
                    className="w-full text-left px-3 py-2 rounded-lg text-xs text-slate-300 hover:bg-white/5"
                  >
                    Approve all high-confidence matches ({safeApprovalCount})
                  </button>
                )}
                {priorMappingCount > 0 && (
                  <button
                    onClick={() => { approvePriorMappings(); setMoreActionsOpen(false); }}
                    className="w-full text-left px-3 py-2 rounded-lg text-xs text-slate-300 hover:bg-white/5"
                  >
                    Approve all prior mappings ({priorMappingCount})
                  </button>
                )}
                <button
                  onClick={() => { setFeedbackQueueOpen((v) => !v); setMoreActionsOpen(false); }}
                  className="w-full text-left px-3 py-2 rounded-lg text-xs text-slate-300 hover:bg-white/5"
                >
                  Feedback log
                </button>
                <button
                  onClick={() => { discardSession(); setMoreActionsOpen(false); }}
                  className="w-full text-left px-3 py-2 rounded-lg text-xs text-red-400 hover:bg-red-500/10"
                >
                  Discard session
                </button>
              </div>
            )}
          </div>
          <select
            value={reviewMode}
            onChange={(e) => setReviewMode(e.target.value as ReviewMode)}
            className="ml-auto text-xs rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-slate-300"
          >
            <option value="unknowns">Exceptions only</option>
            <option value="everything">Everything</option>
            <option value="auto">Auto-approved</option>
            <option value="low">Low-confidence only</option>
          </select>
        </div>

        {feedbackQueueOpen && (
          <div className="card space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-white">Feedback log</p>
                <p className="text-xs text-slate-500">Review feedback saved locally for later mapping, issue, or Codex prompt generation.</p>
              </div>
              <button
                onClick={showFeedbackSummary}
                disabled={feedbackEvents.length === 0}
                className="btn-ghost text-xs disabled:opacity-40"
              >
                Generate developer summary
              </button>
            </div>
            <div className="grid gap-2 md:grid-cols-4">
              {(['wrong_duplicate', 'missing_datetime', 'merged_ocr_rows', 'wrong_cpt'] as FeedbackEventCategory[]).map((category) => (
                <div key={category} className="rounded-lg border border-white/8 bg-white/3 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-slate-500">{category.replace(/_/g, ' ')}</p>
                  <p className="text-lg font-bold text-white">{feedbackEvents.filter((event) => event.category === category).length}</p>
                </div>
              ))}
            </div>
            <div className="max-h-48 overflow-y-auto space-y-2">
              {feedbackEvents.length === 0 ? (
                <p className="text-xs text-slate-500">No feedback captured yet.</p>
              ) : feedbackEvents.map((event) => (
                <div key={event.id} className="rounded-lg border border-white/8 bg-black/15 px-3 py-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-300">{event.category.replace(/_/g, ' ')}</span>
                    <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-500">{event.severity}</span>
                    <span className="ml-auto text-slate-500">{new Date(event.createdAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
                  </div>
                  <p className="mt-1 text-slate-300">{event.userComment}</p>
                  {event.cleanedExamTitle && <p className="mt-1 font-mono text-[11px] text-slate-500">{event.cleanedExamTitle}</p>}
                </div>
              ))}
            </div>
            {feedbackSummary && (
              <div className="rounded-lg border border-white/8 bg-black/20 p-3">
                <p className="text-xs font-semibold text-slate-300">Codex-ready summary</p>
                <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-slate-400">{feedbackSummary}</pre>
              </div>
            )}
          </div>
        )}

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
                        <p className="text-sm text-slate-300 truncate">{procedureNameForSource(s.source)}</p>
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

        {/* ── Auto-approved summary strip ───────────────────────────────── */}
        {autoApprovedRows.length > 0 && reviewMode !== 'everything' && reviewMode !== 'auto' && (
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/8 overflow-hidden">
            <button
              onClick={() => setShowAutoApproved((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-white/3 transition-colors"
            >
              <span className="text-emerald-300 font-medium">
                {autoApprovedRows.length} auto-approved · {autoApprovedWrvu.toFixed(1)} wRVU
              </span>
              <span className="text-emerald-400/70 text-xs">{showAutoApproved ? 'Hide ▲' : 'Show ▼'}</span>
            </button>
            {showAutoApproved && (
              <div className="border-t border-emerald-500/15 divide-y divide-emerald-500/10">
                {autoApprovedRows.map((row) => {
                  const selected = getSelectedCandidates(row);
                  const cptSummary = selected.map((candidate) => candidate.cptCode).join(' + ');
                  return (
                    <div key={row.tempId} className="px-4 py-2.5 flex items-center justify-between gap-3">
                      <p className="text-sm text-slate-300 truncate">{procedureNameForSource(row.source)}</p>
                      <div className="flex items-center gap-2 shrink-0 text-xs text-slate-500">
                        {cptSummary && <span className="font-mono text-slate-400">{cptSummary}</span>}
                        <span>{getSelectedWorkRvu(row).toFixed(2)} wRVU</span>
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
            const reviewReason = manualReviewReason(row);
            const canApproveRow = canApproveReviewRow(row);
            const dateWarning = dateAttributionWarning(row);
            const procedureName = procedureNameForSource(row.source);
            const status = computeCardStatus(row);
            const chipCandidates = selected.length > 0 ? selected : row.candidates.slice(0, 2);
            const examDateTime = formatOcrDateTime(
              row.source.examDate ?? row.source.examDateTime?.slice(0, 10) ?? row.source.studyDate,
              row.source.examTime ?? row.source.examDateTime?.slice(11, 16),
              row.source.examDateTime,
            );
            const readDateTime = formatOcrDateTime(
              row.source.modifiedDate ?? row.source.modifiedDateTime?.slice(0, 10),
              row.source.modifiedTime,
              row.source.modifiedDateTime,
            );
            const metaLine = [examDateTime && `Exam ${examDateTime}`, readDateTime && `Read ${readDateTime}`]
              .filter(Boolean)
              .join(' → ');
            const statusToneClass = status.tone === 'green'
              ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300'
              : status.tone === 'amber'
              ? 'border-amber-500/25 bg-amber-500/10 text-amber-300'
              : 'border-slate-500/25 bg-slate-500/10 text-slate-300';

            return (
              <div
                key={row.tempId}
                className={`card transition-opacity duration-200 ${!row.included ? 'opacity-40' : ''}`}
              >
                {/* Line 1: procedure name + wRVU total, Approve / Exclude */}
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 truncate text-sm font-medium text-white">{procedureName}</p>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xs font-semibold text-white">{selectedTotal.toFixed(2)} wRVU</span>
                    {canApproveRow && row.included && (
                      <button
                        onClick={() => approveReviewRow(row.tempId)}
                        className="text-xs px-2 py-1 rounded-lg border border-emerald-500/35 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/18 transition-colors"
                      >
                        {approvalButtonLabel(row)}
                      </button>
                    )}
                    {!hasValidSelectedProductivityRvu(row) && row.included && (
                      <button
                        onClick={() => setSearchPanelTempId(row.tempId)}
                        className="text-xs px-2 py-1 rounded-lg border border-sky-500/35 text-sky-300 hover:bg-sky-500/10 transition-colors"
                      >
                        Add CPT
                      </button>
                    )}
                    <button
                      onClick={() => updateRow(row.tempId, {
                        included: !row.included,
                        approvalStatus: row.included ? 'excluded' : 'pending',
                        needsReview: row.included ? row.needsReview : true,
                      })}
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

                {/* Line 2: CPT chip(s) — code + short name only */}
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {chipCandidates.length > 0 ? (
                    chipCandidates.map((candidate) => (
                      <span
                        key={candidateKey(candidate)}
                        className="text-[11px] px-1.5 py-0.5 rounded border border-sky-500/25 bg-sky-500/8 text-sky-300"
                      >
                        <span className="font-mono font-semibold">{candidate.cptCode}</span>{' '}
                        <span className="text-slate-400">
                          {candidate.description.slice(0, 32)}{candidate.description.length > 32 ? '…' : ''}
                        </span>
                      </span>
                    ))
                  ) : (
                    <span className="text-[11px] italic text-red-400">No CPT match</span>
                  )}
                </div>

                {/* Line 3: exam/read datetimes + at most one status badge */}
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-mono text-slate-500">{metaLine}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium shrink-0 ${statusToneClass}`}>
                    {status.label}
                  </span>
                </div>

                {/* Everything else lives behind one disclosure. */}
                {row.included && (
                  <details className="mt-2">
                    <summary className="cursor-pointer select-none text-[11px] font-semibold uppercase tracking-wide text-slate-500 transition-colors hover:text-slate-300">
                      Details
                    </summary>
                    <div className="mt-2 space-y-2">
                      {isPossibleDupe && (
                        <div className="px-3 py-2 rounded-lg bg-orange-500/8 border border-orange-500/20 text-xs text-orange-300/80">
                          {row.duplicateReason} — verify before saving or exclude this row.
                        </div>
                      )}

                      {dateWarning && (
                        <div className="px-3 py-2 rounded-lg bg-amber-500/8 border border-amber-500/20 text-xs text-amber-200/85">
                          {dateWarning}
                        </div>
                      )}

                      <StructuredDetails row={row} selected={selected} reviewReason={reviewReason} />

                      <div className="rounded-xl border border-white/8 bg-white/[0.025] px-3 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            onClick={() => {
                              setAssistantTempId(assistantTempId === row.tempId ? null : row.tempId);
                              setAssistantPrompt('');
                              setAssistantPanel(null);
                            }}
                            className="text-xs px-2.5 py-1 rounded-lg border border-sky-500/25 text-sky-300 hover:bg-sky-500/10 transition-colors"
                          >
                            Ask Assistant / Fix
                          </button>
                          <span className="text-[11px] text-slate-500">Report / Teach:</span>
                          {ASSISTANT_QUICK_OPTIONS.slice(0, 6).map((option) => (
                            <button
                              key={`${row.tempId}-${option.category}-${option.label}`}
                              onClick={() => askAssistant(row, i, option.prompt, option.category)}
                              disabled={assistantBusy}
                              className="text-[11px] px-2 py-0.5 rounded-lg border border-white/10 text-slate-400 hover:border-white/25 hover:text-white disabled:opacity-40"
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>

                        {assistantTempId === row.tempId && (
                          <div className="mt-3 space-y-3">
                            <div className="flex gap-2">
                              <input
                                value={assistantPrompt}
                                onChange={(event) => setAssistantPrompt(event.target.value)}
                                placeholder="Tell the assistant what is wrong with this row..."
                                className="input min-w-0 flex-1 text-xs"
                              />
                              <button
                                onClick={() => askAssistant(row, i, assistantPrompt)}
                                disabled={assistantBusy || !assistantPrompt.trim()}
                                className="px-3 py-1.5 rounded-lg border border-sky-500/35 text-xs font-semibold text-sky-300 hover:bg-sky-500/10 disabled:opacity-40"
                              >
                                Ask
                              </button>
                            </div>

                            {assistantPanel?.rowId === row.tempId && (
                              <div className="rounded-xl border border-sky-500/20 bg-sky-500/8 p-3 text-xs">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div>
                                    <p className="font-semibold text-sky-200">Assistant interpretation</p>
                                    <p className="mt-1 text-slate-300">{assistantPanel.response.explanation}</p>
                                  </div>
                                  <button
                                    onClick={saveAssistantFeedbackOnly}
                                    className="rounded-lg border border-white/12 px-2 py-1 text-[11px] text-slate-300 hover:border-white/25"
                                  >
                                    Save feedback only
                                  </button>
                                </div>
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-300">
                                    {assistantPanel.response.problemType.replace(/_/g, ' ')}
                                  </span>
                                  <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-300">
                                    {Math.round(assistantPanel.response.confidence * 100)}% confidence
                                  </span>
                                  {assistantPanel.response.requiresUserApproval && (
                                    <span className="rounded border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-300">
                                      approval required
                                    </span>
                                  )}
                                </div>
                                {assistantPanel.response.safetyConcerns.length > 0 && (
                                  <div className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/8 px-2 py-1.5 text-amber-200/80">
                                    {assistantPanel.response.safetyConcerns.join(' ')}
                                  </div>
                                )}
                                {assistantPanel.actions.length > 0 && (
                                  <div className="mt-3 space-y-2">
                                    {assistantPanel.actions.map((action) => (
                                      <div key={action.id} className="rounded-lg border border-white/10 bg-black/15 px-2.5 py-2">
                                        <p className="font-semibold text-slate-200">{action.actionType.replace(/_/g, ' ')}</p>
                                        <p className="mt-1 text-slate-400">{action.explanation}</p>
                                        {action.proposedNewRowsJson && (
                                          <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-black/20 p-2 font-mono text-[11px] text-slate-400">
                                            {JSON.stringify(JSON.parse(action.proposedNewRowsJson), null, 2)}
                                          </pre>
                                        )}
                                        <div className="mt-2 flex justify-end">
                                          <button
                                            onClick={() => applyAssistantAction(action)}
                                            disabled={assistantBusy || action.approvedByUser || action.actionType === 'ignore'}
                                            className="rounded-lg border border-emerald-500/30 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-40"
                                          >
                                            {action.approvedByUser ? 'Applied' : 'Apply'}
                                          </button>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {selected.length > 0 && (
                        <div className="rounded-lg border border-sky-500/20 bg-sky-500/8 px-3 py-2">
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
                              initialQuery={procedureNameForSource(row.source)}
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
                                  {candidateExplanationText(c, procedureNameForSource(row.source))}
                                </span>
                                {c.confidence < 0.75 && row.candidates.length > 1 && (
                                  <span className="mt-0.5 block text-[10px] text-amber-300/80">
                                    Alternatives: {row.candidates.filter((alt, altIndex) => altIndex !== ci).slice(0, 3).map((alt) => `${alt.cptCode}${alt.modifier ? `-${alt.modifier}` : ''} ${Math.round(alt.confidence * 100)}%`).join(' | ')}
                                  </span>
                                )}
                              </button>
                            );
                          })}
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
                              initialQuery={procedureNameForSource(row.source)}
                              onSelect={(c) => handleManualSelect(row.tempId, c)}
                              onClose={() => setSearchPanelTempId(null)}
                            />
                          )}
                        </div>
                      )}
                    </div>
                  </details>
                )}
              </div>
            );
          })}

          {reviewState.isEmptyExtraction && (
            <div className="text-center py-10">
              <p className="text-white font-medium">No studies found</p>
              <p className="text-slate-400 text-sm mt-1">
                Adjust crop, paste a clearer PowerScribe window grab, or try again.
              </p>
            </div>
          )}

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
            disabled={importing || approvalSummary.finalizableRows === 0}
            className="flex-1 py-2.5 rounded-xl text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
            style={{ background: `linear-gradient(135deg, ${theme.colors.primary}, ${theme.colors.accent})` }}
          >
            {importing ? 'Saving...' : approvalSummary.finalizableRows > 0 ? `Finalize ${approvalSummary.finalizableRows} studies - ${approvalSummary.finalizableWrvu.toFixed(1)} wRVU` : reviewState.commitLabel}
          </button>
        </div>
      </div>
      <ImportToastStack toasts={toasts} />
      </>
    );
  }

  // ── Input screen — the page IS the drop zone ────────────────────────────
  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      void processPowerScribeCapture(file, 'drag and drop');
    }
  }

  return (
    <>
    <div className="max-w-2xl mx-auto space-y-4 animate-in fade-in duration-300">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-white tracking-tight">Capture</h1>
        {onOpenQuickLog && (
          <button
            type="button"
            onClick={onOpenQuickLog}
            className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-400 hover:text-slate-200"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
          >
            Log a study manually · ⌘K
          </button>
        )}
      </div>

      {clipboardFile && !processing && (
        <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 p-3 space-y-3">
          <p className="text-sm font-semibold text-sky-300">{CAPTURE_PROMPT_TITLE}</p>
          <p className="text-xs text-slate-400">
            This looks like a PowerScribe worklist screenshot. {CAPTURE_PRIVACY_COPY}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => processPowerScribeCapture(clipboardFile, 'confirmed clipboard')}
              disabled={processing}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white"
              style={{ background: `linear-gradient(135deg, ${theme.colors.primary}, ${theme.colors.accent})` }}
            >
              Process this capture
            </button>
            <button
              onClick={() => setClipboardFile(null)}
              disabled={processing}
              className="px-3 py-1.5 rounded-lg border border-white/12 text-xs text-slate-400 hover:text-white disabled:opacity-40"
            >
              Ignore this capture
            </button>
            <button
              onClick={() => alwaysProcessClipboard(clipboardFile)}
              disabled={processing}
              className="px-3 py-1.5 rounded-lg border border-sky-500/30 text-xs text-sky-300 hover:bg-sky-500/10 disabled:opacity-40"
            >
              Always process PowerScribe captures
            </button>
          </div>
        </div>
      )}

      {processing ? (
        <CaptureProcessingState />
      ) : (
        <div
          onClick={() => fileRef.current?.click()}
          onDrop={handleDrop}
          onDragOver={(event) => event.preventDefault()}
          className="border-2 border-dashed border-white/15 rounded-2xl p-10 text-center cursor-pointer transition-all duration-200 hover:border-white/30 hover:bg-white/3"
        >
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void processPowerScribeCapture(file, 'file picker');
              e.target.value = '';
            }}
          />
          <p className="text-4xl mb-3">📋</p>
          <p className="text-slate-300 text-sm font-medium">Paste, drop, or click — screenshot or text</p>
          {!hasSeenCaptureTip && (
            <p className="text-slate-500 text-xs mt-2 max-w-sm mx-auto">
              Capture the study list with Procedure, Exam Date, and Modified columns visible.
            </p>
          )}
        </div>
      )}

      <LogDateLine
        logDate={logDate}
        editing={logDateEditing}
        onEdit={() => setLogDateEditing(true)}
        onChange={(value) => { setLogDate(value); setLogDateEditing(false); }}
      />

      <p className="text-[11px] text-slate-600">PowerScribe API — soon</p>

      {error && <p className="text-red-400 text-sm">{error}</p>}
      <OcrDebugPanel debug={ocrDebug} imageFile={ocrFile} />
    </div>
    <ImportToastStack toasts={toasts} />
    </>
  );
}
