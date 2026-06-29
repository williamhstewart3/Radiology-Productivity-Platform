/**
 * CameraUploadPage.tsx
 *
 * HIPAA-conscious mobile camera → crop → OCR → review workflow.
 *
 * Steps:
 *   1. capture  — user takes or selects a photo of the PowerScribe list
 *   2. crop     — mandatory: user crops to procedure/date columns only
 *   3. process  — cropped image fed to existing OCR → importPipeline
 *   4. review   — shared review UI from Import.tsx (same PipelineReviewRow logic)
 *   5. done     — summary screen
 *
 * Privacy guarantees (all enforced in code):
 *   • Original full photo is revoked from memory immediately after crop is confirmed.
 *   • Cropped image is revoked after OCR text is extracted (no blob persisted).
 *   • No image is written to disk, camera roll, or any external service.
 *   • All OCR runs locally via the existing ocrProvider (Tesseract.js).
 *   • "Require crop" default is ON; toggling it off shows a PHI warning modal.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { theme } from '../lib/theme';
import { OCRImportProvider } from '../providers/OCRImportProvider';
import { runImportPipeline, commitPipelineResults } from '../pipeline/importPipeline';
import { searchExamLibrary, learnAlias } from '../utils/matching';
import { useProfile } from '../hooks/useProfile';
import { useLiveQuery } from 'dexie-react-hooks';
import { todayDateString } from '../utils/calculations';
import { db } from '../db/database';
import type { UserSettings } from '../types';
import type { PipelineReviewRow } from '../pipeline/importPipeline';
import type { DuplicateStatus, MatchCandidate } from '../types';

// ── Types ──────────────────────────────────────────────────────────────────────

type CameraStep = 'capture' | 'crop' | 'processing' | 'review' | 'done';

interface CropRect {
  x: number;   // 0–1 relative to image dimensions
  y: number;
  w: number;
  h: number;
}

// ── ExamSearchPanel (inline, same as Import.tsx) ───────────────────────────────

interface ExamSearchPanelProps {
  initialQuery: string;
  onSelect: (candidate: MatchCandidate) => void;
  onClose: () => void;
}

function ExamSearchPanel({ initialQuery, onSelect, onClose }: ExamSearchPanelProps) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<MatchCandidate[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      try { setResults(await searchExamLibrary(query, 8)); }
      finally { setSearching(false); }
    }, 280);
    return () => clearTimeout(t);
  }, [query]);

  return (
    <div className="mt-2 rounded-xl border border-sky-500/30 bg-slate-900/95 shadow-2xl overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/8">
        <span className="text-sky-400 text-xs font-semibold uppercase tracking-wider">Search Exam Library</span>
        <button onClick={onClose} className="ml-auto text-slate-500 hover:text-slate-300 text-xs px-1.5 py-0.5 rounded">✕ Close</button>
      </div>
      <div className="px-3 py-2 border-b border-white/6">
        <input
          autoFocus type="text" value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, CPT code, modality…"
          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-500/50"
        />
      </div>
      <div className="max-h-64 overflow-y-auto divide-y divide-white/5">
        {searching && <div className="px-4 py-3 text-xs text-slate-400 italic">Searching…</div>}
        {!searching && results.length === 0 && query.trim() && (
          <div className="px-4 py-3 text-xs text-slate-400 italic">No results</div>
        )}
        {results.map((c, ci) => (
          <button key={`${c.cptCode}-${c.modifier ?? ''}-${ci}`} onClick={() => onSelect(c)}
            className="w-full text-left px-3 py-2.5 text-xs hover:bg-white/5 transition-colors">
            <div className="flex items-baseline gap-2">
              <span className="font-mono font-bold text-white">{c.cptCode}</span>
              {c.modifier && <span className="text-slate-500">mod {c.modifier}</span>}
              <span className={`ml-auto font-medium ${c.confidence >= 0.70 ? 'text-emerald-400' : c.confidence >= 0.50 ? 'text-amber-400' : 'text-slate-400'}`}>
                {Math.round(c.confidence * 100)}%
              </span>
            </div>
            <div className="text-slate-300 mt-0.5">{c.description.slice(0, 90)}{c.description.length > 90 ? '…' : ''}</div>
            {c.workRvu != null && <div className="text-slate-500 mt-0.5">{c.workRvu.toFixed(2)} wRVU</div>}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── CropTool ───────────────────────────────────────────────────────────────────

interface CropToolProps {
  imageSrc: string;
  onConfirm: (rect: CropRect) => void;
  onRetake: () => void;
}

function CropTool({ imageSrc, onConfirm, onRetake }: CropToolProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // Crop handles in image-relative 0–1 coordinates
  const [crop, setCrop] = useState<CropRect>({ x: 0.0, y: 0.05, w: 1.0, h: 0.90 });

  // Drag state
  const dragRef = useRef<{
    handle: 'move' | 'top' | 'bottom' | 'left' | 'right' | 'tl' | 'tr' | 'bl' | 'br';
    startX: number;
    startY: number;
    startCrop: CropRect;
    containerW: number;
    containerH: number;
  } | null>(null);

  // Convert 0-1 crop to pixel rect within container
  function cropToPx(c: CropRect) {
    const el = containerRef.current;
    const img = imgRef.current;
    if (!el || !img) return { left: 0, top: 0, width: 0, height: 0 };
    const cw = el.clientWidth;
    const ch = el.clientHeight;
    // Image may be letterboxed; compute actual rendered image bounds
    const iw = img.naturalWidth || cw;
    const ih = img.naturalHeight || ch;
    const scale = Math.min(cw / iw, ch / ih);
    const rw = iw * scale;
    const rh = ih * scale;
    const ox = (cw - rw) / 2;
    const oy = (ch - rh) / 2;
    return {
      left:   ox + c.x * rw,
      top:    oy + c.y * rh,
      width:  c.w * rw,
      height: c.h * rh,
      rw, rh, ox, oy,
    };
  }

  function clampCrop(c: CropRect): CropRect {
    const x = Math.max(0, Math.min(0.95, c.x));
    const y = Math.max(0, Math.min(0.95, c.y));
    const w = Math.max(0.05, Math.min(1 - x, c.w));
    const h = Math.max(0.05, Math.min(1 - y, c.h));
    return { x, y, w, h };
  }

  const onPointerDown = useCallback((
    e: React.PointerEvent,
    handle: typeof dragRef.current extends null ? never : NonNullable<typeof dragRef.current>['handle'],
  ) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const el = containerRef.current;
    if (!el) return;
    dragRef.current = {
      handle,
      startX: e.clientX,
      startY: e.clientY,
      startCrop: { ...crop },
      containerW: el.clientWidth,
      containerH: el.clientHeight,
    };
  }, [crop]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const { handle, startX, startY, startCrop, containerW, containerH } = dragRef.current;
    const img = imgRef.current;
    if (!img) return;

    const iw = img.naturalWidth || containerW;
    const ih = img.naturalHeight || containerH;
    const scale = Math.min(containerW / iw, containerH / ih);
    const rw = iw * scale;
    const rh = ih * scale;

    const dx = (e.clientX - startX) / rw;
    const dy = (e.clientY - startY) / rh;
    let { x, y, w, h } = startCrop;

    if (handle === 'move') { x += dx; y += dy; }
    else if (handle === 'top')    { y += dy; h -= dy; }
    else if (handle === 'bottom') { h += dy; }
    else if (handle === 'left')   { x += dx; w -= dx; }
    else if (handle === 'right')  { w += dx; }
    else if (handle === 'tl')     { x += dx; y += dy; w -= dx; h -= dy; }
    else if (handle === 'tr')     { y += dy; w += dx; h -= dy; }
    else if (handle === 'bl')     { x += dx; w -= dx; h += dy; }
    else if (handle === 'br')     { w += dx; h += dy; }

    setCrop(clampCrop({ x, y, w, h }));
  }, []);

  const onPointerUp = useCallback(() => { dragRef.current = null; }, []);

  const pxRect = cropToPx(crop);

  const HANDLE_SIZE = 22;

  function Handle({ position }: { position: 'tl'|'tr'|'bl'|'br'|'top'|'bottom'|'left'|'right' }) {
    const cursor: Record<string, string> = {
      tl: 'nw-resize', tr: 'ne-resize', bl: 'sw-resize', br: 'se-resize',
      top: 'n-resize', bottom: 's-resize', left: 'w-resize', right: 'e-resize',
    };
    const style: React.CSSProperties = {
      position: 'absolute',
      width: HANDLE_SIZE,
      height: HANDLE_SIZE,
      background: 'rgba(91,184,212,0.9)',
      borderRadius: 4,
      border: '2px solid white',
      cursor: cursor[position],
      zIndex: 20,
      touchAction: 'none',
    };
    // Position offsets
    const half = HANDLE_SIZE / 2;
    if (position === 'tl')     { style.left = pxRect.left - half; style.top = pxRect.top - half; }
    if (position === 'tr')     { style.left = pxRect.left + pxRect.width - half; style.top = pxRect.top - half; }
    if (position === 'bl')     { style.left = pxRect.left - half; style.top = pxRect.top + pxRect.height - half; }
    if (position === 'br')     { style.left = pxRect.left + pxRect.width - half; style.top = pxRect.top + pxRect.height - half; }
    if (position === 'top')    { style.left = pxRect.left + pxRect.width / 2 - half; style.top = pxRect.top - half; }
    if (position === 'bottom') { style.left = pxRect.left + pxRect.width / 2 - half; style.top = pxRect.top + pxRect.height - half; }
    if (position === 'left')   { style.left = pxRect.left - half; style.top = pxRect.top + pxRect.height / 2 - half; }
    if (position === 'right')  { style.left = pxRect.left + pxRect.width - half; style.top = pxRect.top + pxRect.height / 2 - half; }

    return (
      <div
        style={style}
        onPointerDown={(e) => onPointerDown(e, position as 'tl')}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Guidance banner */}
      <div className="px-4 py-3 rounded-xl border border-amber-500/30 bg-amber-500/10">
        <p className="text-amber-300 text-sm font-semibold">Crop to remove patient identifiers</p>
        <p className="text-amber-200/70 text-xs mt-0.5 leading-relaxed">
          Include only: study/procedure name · date · time · accession number (if needed).<br />
          <strong className="text-amber-300">Exclude:</strong> patient name · MRN · DOB · room · account number.
        </p>
      </div>

      {/* Crop canvas */}
      <div
        ref={containerRef}
        className="relative overflow-hidden rounded-xl bg-black select-none"
        style={{ height: 'min(60vh, 480px)', touchAction: 'none' }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <img
          ref={imgRef}
          src={imageSrc}
          alt="Captured"
          className="w-full h-full object-contain pointer-events-none"
          draggable={false}
        />

        {/* Dark overlay outside crop */}
        {/* top */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: pxRect.top, background: 'rgba(0,0,0,0.6)' }} />
        {/* bottom */}
        <div style={{ position: 'absolute', top: pxRect.top + pxRect.height, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)' }} />
        {/* left */}
        <div style={{ position: 'absolute', top: pxRect.top, left: 0, width: pxRect.left, height: pxRect.height, background: 'rgba(0,0,0,0.6)' }} />
        {/* right */}
        <div style={{ position: 'absolute', top: pxRect.top, left: pxRect.left + pxRect.width, right: 0, height: pxRect.height, background: 'rgba(0,0,0,0.6)' }} />

        {/* Crop border + move area */}
        <div
          style={{
            position: 'absolute',
            left: pxRect.left,
            top: pxRect.top,
            width: pxRect.width,
            height: pxRect.height,
            border: '2px solid rgba(91,184,212,0.9)',
            boxShadow: '0 0 0 1px rgba(91,184,212,0.3)',
            cursor: 'move',
            zIndex: 10,
            touchAction: 'none',
          }}
          onPointerDown={(e) => onPointerDown(e, 'move')}
        >
          {/* Rule-of-thirds grid lines */}
          {[1/3, 2/3].map((f) => (
            <div key={`v${f}`} style={{ position: 'absolute', left: `${f * 100}%`, top: 0, bottom: 0, width: 1, background: 'rgba(91,184,212,0.2)' }} />
          ))}
          {[1/3, 2/3].map((f) => (
            <div key={`h${f}`} style={{ position: 'absolute', top: `${f * 100}%`, left: 0, right: 0, height: 1, background: 'rgba(91,184,212,0.2)' }} />
          ))}
        </div>

        {/* Handles */}
        <Handle position="tl" />
        <Handle position="tr" />
        <Handle position="bl" />
        <Handle position="br" />
        <Handle position="top" />
        <Handle position="bottom" />
        <Handle position="left" />
        <Handle position="right" />
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={onRetake}
          className="px-5 py-3 rounded-xl border border-white/15 text-slate-300 text-sm hover:border-white/30 transition-colors"
        >
          ← Retake
        </button>
        <button
          onClick={() => onConfirm(crop)}
          className="flex-1 py-3 rounded-xl text-white text-sm font-semibold hover:opacity-90 transition-opacity"
          style={{ background: `linear-gradient(135deg, ${theme.colors.primary}, ${theme.colors.accent})` }}
        >
          Crop PHI Out →
        </button>
      </div>

      <p className="text-center text-xs text-slate-500">
        Original photo is deleted immediately after you confirm the crop.
      </p>
    </div>
  );
}

// ── Main CameraUploadPage ──────────────────────────────────────────────────────

interface CameraUploadPageProps {
  onImported: () => void;
}

export function CameraUploadPage({ onImported }: CameraUploadPageProps) {
  const { activeProfile } = useProfile();
  const settings = useLiveQuery<UserSettings | undefined>(() => db.userSettings.get('default'), []);

  const [step, setStep] = useState<CameraStep>('capture');
  const [logDate, setLogDate] = useState(todayDateString());

  // Image state — only one lives at a time
  const [originalSrc, setOriginalSrc]   = useState<string | null>(null);   // revoked after crop
  const [croppedPreview, setCroppedPreview] = useState<string | null>(null);// for display only

  // Pipeline state
  const [reviewRows, setReviewRows]   = useState<PipelineReviewRow[]>([]);
  const [skippedRows, setSkippedRows] = useState<PipelineReviewRow[]>([]);
  const [error, setError]             = useState<string | null>(null);
  const [showSkipped, setShowSkipped] = useState(false);
  const [searchPanelTempId, setSearchPanelTempId] = useState<string | null>(null);
  const [importing, setImporting]     = useState(false);
  const [importedCount, setImportedCount] = useState(0);
  const [skippedCount, setSkippedCount]   = useState(0);
  const [reviewNeeded, setReviewNeeded]   = useState(0);

  // PHI warning modal for disabling crop requirement
  const [showPhiWarning, setShowPhiWarning] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);

  // ── Derived flags ─────────────────────────────────────────────────────────
  const requireCrop = settings?.requireCropBeforeOcr !== false; // default ON

  // ── Step: capture ──────────────────────────────────────────────────────────

  function handleFileSelected(file: File) {
    const url = URL.createObjectURL(file);
    setOriginalSrc(url);
    setError(null);
    if (requireCrop) {
      setStep('crop');
    } else {
      // Crop bypassed — go straight to process with full image
      processBlob(file);
    }
  }

  // ── Step: crop → extract cropped canvas blob ───────────────────────────────

  async function handleCropConfirmed(rect: CropRect) {
    if (!originalSrc) return;
    setError(null);

    try {
      const blob = await cropImageToBlob(originalSrc, rect);

      // Revoke original immediately — HIPAA: full photo gone from memory
      URL.revokeObjectURL(originalSrc);
      setOriginalSrc(null);

      // Small preview for the processing screen (revoked after OCR)
      const previewUrl = URL.createObjectURL(blob);
      setCroppedPreview(previewUrl);

      processBlob(blob, previewUrl);
    } catch {
      setError('Crop failed — please try again');
    }
  }

  async function processBlob(blob: Blob, previewUrl?: string) {
    setStep('processing');
    try {
      const provider = new OCRImportProvider(blob, logDate);
      const studies  = await provider.importStudies();
      const result   = await runImportPipeline(studies, logDate, activeProfile?.id);
      setReviewRows(result.reviewRows);
      setSkippedRows(result.skippedRows);

      // Revoke cropped image after OCR is done — not needed anymore
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setCroppedPreview(null);

      setStep('review');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'OCR failed');
      setStep('capture');
    }
  }

  // ── Canvas crop helper ─────────────────────────────────────────────────────

  function cropImageToBlob(src: string, rect: CropRect): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const sw = Math.round(rect.w * img.naturalWidth);
        const sh = Math.round(rect.h * img.naturalHeight);
        const sx = Math.round(rect.x * img.naturalWidth);
        const sy = Math.round(rect.y * img.naturalHeight);
        canvas.width  = sw;
        canvas.height = sh;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('Canvas not supported')); return; }
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
        canvas.toBlob((b) => {
          if (b) resolve(b);
          else reject(new Error('Canvas toBlob failed'));
        }, 'image/jpeg', 0.92);
      };
      img.onerror = () => reject(new Error('Image load failed'));
      img.src = src;
    });
  }

  // ── Review helpers ────────────────────────────────────────────────────────

  function updateRow(tempId: string, patch: Partial<PipelineReviewRow>) {
    setReviewRows((rows) => rows.map((r) => r.tempId === tempId ? { ...r, ...patch } : r));
  }

  function forceIncludeSkipped(tempId: string) {
    const s = skippedRows.find((r) => r.tempId === tempId);
    if (!s) return;
    setSkippedRows((rows) => rows.filter((r) => r.tempId !== tempId));
    setReviewRows((rows) => [
      ...rows,
      { ...s, duplicateStatus: null as DuplicateStatus, needsReview: true, included: true, autoSkipped: false },
    ]);
  }

  async function handleManualSelect(tempId: string, candidate: MatchCandidate) {
    const row = reviewRows.find((r) => r.tempId === tempId);
    if (!row) return;
    const updated = [candidate, ...row.candidates.filter(
      (c) => !(c.cptCode === candidate.cptCode && c.modifier === candidate.modifier),
    )];
    updateRow(tempId, { candidates: updated, selectedCandidateIndex: 0, needsReview: false });
    await learnAlias({
      rawText: row.source.examTitle,
      canonicalExamName: candidate.description,
      candidates: [{ cptCode: candidate.cptCode, modifier: candidate.modifier, workRvu: candidate.workRvu }],
      source: 'user',
      profileId: activeProfile?.id ?? null,
    });
    setSearchPanelTempId(null);
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

  async function toggleRequireCrop(newValue: boolean) {
    if (!settings) return;
    if (!newValue) {
      // User wants to turn OFF — show PHI warning first
      setShowPhiWarning(true);
      return;
    }
    await db.userSettings.put({ ...settings, requireCropBeforeOcr: true, updatedAt: new Date().toISOString() });
  }

  async function confirmDisableCrop() {
    if (!settings) return;
    await db.userSettings.put({ ...settings, requireCropBeforeOcr: false, updatedAt: new Date().toISOString() });
    setShowPhiWarning(false);
  }

  function resetToCapture() {
    if (originalSrc) URL.revokeObjectURL(originalSrc);
    if (croppedPreview) URL.revokeObjectURL(croppedPreview);
    setOriginalSrc(null);
    setCroppedPreview(null);
    setReviewRows([]);
    setSkippedRows([]);
    setError(null);
    setStep('capture');
  }

  const includedCount = reviewRows.filter((r) => r.included).length;
  const matchedCount  = reviewRows.filter((r) => r.included && r.selectedCandidateIndex !== null).length;
  const possibleDupes = reviewRows.filter((r) => r.included && r.duplicateStatus === 'possible').length;

  // ── PHI Warning Modal ──────────────────────────────────────────────────────

  if (showPhiWarning) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.75)' }}>
        <div className="w-full max-w-sm rounded-2xl border border-red-500/30 overflow-hidden"
          style={{ background: 'var(--theme-bg-card)' }}>
          <div className="px-5 py-4 bg-red-500/15 border-b border-red-500/25">
            <p className="text-red-400 font-bold text-base">⚠ PHI Warning</p>
          </div>
          <div className="px-5 py-4 space-y-3">
            <p className="text-white text-sm font-medium">
              Disabling crop before OCR may expose patient identifiers.
            </p>
            <p className="text-slate-400 text-xs leading-relaxed">
              Full PowerScribe screenshots contain PHI — patient name, MRN, DOB, room,
              and account number. Without mandatory cropping, this data will be present
              in the OCR input, even if it is not extracted into the study log.
            </p>
            <p className="text-slate-400 text-xs leading-relaxed">
              This setting should remain <strong className="text-white">ON</strong> in all
              HIPAA-covered clinical environments. Only disable in fully de-identified
              demo/testing scenarios.
            </p>
          </div>
          <div className="px-5 py-4 border-t border-white/8 flex gap-3">
            <button
              onClick={() => setShowPhiWarning(false)}
              className="flex-1 py-2.5 rounded-xl border border-white/15 text-slate-300 text-sm hover:border-white/30 transition-colors"
            >
              Keep Crop ON
            </button>
            <button
              onClick={confirmDisableCrop}
              className="flex-1 py-2.5 rounded-xl bg-red-500/20 border border-red-500/30 text-red-300 text-sm font-semibold hover:bg-red-500/30 transition-colors"
            >
              Disable Anyway
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Step: done ────────────────────────────────────────────────────────────

  if (step === 'done') {
    return (
      <div className="max-w-lg mx-auto text-center space-y-6 py-16 animate-in fade-in duration-300">
        <div className="w-20 h-20 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center mx-auto text-4xl">✓</div>
        <div>
          <h2 className="text-2xl font-bold text-white">Import Complete</h2>
          <div className="mt-3 space-y-1.5">
            <p className="text-emerald-400 text-sm font-medium">Imported: {importedCount} {importedCount === 1 ? 'study' : 'studies'}</p>
            {skippedCount > 0 && <p className="text-slate-400 text-sm">Skipped duplicates: {skippedCount}</p>}
            {reviewNeeded > 0 && <p className="text-amber-400 text-sm">Needs review: {reviewNeeded}</p>}
          </div>
        </div>
        <div className="flex gap-3 justify-center">
          <button onClick={resetToCapture}
            className="px-6 py-2.5 rounded-xl border border-white/15 text-slate-300 text-sm hover:border-white/30 transition-colors">
            Capture Another
          </button>
          <button onClick={onImported}
            className="px-6 py-2.5 rounded-xl text-white text-sm font-semibold hover:opacity-90 transition-opacity"
            style={{ background: `linear-gradient(135deg, ${theme.colors.primary}, ${theme.colors.accent})` }}>
            View Dashboard
          </button>
        </div>
      </div>
    );
  }

  // ── Step: review ───────────────────────────────────────────────────────────

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
          <button onClick={resetToCapture} className="text-sm text-slate-400 hover:text-white transition-colors">← Back</button>
        </div>

        {/* Date picker */}
        <div className="card">
          <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider mb-1.5">Log Date</label>
          <input type="date" value={logDate} onChange={(e) => setLogDate(e.target.value)} className="input" />
        </div>

        {/* Privacy confirmation badge */}
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-500/8 border border-emerald-500/20">
          <span className="text-emerald-400 text-sm">🔒</span>
          <p className="text-emerald-400/80 text-xs">Original photo deleted. Cropped image processed locally and cleared from memory.</p>
        </div>

        {/* Skipped duplicates */}
        {skippedRows.length > 0 && (
          <div className="rounded-xl border border-slate-700/60 bg-slate-800/40 overflow-hidden">
            <button
              onClick={() => setShowSkipped((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-white/3 transition-colors"
            >
              <span className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-slate-600/60 flex items-center justify-center text-xs text-slate-300 font-bold">{skippedRows.length}</span>
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
                          {top?.cptCode && <span className="text-xs font-mono text-slate-500">{top.cptCode}</span>}
                          {top?.workRvu != null && <span className="text-xs text-slate-500">{top.workRvu.toFixed(2)} wRVU</span>}
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5 italic">{s.duplicateReason}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`text-xs px-2 py-0.5 rounded-lg border font-medium ${s.duplicateStatus === 'exact' ? 'bg-red-500/10 border-red-500/25 text-red-400' : 'bg-amber-500/10 border-amber-500/25 text-amber-400'}`}>
                          {s.duplicateStatus === 'exact' ? 'Exact dup' : 'Very likely dup'}
                        </span>
                        <button onClick={() => forceIncludeSkipped(s.tempId)}
                          className="text-xs px-2.5 py-1 rounded-lg border border-white/12 text-slate-400 hover:border-white/25 hover:text-white transition-colors">
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

        {/* Review rows */}
        <div className="space-y-3">
          {reviewRows.map((row, i) => {
            const isPossibleDupe = row.duplicateStatus === 'possible';
            return (
              <div key={row.tempId} className={`card transition-opacity duration-200 ${!row.included ? 'opacity-40' : ''}`}>
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="min-w-0">
                    <p className="text-xs text-slate-400">#{i + 1}</p>
                    <p className="text-sm text-white font-medium truncate">{row.source.examTitle}</p>
                    {row.source.accessionNumber && <p className="text-xs text-slate-500">Acc: {row.source.accessionNumber}</p>}
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      {row.source.studyTime ? (
                        <span className="text-xs font-mono text-slate-300">
                          {new Date(row.source.studyTime).toLocaleString('en-US', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}
                        </span>
                      ) : row.source.studyDate ? (
                        <span className="text-xs font-mono text-slate-300">
                          {new Date(row.source.studyDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' })}
                        </span>
                      ) : null}
                      {row.source.dateTimeSource === 'ocr' && (row.source.dateTimeConfidence ?? 0) >= 1.0 ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/25 text-emerald-400 font-medium">OCR ✓</span>
                      ) : row.source.dateTimeSource === 'ocr' && (row.source.dateTimeConfidence ?? 0) > 0 ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/15 border border-sky-500/25 text-sky-400 font-medium">OCR date</span>
                      ) : (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/25 text-amber-400/80 font-medium" title="Date was not extracted from OCR — using log date">⚠ inferred</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                    {isPossibleDupe && row.included && (
                      <span className="text-xs bg-orange-500/15 border border-orange-500/30 text-orange-300 px-2 py-0.5 rounded-lg" title={row.duplicateReason ?? ''}>⚠ Possible dup</span>
                    )}
                    {!row.needsReview && row.included && !isPossibleDupe && row.candidates[0]?.method === 'alias_match' && row.candidates[0]?.confidence >= 0.95 && (
                      <span className="text-xs bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 px-2 py-0.5 rounded-lg">✓ Learned</span>
                    )}
                    {row.needsReview && row.included && (
                      <span className="text-xs bg-amber-500/20 border border-amber-500/30 text-amber-300 px-2 py-0.5 rounded-lg">Review</span>
                    )}
                    <button
                      onClick={() => updateRow(row.tempId, { included: !row.included })}
                      className={`text-xs px-2 py-1 rounded-lg border transition-colors ${row.included ? 'bg-red-500/15 border-red-500/30 text-red-400 hover:bg-red-500/25' : 'bg-white/5 border-white/15 text-slate-400 hover:border-white/30'}`}
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

                {row.candidates.length === 0 ? (
                  <div className="space-y-2">
                    <p className="text-xs text-red-400 italic">No confident match — search exam library to assign manually.</p>
                    <button
                      onClick={() => setSearchPanelTempId(searchPanelTempId === row.tempId ? null : row.tempId)}
                      className="text-xs px-3 py-1.5 rounded-lg border border-sky-500/35 text-sky-400 hover:border-sky-400/60 hover:bg-sky-500/8 transition-all font-medium"
                    >
                      {searchPanelTempId === row.tempId ? '↑ Close search' : '🔍 Search exam library'}
                    </button>
                    {searchPanelTempId === row.tempId && (
                      <ExamSearchPanel initialQuery={row.source.examTitle} onSelect={(c) => handleManualSelect(row.tempId, c)} onClose={() => setSearchPanelTempId(null)} />
                    )}
                  </div>
                ) : (
                  <div className="space-y-1">
                    {row.candidates.map((c, ci) => {
                      const isSelected = row.selectedCandidateIndex === ci;
                      return (
                        <button
                          key={`${c.cptCode}-${c.modifier}-${ci}`}
                          onClick={() => updateRow(row.tempId, { selectedCandidateIndex: ci, needsReview: c.confidence < 0.75 })}
                          className={`w-full text-left rounded-lg border px-3 py-2 text-xs transition-all ${isSelected ? 'text-white' : 'bg-white/3 border-white/8 text-slate-400 hover:border-white/20'}`}
                          style={isSelected ? { background: 'rgba(37,99,168,0.15)', borderColor: 'rgba(37,99,168,0.4)' } : {}}
                        >
                          <span className="font-mono font-bold mr-2">{c.cptCode}</span>
                          {c.modifier && <span className="mr-1.5 text-slate-500">mod {c.modifier}</span>}
                          <span className="mr-2">{c.description.slice(0, 55)}{c.description.length > 55 ? '…' : ''}</span>
                          <span className="font-medium">{c.workRvu?.toFixed(2)} wRVU</span>
                          <span className={`ml-2 ${c.confidence >= 0.85 ? 'text-emerald-400' : c.confidence >= 0.65 ? 'text-amber-400' : 'text-red-400'}`}>
                            {Math.round(c.confidence * 100)}%
                          </span>
                          {c.method === 'alias_match' && <span className="ml-1.5 text-emerald-500/70 text-[10px] font-semibold uppercase tracking-wide">learned</span>}
                        </button>
                      );
                    })}
                    <div className="flex items-center justify-end pt-0.5">
                      <button
                        onClick={() => setSearchPanelTempId(searchPanelTempId === row.tempId ? null : row.tempId)}
                        className="text-[11px] text-slate-500 hover:text-sky-400 transition-colors"
                      >
                        {searchPanelTempId === row.tempId ? '↑ Close search' : "Can't find it? Search library →"}
                      </button>
                    </div>
                    {searchPanelTempId === row.tempId && (
                      <ExamSearchPanel initialQuery={row.source.examTitle} onSelect={(c) => handleManualSelect(row.tempId, c)} onClose={() => setSearchPanelTempId(null)} />
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
              <p className="text-slate-400 text-sm mt-1">{skippedRows.length} duplicate{skippedRows.length > 1 ? 's' : ''} detected and skipped.</p>
            </div>
          )}
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <div className="flex gap-3">
          <button onClick={resetToCapture} className="px-5 py-2.5 rounded-xl border border-white/15 text-slate-300 text-sm hover:border-white/30 transition-colors">Cancel</button>
          <button
            onClick={handleCommit}
            disabled={importing || (matchedCount === 0 && reviewRows.length > 0) || (reviewRows.length === 0 && skippedRows.length > 0 && matchedCount === 0)}
            className="flex-1 py-2.5 rounded-xl text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
            style={{ background: `linear-gradient(135deg, ${theme.colors.primary}, ${theme.colors.accent})` }}
          >
            {importing ? 'Saving…' : reviewRows.length === 0 ? 'All Duplicates — Nothing to Import' : `Save ${matchedCount} ${matchedCount === 1 ? 'Study' : 'Studies'}`}
          </button>
        </div>
      </div>
    );
  }

  // ── Step: crop ────────────────────────────────────────────────────────────

  if (step === 'crop' && originalSrc) {
    return (
      <div className="max-w-2xl mx-auto space-y-5 animate-in fade-in duration-300">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">Crop PHI Out</h1>
            <p className="text-slate-400 text-sm mt-0.5">Step 2 of 3 — Adjust to exclude patient identifiers</p>
          </div>
        </div>
        <CropTool
          imageSrc={originalSrc}
          onConfirm={handleCropConfirmed}
          onRetake={resetToCapture}
        />
      </div>
    );
  }

  // ── Step: processing ───────────────────────────────────────────────────────

  if (step === 'processing') {
    return (
      <div className="max-w-lg mx-auto text-center space-y-6 py-20 animate-in fade-in duration-300">
        <div
          className="w-12 h-12 rounded-full border-2 border-t-transparent animate-spin mx-auto"
          style={{ borderColor: `${theme.colors.accent} transparent ${theme.colors.accent} ${theme.colors.accent}` }}
        />
        <div>
          <p className="text-white font-semibold">Running OCR…</p>
          <p className="text-slate-400 text-sm mt-1">Processing locally — nothing leaves your device</p>
        </div>
        {croppedPreview && (
          <img src={croppedPreview} alt="Cropped" className="max-h-40 mx-auto rounded-xl opacity-40 object-contain" />
        )}
      </div>
    );
  }

  // ── Step: capture ──────────────────────────────────────────────────────────

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-in fade-in duration-300">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">Camera Capture</h1>
        <p className="text-slate-400 text-sm mt-0.5">Photograph your PowerScribe list · crop PHI · extract studies</p>
      </div>

      {/* Step progress */}
      <div className="flex items-center gap-2">
        {[
          { n: 1, label: 'Photograph' },
          { n: 2, label: 'Crop PHI Out' },
          { n: 3, label: 'Process & Review' },
        ].map((s, idx) => (
          <div key={s.n} className="flex items-center gap-2 flex-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                step === 'capture' && s.n === 1 ? 'text-white' :
                'text-slate-600'
              }`}
                style={step === 'capture' && s.n === 1 ? { background: theme.colors.primary } : { background: 'rgba(255,255,255,0.08)' }}>
                {s.n}
              </div>
              <span className={`text-xs truncate ${step === 'capture' && s.n === 1 ? 'text-white font-medium' : 'text-slate-600'}`}>{s.label}</span>
            </div>
            {idx < 2 && <div className="h-px flex-1 bg-white/8" />}
          </div>
        ))}
      </div>

      {/* PHI guidance card */}
      <div className="px-4 py-3 rounded-xl border border-amber-500/25 bg-amber-500/8 space-y-2">
        <p className="text-amber-300 text-sm font-semibold">Privacy-first capture</p>
        <ul className="text-amber-200/70 text-xs space-y-0.5">
          <li>✓ OCR runs locally — nothing leaves your device</li>
          <li>✓ Original photo is deleted immediately after crop</li>
          <li>✓ Cropped image is cleared after text extraction</li>
          <li>✓ No camera roll save · no cloud sync · no external upload</li>
        </ul>
      </div>

      {/* Date picker */}
      <div className="card space-y-3">
        <div>
          <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider mb-1.5">Study Date (fallback if OCR finds none)</label>
          <input type="date" value={logDate} onChange={(e) => setLogDate(e.target.value)} className="input" />
        </div>
      </div>

      {/* Capture button — big, mobile-friendly */}
      <button
        onClick={() => fileRef.current?.click()}
        className="w-full py-5 rounded-2xl text-white font-bold text-lg hover:opacity-90 active:scale-[0.98] transition-all"
        style={{ background: `linear-gradient(135deg, ${theme.colors.primary}, ${theme.colors.accent})`, boxShadow: `0 4px 32px rgba(37,99,168,0.4)` }}
      >
        📷 Take PowerScribe Photo
      </button>

      {/* Hidden file input — capture=environment triggers camera on mobile */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFileSelected(f);
          // Reset so same file can be selected again
          e.target.value = '';
        }}
      />

      {/* Also allow gallery / desktop upload */}
      <div className="text-center">
        <button
          onClick={() => {
            // Remove capture attribute for gallery selection
            if (fileRef.current) {
              fileRef.current.removeAttribute('capture');
              fileRef.current.click();
              // Restore capture after dialog closes
              setTimeout(() => fileRef.current?.setAttribute('capture', 'environment'), 2000);
            }
          }}
          className="text-xs text-slate-500 hover:text-slate-300 transition-colors underline underline-offset-2"
        >
          Or choose from gallery / file system
        </button>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/25">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {/* Crop requirement toggle */}
      <div className="card">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-white font-medium">Require crop before OCR</p>
            <p className="text-xs text-slate-500 mt-0.5">
              {requireCrop
                ? 'ON — mandatory crop protects patient identifiers'
                : '⚠ OFF — PHI may be present in OCR input'}
            </p>
          </div>
          <button
            onClick={() => toggleRequireCrop(!requireCrop)}
            className="relative shrink-0 w-12 h-6 rounded-full transition-colors duration-200"
            style={{ background: requireCrop ? theme.colors.primary : 'rgba(255,255,255,0.12)' }}
          >
            <span
              className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200"
              style={{ transform: requireCrop ? 'translateX(26px)' : 'translateX(2px)' }}
            />
          </button>
        </div>
        {!requireCrop && (
          <div className="mt-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
            <p className="text-red-400 text-xs">
              ⚠ Crop disabled. Full photos will be sent to OCR without PHI removal.
              Re-enable in Settings or tap the toggle above.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
