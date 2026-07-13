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
import { cn } from '@/lib/utils';
import { Card } from '../components/ui/Card';
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
    <details className="rounded-[10px] border border-rd-separator bg-rd-surface-2 p-3 text-[13px]">
      <summary className="cursor-pointer font-semibold text-rd-label-primary">
        OCR debug: {debug.parsedRowCount ?? debug.detectedRows.length} parsed / {debug.rawLineCount ?? debug.ocrLines.length} raw lines, {Math.round(debug.ocrConfidence * 100)}% text confidence
      </summary>
      <div className="mt-3 grid gap-3">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {debugStats.map(([label, value]) => (
            <div key={label} className="rounded-[8px] border border-rd-separator bg-rd-surface p-2">
              <p className="text-[10px] uppercase tracking-[0.14em] text-rd-label-secondary">{label}</p>
              <p className="mt-1 font-mono text-[11px] text-rd-label-primary">{value}</p>
            </div>
          ))}
        </div>
        {debug.crop && (
          <div className="rounded-[8px] border border-rd-separator bg-rd-surface p-2">
            <p className="font-medium text-rd-label-primary">
              Crop: {debug.crop.method} ({Math.round(debug.crop.confidence * 100)}%)
            </p>
            <p className="mt-1 font-mono text-[11px] text-rd-label-secondary">
              x {debug.crop.rect.x.toFixed(3)}, y {debug.crop.rect.y.toFixed(3)}, w {debug.crop.rect.width.toFixed(3)}, h {debug.crop.rect.height.toFixed(3)}, bottom {(debug.crop.rect.y + debug.crop.rect.height).toFixed(3)}
            </p>
          </div>
        )}
        {previewUrl && debug.crop && (
          <div className="rounded-[8px] border border-rd-separator bg-rd-surface p-2">
            <p className="font-medium text-rd-label-primary">Crop preview</p>
            <div className="relative mt-2 overflow-hidden rounded-[8px] border border-rd-separator">
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
        <div className="rounded-[8px] border border-rd-separator bg-rd-surface p-2">
          <p className="font-medium text-rd-label-primary">Detected rows</p>
          <div className="mt-2 max-h-36 overflow-y-auto space-y-1">
            {debug.detectedRows.length === 0 ? (
              <p className="text-rd-label-secondary">No exam rows were detected from the OCR text.</p>
            ) : (
              debug.detectedRows.map((row, index) => (
                <p key={`${row.rawText}-${index}`} className="font-mono text-[11px] text-rd-label-secondary">
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
          <div className="rounded-[8px] border border-rd-separator bg-rd-surface p-2">
            <p className="font-medium text-rd-label-primary">Rejected rows</p>
            <div className="mt-2 max-h-32 overflow-y-auto space-y-1">
              {debug.rejectedRows.map((row, index) => (
                <p key={`${row.reason}-${row.rawText}-${index}`} className="font-mono text-[11px] text-rd-label-secondary">
                  {index + 1}. {row.reason}: {row.rawText}
                </p>
              ))}
            </div>
          </div>
        )}
        <div className="rounded-[8px] border border-rd-separator bg-rd-surface p-2">
          <p className="font-medium text-rd-label-primary">OCR text</p>
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-rd-label-secondary">
            {debug.ocrText}
          </pre>
        </div>
        {debug.columnText && (
          <div className="grid gap-2 md:grid-cols-3">
            {(['procedure', 'examDate', 'modifiedDate'] as const).map((column) => (
              <div key={column} className="rounded-[8px] border border-rd-separator bg-rd-surface p-2">
                <p className="font-medium text-rd-label-primary">{column}</p>
                <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-rd-label-secondary">
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
    info: 'text-rd-label-primary',
    success: 'text-rd-positive',
    warning: 'text-rd-caution',
    danger: 'text-rd-negative',
  };

  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-50 flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="animate-in fade-in slide-in-from-bottom-2 rounded-[10px] border border-rd-separator bg-rd-surface px-4 py-3 duration-200"
          style={{ boxShadow: 'var(--rd-shadow-card)' }}
        >
          <p className={`text-[13px] font-semibold ${toneClass[toast.tone]}`}>{toast.title}</p>
          {toast.body && <p className="mt-1 text-[12px] leading-relaxed text-rd-label-secondary">{toast.body}</p>}
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
    // The full saved/review/blocked/dup split for the receipt toast, all read
    // off the same nextRows/nextSkippedRows the pipeline already returned —
    // no new pipeline math. blockedCount is the subset of reviewCount with no
    // CPT match at all (candidates.length === 0), broken out for the receipt
    // only; reviewCount itself stays the full needsReview count so the
    // desktop watcher notification's "in Inbox" total is unaffected.
    const savedCount = nextRows.filter((row) => !row.needsReview).length;
    const blockedCount = nextRows.filter((row) => row.needsReview && row.candidates.length === 0).length;
    const decidableReviewCount = reviewCount - blockedCount;
    const dupCount = nextSkippedRows.length;
    pushToast(
      reviewCount > 0 ? 'warning' : 'success',
      readyCount === 0 && nextSkippedRows.length === 0
        ? 'No studies found'
        : `Ready to review ${readyCount} exam${readyCount === 1 ? '' : 's'}`,
      `+${estimatedRvu.toFixed(1)} wRVUs pending · ${savedCount} saved · ${decidableReviewCount} need review · ${blockedCount} no CPT match · ${dupCount} duplicate${dupCount === 1 ? '' : 's'} skipped`,
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
  const modeTabClass = (active: boolean) =>
    cn(
      'min-h-8 flex-1 rounded-[8px] px-3 py-1.5 text-[13px] font-medium transition-colors',
      active ? 'bg-rd-surface text-rd-label-primary shadow-sm' : 'text-rd-label-secondary',
    );

  return (
    <>
    <div className="mx-auto max-w-2xl space-y-5">
      {/* Mode toggle */}
      <div role="tablist" className="inline-flex w-full gap-0.5 rounded-[10px] bg-rd-bg p-0.5">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'paste'}
          onClick={() => { setMode('paste'); setError(null); }}
          className={modeTabClass(mode === 'paste')}
        >
          Paste / CSV
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'ocr'}
          onClick={() => { setMode('ocr'); setError(null); }}
          className={modeTabClass(mode === 'ocr')}
        >
          Screen Capture Intake
        </button>
        {/* PowerScribe — architecture ready, live sync coming */}
        <button
          type="button"
          role="tab"
          disabled
          title="PowerScribe live sync — architecture implemented, activation coming soon"
          className="group relative min-h-8 flex-1 cursor-not-allowed rounded-[8px] px-3 py-1.5 text-[13px] font-medium text-rd-label-secondary opacity-50"
        >
          <span>⚡ PowerScribe</span>
          <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide">
            Soon
          </span>
          {/* Tooltip on hover */}
          <span
            className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 w-52 -translate-x-1/2 rounded-[10px] border border-rd-separator bg-rd-surface px-3 py-2 text-left text-[12px] text-rd-label-secondary opacity-0 transition-opacity group-hover:opacity-100"
            style={{ boxShadow: 'var(--rd-shadow-card)' }}
          >
            Live PowerScribe sync is architecturally supported — the provider interface and pipeline are ready. Authentication and site configuration coming soon.
          </span>
        </button>
      </div>

      {mode === 'paste' && (
        <Card className="space-y-4">
          <div>
            <label htmlFor="paste-text" className="mb-1.5 block text-[12px] font-medium uppercase tracking-[0.06em] text-rd-label-secondary">
              Paste exam names, CPT codes, or CSV
            </label>
            <textarea
              id="paste-text"
              aria-label="Paste exam names, CPT codes, or CSV"
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={`CT Abdomen Pelvis with contrast\nMRI Brain without contrast\n74177, 70553, 71046\n...one per line, comma-separated, or CSV with headers`}
              rows={10}
              className="w-full resize-none rounded-[10px] border border-rd-separator bg-rd-surface-2 px-3 py-2 font-mono text-[13px] text-rd-label-primary placeholder:text-rd-label-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rd-label-primary"
            />
          </div>
          <div>
            <label htmlFor="paste-log-date" className="mb-1.5 block text-[12px] font-medium uppercase tracking-[0.06em] text-rd-label-secondary">
              Log Date
            </label>
            <input
              id="paste-log-date"
              aria-label="Log date"
              type="date"
              value={logDate}
              onChange={(e) => setLogDate(e.target.value)}
              className="rounded-[10px] border border-rd-separator bg-rd-surface-2 px-3 py-2 text-[13px] text-rd-label-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rd-label-primary"
            />
          </div>
          <p className="text-[12px] text-rd-label-secondary">
            Supports: one per line, comma-separated CPT codes, or CSV with headers
            (examTitle, cpt, studyDate, accessionNumber, modality…).
            Duplicates detected automatically.
          </p>
          {error && <p className="text-[13px] text-rd-negative">{error}</p>}
          <button
            type="button"
            onClick={handlePasteProcess}
            disabled={!pasteText.trim() || processing}
            className="min-h-11 w-full rounded-[10px] bg-rd-label-primary px-5 text-[15px] font-semibold text-rd-bg disabled:opacity-40"
          >
            {processing ? CAPTURE_PROCESSING_LABEL : 'Match & Review'}
          </button>
        </Card>
      )}

      {mode === 'ocr' && (
        <Card className="space-y-4">
          {clipboardFile && !processing && (
            <div className="space-y-3 rounded-[10px] border border-rd-caution bg-rd-surface-2 p-3">
              <p className="text-[13px] font-semibold text-rd-label-primary">{CAPTURE_PROMPT_TITLE}</p>
              <p className="text-[12px] text-rd-label-secondary">
                This looks like a PowerScribe worklist screenshot. {CAPTURE_PRIVACY_COPY}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => processPowerScribeCapture(clipboardFile, 'confirmed clipboard')}
                  disabled={processing}
                  className="min-h-11 rounded-[10px] bg-rd-label-primary px-3 text-[13px] font-semibold text-rd-bg disabled:opacity-40"
                >
                  Process this capture
                </button>
                <button
                  type="button"
                  onClick={() => setClipboardFile(null)}
                  disabled={processing}
                  className="min-h-11 px-2 text-[13px] text-rd-label-secondary disabled:opacity-40"
                >
                  Ignore this capture
                </button>
                <button
                  type="button"
                  onClick={() => alwaysProcessClipboard(clipboardFile)}
                  disabled={processing}
                  className="min-h-11 px-2 text-[13px] text-rd-label-primary disabled:opacity-40"
                >
                  Always process PowerScribe captures
                </button>
              </div>
            </div>
          )}
          {processing && <CaptureProcessingState />}
          <div>
            <label htmlFor="ocr-file-input" className="mb-1.5 block text-[12px] font-medium uppercase tracking-[0.06em] text-rd-label-secondary">
              Paste or upload PowerScribe window grab
            </label>
            <input
              ref={fileRef}
              id="ocr-file-input"
              aria-label="Upload PowerScribe window grab"
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => setOcrFile(e.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className={cn(
                'w-full cursor-pointer rounded-[16px] border-2 border-dashed p-8 text-center transition-colors',
                ocrFile ? 'border-rd-label-primary bg-rd-surface-2' : 'border-rd-separator hover:bg-rd-surface-2',
              )}
            >
              {ocrFile ? (
                <div>
                  <p className="font-medium text-rd-label-primary">{ocrFile.name}</p>
                  <p className="mt-1 text-[12px] text-rd-label-secondary">
                    {(ocrFile.size / 1024).toFixed(0)} KB · Click to change
                  </p>
                </div>
              ) : (
                <div>
                  <p className="mb-3 text-4xl">📸</p>
                  <p className="text-[13px] font-medium text-rd-label-primary">Paste, drop, or click to upload</p>
                  <p className="mt-1 text-[12px] text-rd-label-secondary">Copy the PowerScribe window, then paste here. Images are not stored.</p>
                </div>
              )}
            </button>
          </div>
          <div>
            <label htmlFor="ocr-log-date" className="mb-1.5 block text-[12px] font-medium uppercase tracking-[0.06em] text-rd-label-secondary">
              Log Date
            </label>
            <input
              id="ocr-log-date"
              aria-label="Log date"
              type="date"
              value={logDate}
              onChange={(e) => setLogDate(e.target.value)}
              className="rounded-[10px] border border-rd-separator bg-rd-surface-2 px-3 py-2 text-[13px] text-rd-label-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rd-label-primary"
            />
          </div>
          <div className="rounded-[10px] border border-rd-caution bg-rd-surface-2 p-3">
            <p className="text-[12px] font-medium text-rd-label-primary">Capture tips</p>
            <p className="mt-1 text-[12px] text-rd-label-secondary">
              Capture the PowerScribe study list with Procedure, Exam Date, and Modified columns visible.
              The screenshot is cropped, parsed, matched, and checked locally. Already-imported studies are auto-skipped.
            </p>
          </div>
          <OcrDebugPanel debug={ocrDebug} imageFile={ocrFile} />
          {error && <p className="text-[13px] text-rd-negative">{error}</p>}
          <button
            type="button"
            onClick={handleOcrProcess}
            disabled={!ocrFile || processing}
            className="min-h-11 w-full rounded-[10px] bg-rd-label-primary px-5 text-[15px] font-semibold text-rd-bg disabled:opacity-40"
          >
            {processing ? CAPTURE_PROCESSING_LABEL : 'Extract & Match'}
          </button>
        </Card>
      )}

      {mode === 'powerscribe' && (
        /* This branch is unreachable while the button is disabled.
           It will be wired up when PowerScribeImportProvider goes live. */
        <Card className="space-y-3 py-10 text-center">
          <p className="text-2xl">⚡</p>
          <p className="font-semibold text-rd-label-primary">PowerScribe Live Sync</p>
          <p className="mx-auto max-w-sm text-[13px] text-rd-label-secondary">
            The import pipeline is architected to accept PowerScribe as a native
            source. Authentication and site configuration coming soon.
          </p>
        </Card>
      )}
    </div>
    <ImportToastStack toasts={toasts} />
    </>
  );
}
