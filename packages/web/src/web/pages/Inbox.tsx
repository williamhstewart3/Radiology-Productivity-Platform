import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import { useOrg } from '../hooks/useOrg';
import { selectedCandidatesForRow, type PipelineReviewRow } from '../pipeline/importPipeline';
import { AttentionCard } from '../components/AttentionCard';
import { ChangeCodePicker } from '../components/ChangeCodePicker';
import { Card } from '../components/ui/Card';
import { KeyHint } from '../components/ui/KeyHint';
import { applyInboxCandidateSelection, applyInboxRowSplit, formatInboxAccounting, resolveInboxRows, summarizeInboxAccounting } from '../services/inboxService';
import { restoreCaptureState, snapshotCaptureState, type CaptureUndoSnapshot } from '../services/captureUndoService';
import { recommendedDuplicateAction as computeRecommendedDuplicateAction } from '../utils/duplicateActions';
import { listRecentBatches, undoBatch, type RecentBatch } from '../services/studyLogService';
import { RecentBatches } from '../components/RecentBatches';
import { todayDateString } from '../utils/calculations';
import type { MatchCandidate, StudyLog } from '../types';

function parseRows(rowsJson: string | undefined): PipelineReviewRow[] {
  if (!rowsJson) return [];
  try {
    const rows = JSON.parse(rowsJson) as PipelineReviewRow[];
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

export function Inbox() {
  const { activeProfile, activePractice } = useOrg();
  const profileId = activeProfile?.id ?? null;
  const siteId = activePractice?.id ?? null;
  const [activeIndex, setActiveIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [undoSnapshot, setUndoSnapshot] = useState<CaptureUndoSnapshot | null>(null);
  const [expandRequest, setExpandRequest] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const session = useLiveQuery(async () => {
    const sessions = await db.activeReviewSessions.where('status').equals('active').reverse().sortBy('updatedAt');
    return sessions.find((item) => item.profileId === profileId && (item.siteId ?? null) === siteId) ?? null;
  }, [profileId, siteId], null);

  const pending = useMemo(
    () => parseRows(session?.rowsJson).filter((row) => row.included && row.needsReview),
    [session?.rowsJson],
  );
  const current = pending[Math.min(activeIndex, Math.max(0, pending.length - 1))];

  const accounting = useMemo(() => {
    const summary = summarizeInboxAccounting(session, pending);
    return summary ? formatInboxAccounting(summary) : null;
  }, [session, pending]);

  const duplicateExistingIds = useMemo(
    () => [...new Set(pending.filter((row) => row.duplicateStatus === 'possible' && row.duplicateExistingLogId).map((row) => row.duplicateExistingLogId as string))],
    [pending],
  );
  const existingLogsById = useLiveQuery(async () => {
    const map = new Map<string, StudyLog>();
    for (const id of duplicateExistingIds) {
      const log = await db.studyLogs.get(id);
      if (log) map.set(id, log);
    }
    return map;
  }, [duplicateExistingIds.join('|')], new Map<string, StudyLog>());

  const recommendedActions = useMemo(() => {
    const map = new Map<string, 'update_existing' | null>();
    for (const row of pending) {
      if (row.duplicateStatus !== 'possible') continue;
      const existing = row.duplicateExistingLogId ? existingLogsById.get(row.duplicateExistingLogId) : undefined;
      map.set(row.tempId, computeRecommendedDuplicateAction(row.source, existing));
    }
    return map;
  }, [pending, existingLogsById]);
  const currentRecommendedAction = current ? recommendedActions.get(current.tempId) ?? null : null;
  const updatableBatch = pending.length > 0 && pending.every((row) => recommendedActions.get(row.tempId) === 'update_existing');

  const recentBatches = useLiveQuery(
    () => listRecentBatches(profileId, todayDateString()),
    [profileId],
    [] as RecentBatch[],
  );
  const handleUndoBatch = useCallback(async (batch: RecentBatch) => {
    const result = await undoBatch(batch, profileId);
    setReceipt(`Removed ${result.removedCount} studies · ${result.removedWrvu.toFixed(1)} wRVU`);
  }, [profileId]);

  useEffect(() => {
    if (activeIndex >= pending.length) setActiveIndex(Math.max(0, pending.length - 1));
  }, [activeIndex, pending.length]);

  const resolve = useCallback(async (rowIds: string[], action: 'accept' | 'skip' | 'update_existing') => {
    if (busy || rowIds.length === 0) return;
    setBusy(true);
    const snapshot = await snapshotCaptureState();
    try {
      const result = await resolveInboxRows({ profileId, siteId, rowIds, action });
      setUndoSnapshot(snapshot);
      setReceipt(
        action === 'accept' ? `+${result.addedWrvu.toFixed(2)} wRVU · ${result.remainingAttention} remaining`
        : action === 'update_existing' ? `Updated existing · ${result.remainingAttention} remaining`
        : `Skipped · ${result.remainingAttention} remaining`,
      );
      window.setTimeout(() => setUndoSnapshot(null), 10_000);
    } finally {
      setBusy(false);
    }
  }, [busy, profileId, siteId]);

  const undo = useCallback(async () => {
    if (!undoSnapshot) return;
    await restoreCaptureState(undoSnapshot);
    setUndoSnapshot(null);
    setReceipt('Decision undone');
  }, [undoSnapshot]);

  const splitRow = useCallback(async (rowId: string, candidates: MatchCandidate[]) => {
    if (busy || candidates.length < 2) return;
    setBusy(true);
    const snapshot = await snapshotCaptureState();
    try {
      const splitCount = await applyInboxRowSplit(profileId, rowId, candidates, siteId);
      if (splitCount > 1) {
        setUndoSnapshot(snapshot);
        setReceipt(`Split into ${splitCount} studies; verify each one before accepting`);
        window.setTimeout(() => setUndoSnapshot(null), 10_000);
      }
    } finally {
      setBusy(false);
    }
  }, [busy, profileId, siteId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (pickerOpen) return;
      const target = event.target as HTMLElement | null;
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable) return;
      if (event.key === 'Enter' && current) void resolve([current.tempId], current.duplicateStatus === 'possible' ? (currentRecommendedAction === 'update_existing' ? 'update_existing' : 'skip') : 'accept');
      else if (event.key.toLowerCase() === 'e' && current) setExpandRequest((value) => value + 1);
      else if (event.key.toLowerCase() === 's' && current) void resolve([current.tempId], 'skip');
      else if (event.key.toLowerCase() === 'z') void undo();
      else if (event.key.toLowerCase() === 'j') setActiveIndex((index) => Math.min(pending.length - 1, index + 1));
      else if (event.key.toLowerCase() === 'k') setActiveIndex((index) => Math.max(0, index - 1));
      else if (event.key.toLowerCase() === 'a') {
        const safe = pending.filter((row) => row.duplicateStatus !== 'possible' && (row.candidates[0]?.confidence ?? 0) >= 0.95);
        void resolve(safe.map((row) => row.tempId), 'accept');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [current, currentRecommendedAction, pending, resolve, undo, pickerOpen]);

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-[34px] font-bold text-rd-label-primary">Inbox · {pending.length}</h1>
          <p className="text-[13px] text-rd-label-secondary">Enter accept · E change · S skip · J/K move · Z undo</p>
          {accounting && <p className="text-[13px] text-rd-label-secondary [font-variant-numeric:tabular-nums]">{accounting}</p>}
        </div>
        {pending.length > 1 && <span className="text-[13px] text-rd-label-secondary">{activeIndex + 1} of {pending.length}</span>}
      </div>

      <RecentBatches batches={recentBatches} onUndo={(batch) => void handleUndoBatch(batch)} />

      {updatableBatch && (
        <Card className="flex items-center justify-between gap-3 py-3">
          <p className="text-[13px] text-rd-label-primary">This whole batch looks like addendum touches on already-counted studies.</p>
          <button type="button" onClick={() => void resolve(pending.map((row) => row.tempId), 'update_existing')} className="min-h-11 shrink-0 rounded-[10px] bg-rd-label-primary px-4 text-[13px] font-semibold text-rd-bg">
            Update all {pending.length}
          </button>
        </Card>
      )}

      {receipt && <output aria-live="polite" className="block rounded-[10px] border border-rd-separator bg-rd-surface-2 px-3 py-2 text-[13px] text-rd-label-primary">{receipt} {undoSnapshot && <button type="button" onClick={() => void undo()} className="ml-2 font-semibold underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rd-label-primary">Undo <KeyHint>Z</KeyHint></button>}</output>}

      {pending.length === 0 ? (
        <Card className="py-14 text-center"><p className="text-[22px] font-semibold text-rd-label-primary">All caught up. Everything counted.</p></Card>
      ) : current ? (
        <AttentionCard
          row={current}
          active
          onAccept={() => void resolve([current.tempId], 'accept')}
          onSkip={() => void resolve([current.tempId], 'skip')}
          onOpenPicker={() => setPickerOpen(true)}
          onSplit={() => void splitRow(current.tempId, selectedCandidatesForRow(current))}
          onUpdateExisting={() => void resolve([current.tempId], 'update_existing')}
          recommendedDuplicateAction={currentRecommendedAction}
          expandRequest={expandRequest}
        />
      ) : null}

      {pending.length > 1 && (
        <div className="space-y-1 border-t border-rd-separator pt-3">
          <p className="text-[12px] uppercase tracking-[0.06em] text-rd-label-secondary">Next</p>
          {pending.slice(activeIndex + 1, activeIndex + 4).map((row) => <button key={row.tempId} type="button" onClick={() => setActiveIndex(pending.indexOf(row))} className="rd-row flex w-full items-center justify-between rounded-[10px] px-3 text-left text-[13px] text-rd-label-primary hover:bg-rd-surface-2"><span className="truncate">{row.source.procedureName ?? row.source.examTitle}</span><span className="text-rd-label-secondary">{row.reviewReason ?? 'Needs review'}</span></button>)}
        </div>
      )}

      <ChangeCodePicker
        open={pickerOpen}
        row={current ?? null}
        onClose={() => setPickerOpen(false)}
        onCommit={(candidates) => {
          if (!current) return;
          void applyInboxCandidateSelection(profileId, current.tempId, candidates, siteId);
        }}
        onSplit={(candidates) => {
          if (!current) return;
          void splitRow(current.tempId, candidates);
        }}
      />
    </div>
  );
}
