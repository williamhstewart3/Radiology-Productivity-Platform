/**
 * Import.tsx
 *
 * Import screen — routes each import mode through the shared OCR workflow
 * service, then merges the returned rows into the active review session.
 *
 * Architecture placeholder:
 *   powerscribe → PowerScribeImportProvider (disabled, "Coming Soon")
 */

import { useState, useRef, useEffect, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { cn } from '@/lib/utils';
import { Card } from '../components/ui/Card';
import { useProfile } from '../hooks/useProfile';
import { getDesktopAPI } from '../lib/desktop';
import { todayDateString } from '../utils/calculations';
import { db } from '../db/database';
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
import { getSavedPowerScribeManualGuides, inspectScreenshotCapture, processOcrImport, processReportCaptureImport, processStructuredPowerScribeOcrImport, processTextImport, type PowerScribeCapturePrecheck, type ProcessedImportResult } from '../services/ocrWorkflowService';
import { clearGlobalCapture, subscribeGlobalCapture } from '../services/globalCaptureQueue';
import { watcherReceiptBody } from '../services/notificationReceipts';
import type { PipelineReviewRow } from '../pipeline/importPipeline';
import type { MatchCandidate, UserSettings } from '../types';
import {
  DEFAULT_POWERSCRIBE_MANUAL_COLUMN_GUIDES,
  detectPowerScribeRowBands,
  normalizePowerScribeRowBands,
  powerScribeManualColumnsFromGuides,
  type PowerScribeManualColumnCrops,
  type PowerScribeManualColumnGuides,
  type PowerScribeRowBand,
} from '../utils/imageCrop';

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
    ['Engine', debug.accounting?.engine ?? debug.ocrProvider],
    ['Crop tier', debug.accounting?.cropMethod ?? debug.crop?.method ?? 'none'],
    ['OCR scale', debug.accounting ? `${debug.accounting.preprocessScale.toFixed(2)}x` : 'n/a'],
    ['Header/valley drift', debug.accounting?.headerValleyDrift == null ? 'n/a' : debug.accounting.headerValleyDrift.toFixed(3)],
    ['Raw lines', debug.rawLineCount ?? debug.ocrLines.length],
    ['Cleaned lines', debug.cleanedLineCount ?? debug.ocrLines.length],
    ['Procedure OCR lines', debug.columnLineCounts?.procedure ?? 'n/a'],
    ['Exam date OCR lines', debug.columnLineCounts?.examDate ?? 'n/a'],
    ['Modified OCR lines', debug.columnLineCounts?.modifiedDate ?? 'n/a'],
    ['Geometric row crops', debug.accounting?.detectedRowCount ?? 0],
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

export function shouldAutoProcessRecognizedCapture(
  detected: boolean,
  settings: Pick<UserSettings, 'alwaysProcessPowerScribeClipboard'> | null | undefined,
): boolean {
  return detected && shouldAutoProcessPowerScribeCaptures(settings);
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

function CapturePreview({
  file,
  inspection,
  manualGuides,
  onManualGuidesChange,
  rowBands,
  onRowBandsChange,
  savedManualCropLoaded,
}: {
  file: File;
  inspection: PowerScribeCapturePrecheck;
  manualGuides: PowerScribeManualColumnGuides | null;
  onManualGuidesChange: (guides: PowerScribeManualColumnGuides | null) => void;
  rowBands: PowerScribeRowBand[] | null;
  onRowBandsChange: (bands: PowerScribeRowBand[] | null) => void;
  savedManualCropLoaded: boolean;
}) {
  const [url, setUrl] = useState('');
  const [draggingGuide, setDraggingGuide] = useState<keyof PowerScribeManualColumnGuides | null>(null);
  const [draggingRowBoundary, setDraggingRowBoundary] = useState<number | null>(null);
  const [detectingRows, setDetectingRows] = useState(false);
  const [rowDetectionMessage, setRowDetectionMessage] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);

  const manualColumns = manualGuides ? powerScribeManualColumnsFromGuides(manualGuides) : null;
  const overlays = manualColumns
    ? [
        { name: 'procedure' as const, label: 'Procedure', color: '#2563eb', fill: 'rgba(37, 99, 235, 0.12)' },
        { name: 'examDate' as const, label: 'Exam Date', color: '#d97706', fill: 'rgba(217, 119, 6, 0.12)' },
        { name: 'modifiedDate' as const, label: 'Modified', color: '#059669', fill: 'rgba(5, 150, 105, 0.12)' },
      ]
    : [];

  function updateGuide(name: keyof PowerScribeManualColumnGuides, nextValue: number) {
    if (!manualGuides) return;
    const next = { ...manualGuides };
    if (name === 'left') next.left = Math.max(0, Math.min(nextValue, next.procedureEnd - 0.05));
    if (name === 'procedureEnd') next.procedureEnd = Math.max(next.left + 0.05, Math.min(nextValue, next.examEnd - 0.05));
    if (name === 'examEnd') next.examEnd = Math.max(next.procedureEnd + 0.05, Math.min(nextValue, next.right - 0.05));
    if (name === 'right') next.right = Math.max(next.examEnd + 0.05, Math.min(1, nextValue));
    if (name === 'top') next.top = Math.max(0, Math.min(nextValue, next.bottom - 0.1));
    if (name === 'bottom') next.bottom = Math.max(next.top + 0.1, Math.min(1, nextValue));
    onManualGuidesChange(next);
  }

  const rowBoundaries = rowBands?.length
    ? [rowBands[0].top, ...rowBands.map((band) => band.bottom)]
    : [];

  function updateRowBoundary(index: number, nextValue: number) {
    if (!rowBands?.length) return;
    const boundaries = [...rowBoundaries];
    const minimumGap = 0.004;
    const minimum = index === 0 ? 0 : boundaries[index - 1] + minimumGap;
    const maximum = index === boundaries.length - 1 ? 1 : boundaries[index + 1] - minimumGap;
    boundaries[index] = Math.max(minimum, Math.min(maximum, nextValue));
    onRowBandsChange(boundaries.slice(0, -1).map((top, rowIndex) => ({
      top,
      bottom: boundaries[rowIndex + 1],
    })));
  }

  function removeRowBoundary(index: number) {
    if (!rowBands?.length || index <= 0 || index >= rowBoundaries.length - 1) return;
    const boundaries = rowBoundaries.filter((_, boundaryIndex) => boundaryIndex !== index);
    onRowBandsChange(boundaries.slice(0, -1).map((top, rowIndex) => ({
      top,
      bottom: boundaries[rowIndex + 1],
    })));
  }

  async function startRowAdjustment() {
    const guides = manualGuides ?? inspection.suggestedManualGuides ?? DEFAULT_POWERSCRIBE_MANUAL_COLUMN_GUIDES;
    setDetectingRows(true);
    setRowDetectionMessage(null);
    try {
      const detected = await detectPowerScribeRowBands(file, powerScribeManualColumnsFromGuides(guides));
      if (detected.length < 2) {
        onRowBandsChange(null);
        setRowDetectionMessage('Rows were not clear enough to separate. Tighten the column crop and try again.');
        return;
      }
      if (!manualGuides) onManualGuidesChange({ ...guides });
      onRowBandsChange(detected);
      setRowDetectionMessage(`${detected.length} row crops detected. Drag a horizontal divider to correct it.`);
    } finally {
      setDetectingRows(false);
    }
  }

  const guideHandles: Array<{
    name: keyof PowerScribeManualColumnGuides;
    label: string;
    orientation: 'vertical' | 'horizontal';
    color: string;
  }> = manualGuides
    ? [
        { name: 'top', label: 'Top of rows', orientation: 'horizontal', color: '#e11d48' },
        { name: 'bottom', label: 'Bottom of rows', orientation: 'horizontal', color: '#e11d48' },
        { name: 'left', label: 'Procedure left edge', orientation: 'vertical', color: '#2563eb' },
        { name: 'procedureEnd', label: 'Procedure / Exam divider', orientation: 'vertical', color: '#d97706' },
        { name: 'examEnd', label: 'Exam / Modified divider', orientation: 'vertical', color: '#059669' },
        { name: 'right', label: 'Modified right edge', orientation: 'vertical', color: '#059669' },
      ]
    : [];

  function updateGuideFromPointer(name: keyof PowerScribeManualColumnGuides, event: ReactPointerEvent<HTMLButtonElement>) {
    const bounds = previewRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const horizontalGuide = name === 'top' || name === 'bottom';
    const nextValue = horizontalGuide
      ? (event.clientY - bounds.top) / bounds.height
      : (event.clientX - bounds.left) / bounds.width;
    updateGuide(name, nextValue);
  }

  function handleGuideKeyDown(name: keyof PowerScribeManualColumnGuides, event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (!manualGuides) return;
    const horizontalGuide = name === 'top' || name === 'bottom';
    const decreaseKey = horizontalGuide ? 'ArrowUp' : 'ArrowLeft';
    const increaseKey = horizontalGuide ? 'ArrowDown' : 'ArrowRight';
    if (event.key !== decreaseKey && event.key !== increaseKey) return;
    event.preventDefault();
    const direction = event.key === increaseKey ? 1 : -1;
    updateGuide(name, manualGuides[name] + direction * (event.shiftKey ? 0.01 : 0.0025));
  }

  function rowValueFromPointer(event: ReactPointerEvent<HTMLElement>): number | null {
    const bounds = previewRef.current?.getBoundingClientRect();
    if (!bounds) return null;
    return (event.clientY - bounds.top) / bounds.height;
  }

  function splitRowAtPointer(event: ReactPointerEvent<HTMLDivElement>) {
    if (!rowBands?.length || event.detail < 2) return;
    const value = rowValueFromPointer(event);
    if (value == null) return;
    const rowIndex = rowBands.findIndex((band) => value > band.top + 0.004 && value < band.bottom - 0.004);
    if (rowIndex < 0) return;
    event.preventDefault();
    const next = [...rowBands];
    const band = next[rowIndex];
    next.splice(rowIndex, 1, { top: band.top, bottom: value }, { top: value, bottom: band.bottom });
    onRowBandsChange(normalizePowerScribeRowBands(next));
  }
  const previewWidth = manualGuides
    ? 'min(100%, 960px)'
    : `min(100%, ${(320 * inspection.width) / inspection.height}px)`;

  return (
    <div className="space-y-3">
      <div
        ref={previewRef}
        onPointerUp={splitRowAtPointer}
        className="relative mx-auto overflow-hidden rounded-[10px] border border-rd-separator bg-black/5"
        style={{ aspectRatio: `${inspection.width} / ${inspection.height}`, width: previewWidth }}
      >
        {url && <img src={url} alt="Capture waiting for review" draggable={false} className="absolute inset-0 size-full select-none object-contain" />}
        {!manualColumns && inspection.tableRect && (
          <span
            aria-label="Detected table region"
            className="pointer-events-none absolute border-2 border-rd-positive bg-rd-positive/10"
            style={{
              left: `${inspection.tableRect.x * 100}%`,
              top: `${inspection.tableRect.y * 100}%`,
              width: `${inspection.tableRect.width * 100}%`,
              height: `${inspection.tableRect.height * 100}%`,
            }}
          />
        )}
        {overlays.map((overlay) => {
          const rect = manualColumns![overlay.name];
          return (
            <span
              key={overlay.name}
              aria-label={`Manual ${overlay.label} crop`}
              className="pointer-events-none absolute border-2"
              style={{
                left: `${rect.x * 100}%`,
                top: `${rect.y * 100}%`,
                width: `${rect.width * 100}%`,
                height: `${rect.height * 100}%`,
                borderColor: overlay.color,
                backgroundColor: overlay.fill,
              }}
            >
              <span className="absolute left-0 top-0 bg-black/70 px-1 py-0.5 text-[9px] font-semibold text-white">
                {overlay.label}
              </span>
            </span>
          );
        })}
        {rowBands?.map((band, index) => (
          <span
            key={`row-band-${index}`}
            aria-label={`Row crop ${index + 1}`}
            className="pointer-events-none absolute z-10 border-y border-rose-500/60"
            style={{
              left: `${(manualGuides?.left ?? inspection.tableRect?.x ?? 0) * 100}%`,
              top: `${band.top * 100}%`,
              width: `${((manualGuides?.right ?? ((inspection.tableRect?.x ?? 0) + (inspection.tableRect?.width ?? 1))) - (manualGuides?.left ?? inspection.tableRect?.x ?? 0)) * 100}%`,
              height: `${(band.bottom - band.top) * 100}%`,
              backgroundColor: index % 2 === 0 ? 'rgba(225, 29, 72, 0.035)' : 'rgba(225, 29, 72, 0.075)',
            }}
          />
        ))}
        {manualGuides && guideHandles.filter((handle) => !rowBands?.length || handle.orientation === 'vertical').map((handle) => {
          const vertical = handle.orientation === 'vertical';
          const active = draggingGuide === handle.name;
          return (
            <button
              key={handle.name}
              type="button"
              aria-label={`${handle.label}, ${Math.round(manualGuides[handle.name] * 100)} percent. Drag to adjust.`}
              title={`${handle.label} · drag to adjust`}
              onPointerDown={(event) => {
                event.preventDefault();
                event.currentTarget.setPointerCapture(event.pointerId);
                setDraggingGuide(handle.name);
                updateGuideFromPointer(handle.name, event);
              }}
              onPointerMove={(event) => {
                if (draggingGuide === handle.name) updateGuideFromPointer(handle.name, event);
              }}
              onPointerUp={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                setDraggingGuide(null);
              }}
              onPointerCancel={() => setDraggingGuide(null)}
              onKeyDown={(event) => handleGuideKeyDown(handle.name, event)}
              className="absolute z-20 rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              style={vertical
                ? {
                    left: `${manualGuides[handle.name] * 100}%`,
                    top: `${manualGuides.top * 100}%`,
                    width: '24px',
                    height: `${(manualGuides.bottom - manualGuides.top) * 100}%`,
                    transform: 'translateX(-50%)',
                    cursor: 'col-resize',
                    touchAction: 'none',
                  }
                : {
                    left: `${manualGuides.left * 100}%`,
                    top: `${manualGuides[handle.name] * 100}%`,
                    width: `${(manualGuides.right - manualGuides.left) * 100}%`,
                    height: '24px',
                    transform: 'translateY(-50%)',
                    cursor: 'row-resize',
                    touchAction: 'none',
                  }}
            >
              <span
                className="pointer-events-none absolute rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.7)]"
                style={vertical
                  ? { left: '10px', top: 0, width: '4px', height: '100%', backgroundColor: handle.color }
                  : { left: 0, top: '10px', width: '100%', height: '4px', backgroundColor: handle.color }}
              />
              <span
                className="pointer-events-none absolute rounded border-2 border-white shadow-[0_1px_3px_rgba(0,0,0,0.65)]"
                style={vertical
                  ? { left: '5px', top: '50%', width: '14px', height: '28px', transform: 'translateY(-50%)', backgroundColor: handle.color }
                  : { left: '50%', top: '5px', width: '28px', height: '14px', transform: 'translateX(-50%)', backgroundColor: handle.color }}
              />
              <span className="sr-only">{active ? `Adjusting ${handle.label}` : handle.label}</span>
            </button>
          );
        })}
        {manualGuides && rowBands?.length && rowBoundaries.map((boundary, index) => (
          <button
            key={`row-boundary-${index}`}
            type="button"
            aria-label={`Row boundary ${index + 1} of ${rowBoundaries.length}, ${Math.round(boundary * 100)} percent. Drag to adjust${index > 0 && index < rowBoundaries.length - 1 ? ', or double click to merge rows' : ''}.`}
            title={index > 0 && index < rowBoundaries.length - 1 ? 'Drag to adjust · double-click to merge rows' : 'Drag to adjust'}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              event.currentTarget.setPointerCapture(event.pointerId);
              setDraggingRowBoundary(index);
              const value = rowValueFromPointer(event);
              if (value != null) updateRowBoundary(index, value);
            }}
            onPointerMove={(event) => {
              if (draggingRowBoundary !== index) return;
              const value = rowValueFromPointer(event);
              if (value != null) updateRowBoundary(index, value);
            }}
            onPointerUp={(event) => {
              event.stopPropagation();
              if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
              setDraggingRowBoundary(null);
            }}
            onDoubleClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              removeRowBoundary(index);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                event.preventDefault();
                updateRowBoundary(index, boundary + (event.key === 'ArrowDown' ? 1 : -1) * (event.shiftKey ? 0.01 : 0.0025));
              } else if (event.key === 'Delete' || event.key === 'Backspace') {
                event.preventDefault();
                removeRowBoundary(index);
              }
            }}
            className="absolute z-30 rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            style={{
              left: `${manualGuides.left * 100}%`,
              top: `${boundary * 100}%`,
              width: `${(manualGuides.right - manualGuides.left) * 100}%`,
              height: '10px',
              transform: 'translateY(-50%)',
              cursor: 'row-resize',
              touchAction: 'none',
            }}
          >
            <span className="pointer-events-none absolute left-0 top-[3px] h-1 w-full rounded-full border border-white bg-rose-600 shadow-[0_0_0_1px_rgba(0,0,0,0.55)]" />
            <span className="pointer-events-none absolute left-1/2 top-0 h-[10px] w-5 -translate-x-1/2 rounded border border-white bg-rose-600 shadow" />
          </button>
        ))}
      </div>
      <p className="text-[12px] text-rd-label-secondary">
        {inspection.width} × {inspection.height} · {manualColumns
          ? rowBands?.length
            ? `${rowBands.length} geometric row crops will be applied before OCR.`
            : 'Drag the crop edges so each colored band contains only its named column.'
          : inspection.kind === 'report'
          ? 'This looks like a PowerScribe report; only the outlined EXAMINATION header will be read.'
          : inspection.detected
          ? 'This looks like a PowerScribe worklist; the outlined region is the candidate table.'
          : 'No table outline was detected. If this is the PowerScribe worklist, you can still process it for review.'}
      </p>
      {inspection.detected && inspection.kind !== 'report' && (
        <button
          type="button"
          onClick={() => {
            onRowBandsChange(null);
            onManualGuidesChange(
              manualGuides
                ? null
                : { ...(inspection.suggestedManualGuides ?? DEFAULT_POWERSCRIBE_MANUAL_COLUMN_GUIDES) },
            );
          }}
          className="min-h-9 rounded-[8px] border border-rd-separator bg-rd-surface px-3 text-[12px] font-medium text-rd-label-primary"
        >
          {manualGuides ? (savedManualCropLoaded ? 'Reset saved crop' : 'Use detected crop') : 'Adjust crop'}
        </button>
      )}
      {inspection.kind !== 'report' && (manualGuides || inspection.suggestedManualGuides) && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void startRowAdjustment()}
            disabled={detectingRows}
            className="min-h-9 rounded-[8px] border border-rose-500/50 bg-rose-500/10 px-3 text-[12px] font-medium text-rd-label-primary disabled:opacity-50"
          >
            {detectingRows ? 'Detecting rows…' : rowBands?.length ? 'Redetect rows' : 'Adjust rows'}
          </button>
          {rowBands?.length ? (
            <button
              type="button"
              onClick={() => {
                onRowBandsChange(null);
                setRowDetectionMessage(null);
              }}
              className="min-h-9 rounded-[8px] border border-rd-separator bg-rd-surface px-3 text-[12px] font-medium text-rd-label-secondary"
            >
              Clear row edits
            </button>
          ) : null}
        </div>
      )}
      {rowDetectionMessage && <p className="text-[11px] text-rd-label-secondary">{rowDetectionMessage}</p>}
      {manualGuides && (
        <div className="space-y-2" aria-label="Manual PowerScribe column crop controls">
          <p className="text-[12px] font-medium text-rd-label-primary">
            {rowBands?.length
              ? 'Drag rose dividers to resize rows. Double-click inside a row to split it; double-click a divider to merge.'
              : 'Step 1: drag the colored column edges. Step 2: choose Adjust rows.'}
          </p>
          <div className="flex flex-wrap gap-1.5 text-[10px] text-rd-label-secondary">
            {guideHandles.filter((handle) => !rowBands?.length || handle.orientation === 'vertical').map((handle) => (
              <span key={handle.name} className="rounded-full border border-rd-separator bg-rd-surface px-2 py-1">
                <span className="mr-1 inline-block size-2 rounded-full" style={{ backgroundColor: handle.color }} />
                {handle.label} {Math.round(manualGuides[handle.name] * 100)}%
              </span>
            ))}
            {rowBands?.length ? (
              <span className="rounded-full border border-rose-500/40 bg-rose-500/10 px-2 py-1 font-medium text-rd-label-primary">
                {rowBands.length} rows
              </span>
            ) : null}
          </div>
          <p className="text-[11px] text-rd-label-secondary">
            {savedManualCropLoaded
              ? `Saved crop applied for ${inspection.width} × ${inspection.height}. Drag to update it; changes are saved after Process.`
              : `This crop will be reused for future ${inspection.width} × ${inspection.height} captures after Process.`}
          </p>
        </div>
      )}
      {savedManualCropLoaded && !manualGuides && (
        <p className="text-[11px] text-rd-label-secondary">
          The saved crop will be cleared after Process; the detected table will be used instead.
        </p>
      )}
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
  const [capturePreview, setCapturePreview] = useState<PowerScribeCapturePrecheck | null>(null);
  const capturePreviewRef = useRef<PowerScribeCapturePrecheck | null>(null);
  const [manualCropGuides, setManualCropGuides] = useState<PowerScribeManualColumnGuides | null>(null);
  const [manualRowBands, setManualRowBands] = useState<PowerScribeRowBand[] | null>(null);
  const [savedManualCropLoaded, setSavedManualCropLoaded] = useState(false);
  const [ocrDebug, setOcrDebug] = useState<ProcessedImportResult['ocrDebug']>(null);
  // Eagerly generated (not lazily inside the persist effect below) so that
  // effect only ever runs once per actual state change instead of twice per
  // batch — the second, self-triggered run used to just overwrite the same
  // Dexie row a second time, which was harmless, but now that persisting a
  // session can also commit rows with no review needed (see
  // reviewSessionService.sweepQuietRows), a guaranteed extra run would have
  // double-committed them.
  const [sessionId, setSessionId] = useState<string>(() => crypto.randomUUID());
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
    loadActiveReviewSession(activeProfile?.id ?? null, activePractice?.id ?? null).then((session) => {
      if (!session || reviewRows.length > 0) return;
      setSessionId(session.sessionId);
      setReviewRows(session.rows);
      setSkippedRows(session.skippedRows);
      setTimeline(session.timeline);
      setLogDate(session.readingDate);
      setStep('review');
    });
  }, [activeProfile?.id, activePractice?.id]);

  useEffect(() => {
    if (step !== 'review' || reviewRows.length === 0) return;
    void persistActiveReviewSession({
      sessionId,
      profileId: activeProfile?.id ?? null,
      siteId: activePractice?.id ?? null,
      readingDate: logDate,
      rows: reviewRows,
      skippedRows,
      timeline,
    }).then(onReviewReady);
  }, [step, reviewRows, skippedRows, timeline, logDate, activeProfile?.id, activePractice?.id, sessionId, onReviewReady]);

  useEffect(() => {
    processingRef.current = processing;
  }, [processing]);

  useEffect(() => {
    if (!clipboardFile || processing) return;
    function handlePreviewKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setClipboardFile(null);
        setCapturePreview(null);
        capturePreviewRef.current = null;
        setManualCropGuides(null);
        setManualRowBands(null);
        setSavedManualCropLoaded(false);
        lastClipboardImageHashRef.current = null;
      } else if (event.key === 'Enter') {
        event.preventDefault();
        void processPowerScribeCapture(
          clipboardFile!,
          'confirmed preview',
          manualCropGuides ? powerScribeManualColumnsFromGuides(manualCropGuides) : null,
          manualRowBands,
          manualCropGuides,
          savedManualCropLoaded && !manualCropGuides,
        );
      }
    }
    window.addEventListener('keydown', handlePreviewKey);
    return () => window.removeEventListener('keydown', handlePreviewKey);
  }, [clipboardFile, processing, manualCropGuides, manualRowBands, savedManualCropLoaded]);

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

  async function processOcrFile(
    file: File,
    timelineSource: string,
    manualColumnCrops: PowerScribeManualColumnCrops | null = null,
    manualRows: PowerScribeRowBand[] | null = null,
    manualGuidesToSave: PowerScribeManualColumnGuides | null = null,
    clearSavedManualCrop = false,
  ) {
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
      }, {
        filename: file.name,
        size: file.size,
        manualColumnCrops,
        manualColumnGuidesToSave: manualGuidesToSave,
        clearSavedManualColumnGuides: clearSavedManualCrop,
        manualRowBands: manualRows,
      });
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

  async function processPowerScribeCapture(
    file: File,
    timelineSource: string,
    manualColumnCrops: PowerScribeManualColumnCrops | null = null,
    manualRows: PowerScribeRowBand[] | null = null,
    manualGuidesToSave: PowerScribeManualColumnGuides | null = null,
    clearSavedManualCrop = false,
  ) {
    if (processingRef.current) return;
    const inspection = capturePreviewRef.current ?? capturePreview;
    capturePreviewRef.current = null;
    setProcessing(true);
    setError(null);
    if (inspection?.kind !== 'report') setOcrFile(file);
    setClipboardFile(null);
    setCapturePreview(null);
    setManualCropGuides(null);
    setManualRowBands(null);
    setSavedManualCropLoaded(false);
    pushToast('info', 'Processing PowerScribe capture...', 'Extracting studies and preparing the review list.');
    try {
      if (inspection?.kind === 'report' && inspection.reportHeader) {
        const processed = await processReportCaptureImport(
          inspection.reportHeader,
          inspection.ocrConfidence ?? 0,
          {
            profileId: activeProfile?.id ?? null,
            siteId: activePractice?.id ?? null,
            sessionId,
            logDate,
          },
        );
        appendPipelineRows(processed.result.reviewRows, processed.result.skippedRows, `${processed.timelineLabel} from ${timelineSource}`);
        const autoCounted = processed.result.reviewRows.some((row) => row.autoApproved);
        pushToast(
          autoCounted ? 'success' : 'info',
          autoCounted ? 'Known report counted' : 'Report capture added to Inbox',
          'Only the EXAMINATION header region was read; the report image was not saved.',
        );
        return;
      }
      const usedStructuredHelper = manualColumnCrops
        ? false
        : await processWindowsClipboardCapture(file, timelineSource);
      if (!usedStructuredHelper) {
        await processOcrFile(file, timelineSource, manualColumnCrops, manualRows, manualGuidesToSave, clearSavedManualCrop);
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
    const preview = await inspectScreenshotCapture(file);
    capturePreviewRef.current = preview;
    const settings = await db.userSettings.get('default');
    const cropKey = activeProfile?.id ?? 'default';
    const savedManualGuides = preview.kind === 'worklist' ? getSavedPowerScribeManualGuides(
      settings?.savedPowerScribeCropRegions?.[cropKey],
      preview.width,
      preview.height,
    ) : null;
    if (shouldAutoProcessRecognizedCapture(preview.detected, settings)) {
      pushToast(
        'success',
        'PowerScribe table detected — processing automatically',
        `${preview.width} × ${preview.height} · ${savedManualGuides ? 'saved crop applied.' : 'outlined table region accepted.'}`,
      );
      await processPowerScribeCapture(
        file,
        `${timelineSource} (auto-process)`,
        savedManualGuides ? powerScribeManualColumnsFromGuides(savedManualGuides) : null,
        null,
        savedManualGuides,
      );
      return;
    }
    setCapturePreview(preview);
    setManualCropGuides(preview.kind === 'report' ? null : savedManualGuides ?? (preview.detected ? null : { ...DEFAULT_POWERSCRIBE_MANUAL_COLUMN_GUIDES }));
    setManualRowBands(null);
    setSavedManualCropLoaded(Boolean(savedManualGuides));
    setClipboardFile(file);
    pushToast(
      preview.detected ? 'success' : 'warning',
      preview.kind === 'report' ? 'PowerScribe report detected' : preview.detected ? 'PowerScribe reports table detected' : 'PowerScribe capture type uncertain',
      'Review the image, then press Enter to process or Esc to discard.',
    );
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
              <p className="text-[13px] font-semibold text-rd-label-primary">Review capture before processing</p>
              <p className="text-[12px] text-rd-label-secondary">
                {capturePreview?.kind === 'report'
                  ? 'Only the local EXAMINATION-header pre-check has run—no matching, commit, or saved data yet. '
                  : 'Only the local table pre-check has run—no import pipeline or saved data yet. '}
                {CAPTURE_PRIVACY_COPY}
              </p>
              {capturePreview && (
                <CapturePreview
                  file={clipboardFile}
                  inspection={capturePreview}
                  manualGuides={manualCropGuides}
                  onManualGuidesChange={setManualCropGuides}
                  rowBands={manualRowBands}
                  onRowBandsChange={setManualRowBands}
                  savedManualCropLoaded={savedManualCropLoaded}
                />
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => processPowerScribeCapture(
                    clipboardFile,
                    'confirmed preview',
                    manualCropGuides ? powerScribeManualColumnsFromGuides(manualCropGuides) : null,
                    manualRowBands,
                    manualCropGuides,
                    savedManualCropLoaded && !manualCropGuides,
                  )}
                  disabled={processing}
                  className="min-h-11 rounded-[10px] bg-rd-label-primary px-3 text-[13px] font-semibold text-rd-bg disabled:opacity-40"
                >
                  Process <span className="ml-1 opacity-70">Enter</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setClipboardFile(null);
                    setCapturePreview(null);
                    capturePreviewRef.current = null;
                    setManualCropGuides(null);
                    setManualRowBands(null);
                    setSavedManualCropLoaded(false);
                    lastClipboardImageHashRef.current = null;
                  }}
                  disabled={processing}
                  className="min-h-11 px-2 text-[13px] text-rd-label-secondary disabled:opacity-40"
                >
                  Discard <span className="ml-1 opacity-70">Esc</span>
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
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void queueClipboardImage(file, 'file upload');
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className={cn(
                'w-full cursor-pointer rounded-[16px] border-2 border-dashed p-8 text-center transition-colors',
                clipboardFile ? 'border-rd-label-primary bg-rd-surface-2' : 'border-rd-separator hover:bg-rd-surface-2',
              )}
            >
              {clipboardFile ? (
                <div>
                  <p className="font-medium text-rd-label-primary">{clipboardFile.name}</p>
                  <p className="mt-1 text-[12px] text-rd-label-secondary">
                    {(clipboardFile.size / 1024).toFixed(0)} KB · Waiting for review
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
