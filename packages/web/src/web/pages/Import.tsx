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
import { useProfile } from '../hooks/useProfile';
import { getDesktopAPI } from '../lib/desktop';
import { todayDateString } from '../utils/calculations';
import { db, ensureUserSettings } from '../db/database';
import {
  createTimelineEvent,
  getSelectedCandidateIndices,
  getSelectedCandidates,
  getSelectedWorkRvu,
  loadActiveReviewSession,
  mergeReviewSessionRows,
  persistActiveReviewSession,
  type TimelineEvent,
} from '../services/reviewSessionService';
import { processOcrImport, processStructuredPowerScribeOcrImport, processTextImport, type ProcessedImportResult } from '../services/ocrWorkflowService';
import { clearGlobalCapture, subscribeGlobalCapture } from '../services/globalCaptureQueue';
import { watcherReceiptBody } from '../services/notificationReceipts';
import type { PipelineReviewRow } from '../pipeline/importPipeline';
import type { MatchCandidate, UserSettings } from '../types';

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

function isProductivityCandidate(candidate: MatchCandidate): boolean {
  return candidate.modifier === '26' && (candidate.workRvu ?? 0) > 0;
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

interface ImportProps {
  onReviewReady: () => void;
}

type Mode = 'paste' | 'ocr' | 'powerscribe';
type Step = 'input' | 'review';
type ImportToastTone = 'info' | 'success' | 'warning' | 'danger';

export const CAPTURE_PROCESSING_LABEL = 'Processing...';
export const CAPTURE_PROMPT_TITLE = 'PowerScribe capture detected';
export const CAPTURE_PRIVACY_COPY = 'The screenshot is processed in memory and discarded after parsing. Only extracted productivity data is stored.';

export function shouldAutoProcessPowerScribeCaptures(settings: Pick<UserSettings, 'alwaysProcessPowerScribeClipboard'> | null | undefined): boolean {
  return Boolean(settings?.alwaysProcessPowerScribeClipboard);
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
    <div className="rounded-xl border border-rd-separator bg-rd-surface-2 px-4 py-4">
      <p className="text-sm font-semibold text-rd-label-primary">Reading capture…</p>
      <p className="mt-1 text-xs text-rd-label-secondary">Studies appear as each row resolves.</p>
      <div className="mt-4 space-y-2" aria-label={CAPTURE_PROCESSING_LABEL}>
        {[0, 1, 2].map((row) => (
          <div key={row} className="flex min-h-11 items-center gap-3 rounded-[10px] border border-rd-separator bg-rd-surface px-3">
            <span className="size-4 rounded-full border border-rd-separator" />
            <span className="h-2.5 rounded-full bg-rd-separator" style={{ width: `${68 - row * 12}%` }} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function Import({ onReviewReady }: ImportProps) {
  const { activeProfile, activePractice } = useProfile();
  const [mode, setMode]           = useState<Mode>('ocr');
  const [step, setStep]           = useState<Step>('input');
  const [pasteText, setPasteText] = useState('');
  const [ocrFile, setOcrFile]     = useState<File | null>(null);
  const [processing, setProcessing] = useState(false);
  const [reviewRows, setReviewRows]   = useState<PipelineReviewRow[]>([]);
  const [skippedRows, setSkippedRows] = useState<PipelineReviewRow[]>([]);
  const [logDate, setLogDate]     = useState(todayDateString());
  const [error, setError]         = useState<string | null>(null);
  const [clipboardFile, setClipboardFile] = useState<File | null>(null);
  const [ocrDebug, setOcrDebug] = useState<ProcessedImportResult['ocrDebug']>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [toasts, setToasts] = useState<ImportToast[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const processingRef = useRef(false);
  const lastClipboardImageHashRef = useRef<string | null>(null);
  useEffect(() => subscribeGlobalCapture((payload) => {
    clearGlobalCapture(payload);
    if (payload.kind === 'text') {
      setMode('paste');
      setPasteText(payload.text);
      return;
    }
    if (payload.file.type.startsWith('image/')) {
      setMode('ocr');
      void queueClipboardImage(payload.file, `global ${payload.source}`);
      return;
    }
    void payload.file.text().then((text) => {
      setMode('paste');
      setPasteText(text);
    });
  }), []);

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
    }).then(onReviewReady);
  }, [step, reviewRows, skippedRows, timeline, logDate, activeProfile?.id, sessionId, onReviewReady]);

  useEffect(() => {
    processingRef.current = processing;
  }, [processing]);

  useEffect(() => {
    if (mode !== 'ocr') return;
    function handlePaste(event: ClipboardEvent) {
      const imageItem = Array.from(event.clipboardData?.items ?? []).find((item) => item.type.startsWith('image/'));
      if (!imageItem) return;
      const blob = imageItem.getAsFile();
      if (!blob) return;
      const file = new File([blob], `powerscribe-clipboard-${Date.now()}.png`, { type: blob.type || 'image/png' });
      event.preventDefault();
      void queueClipboardImage(file, 'clipboard paste');
    }
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [mode, activeProfile?.id, activePractice?.id, sessionId, logDate, reviewRows, skippedRows]);

  useEffect(() => {
    if (mode !== 'ocr') return;
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
  }, [mode, activeProfile?.id, activePractice?.id, sessionId, logDate, reviewRows, skippedRows]);

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

  function appendPipelineRows(nextRows: PipelineReviewRow[], nextSkippedRows: PipelineReviewRow[], label: string) {
    const merged = mergeReviewSessionRows(reviewRows, skippedRows, nextRows, nextSkippedRows);
    setReviewRows(merged.reviewRows);
    setSkippedRows(merged.skippedRows);
    addTimeline(label);
    setStep('review');
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
    const desktop = getDesktopAPI();
    if (desktop && document.visibilityState !== 'visible' && readyCount > 0) {
      void desktop.showNotification('Watcher receipt', watcherReceiptBody(readyCount, reviewCount));
    }
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
      appendPipelineRows(processed.result.reviewRows, processed.result.skippedRows, `${processed.timelineLabel} from ${timelineSource}`);
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
      const rows = await desktop.extractPowerScribeClipboardRows();
      if (rows.length === 0) return false;
      pushToast('info', 'Matching CPT codes...', 'Using structured procedure names only.');
      const processed = await processStructuredPowerScribeOcrImport(rows, {
        profileId: activeProfile?.id ?? null,
        siteId: activePractice?.id ?? null,
        sessionId,
        logDate,
      });
      setOcrFile(file);
      setOcrDebug(null);
      appendPipelineRows(processed.result.reviewRows, processed.result.skippedRows, `${processed.timelineLabel} from ${timelineSource}`);
      setClipboardFile(null);
      return true;
    } catch (error) {
      console.warn('Windows PowerScribe OCR helper failed; falling back to browser OCR.', error);
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
      const usedStructuredHelper = await processWindowsClipboardCapture(file, timelineSource);
      if (!usedStructuredHelper) {
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

  async function handlePasteProcess() {
    if (!pasteText.trim()) return;
    setProcessing(true);
    setError(null);
    pushToast('info', 'Matching CPT codes...', 'Parsing pasted studies and preparing the review queue.');
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
      pushToast('danger', 'Processing failed', e instanceof Error ? e.message : 'Could not parse the pasted study list.');
    } finally {
      setProcessing(false);
    }
  }

  async function handleOcrProcess() {
    if (!ocrFile) return;
    await processOcrFile(ocrFile, 'manual file');
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

  if (step === 'review') {
    return <CaptureProcessingState />;
  }

  // ── Input screen ──────────────────────────────────────────────────────────
  return (
    <>
    <div className="max-w-2xl mx-auto space-y-6 animate-in fade-in duration-300">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">PowerScribe Capture</h1>
        <p className="text-slate-400 text-sm mt-0.5">Paste or upload a PowerScribe window grab to extract exam rows</p>
      </div>

      {/* Mode toggle */}
      <div className="flex gap-2 p-1 bg-white/5 rounded-xl">
        <button
          onClick={() => { setMode('paste'); setError(null); }}
          className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
            mode === 'paste' ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-slate-300'
          }`}
        >
          Paste / CSV
        </button>
        <button
          onClick={() => { setMode('ocr'); setError(null); }}
          className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
            mode === 'ocr' ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-slate-300'
          }`}
        >
          Screen Capture Intake
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
            {processing ? CAPTURE_PROCESSING_LABEL : 'Match & Review'}
          </button>
        </div>
      )}

      {mode === 'ocr' && (
        <div className="card space-y-4">
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
          {processing && <CaptureProcessingState />}
          <div>
            <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider mb-1.5">
              Paste or upload PowerScribe window grab
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
                  <p className="text-slate-500 text-xs mt-1">Copy the PowerScribe window, then paste here. Images are not stored.</p>
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
            <p className="text-amber-300 text-xs font-medium">Capture tips</p>
            <p className="text-amber-300/70 text-xs mt-1">
              Capture the PowerScribe study list with Procedure, Exam Date, and Modified columns visible.
              The screenshot is cropped, parsed, matched, and checked locally. Already-imported studies are auto-skipped.
            </p>
          </div>
          <OcrDebugPanel debug={ocrDebug} imageFile={ocrFile} />
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            onClick={handleOcrProcess}
            disabled={!ocrFile || processing}
            className="w-full py-3 rounded-xl text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
            style={{ background: `linear-gradient(135deg, ${theme.colors.primary}, ${theme.colors.accent})` }}
          >
            {processing ? CAPTURE_PROCESSING_LABEL : 'Extract & Match'}
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
    <ImportToastStack toasts={toasts} />
    </>
  );
}
