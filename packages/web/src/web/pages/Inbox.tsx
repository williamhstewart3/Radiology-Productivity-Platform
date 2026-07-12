import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import { useOrg } from '../hooks/useOrg';
import type { PipelineReviewRow } from '../pipeline/importPipeline';
import { AttentionCard } from '../components/AttentionCard';
import { Card } from '../components/ui/Card';
import { KeyHint } from '../components/ui/KeyHint';
import { resolveInboxRows, selectInboxCandidate } from '../services/inboxService';
import { restoreCaptureState, snapshotCaptureState, type CaptureUndoSnapshot } from '../services/captureUndoService';

function parseRows(rowsJson: string | undefined): PipelineReviewRow[] {
  if (!rowsJson) return [];
  try {
    const rows = JSON.parse(rowsJson) as PipelineReviewRow[];
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

export function Inbox({ onOpenLegacyReview }: { onOpenLegacyReview: () => void }) {
  const { activeProfile } = useOrg();
  const profileId = activeProfile?.id ?? null;
  const [activeIndex, setActiveIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [undoSnapshot, setUndoSnapshot] = useState<CaptureUndoSnapshot | null>(null);
  const [expandRequest, setExpandRequest] = useState(0);
  const session = useLiveQuery(async () => {
    const sessions = await db.activeReviewSessions.where('status').equals('active').reverse().sortBy('updatedAt');
    return sessions.find((item) => item.profileId === profileId || item.profileId == null) ?? null;
  }, [profileId], null);

  const pending = useMemo(
    () => parseRows(session?.rowsJson).filter((row) => row.included && row.needsReview),
    [session?.rowsJson],
  );
  const current = pending[Math.min(activeIndex, Math.max(0, pending.length - 1))];

  useEffect(() => {
    if (activeIndex >= pending.length) setActiveIndex(Math.max(0, pending.length - 1));
  }, [activeIndex, pending.length]);

  const resolve = useCallback(async (rowIds: string[], action: 'accept' | 'skip') => {
    if (busy || rowIds.length === 0) return;
    setBusy(true);
    const snapshot = await snapshotCaptureState();
    try {
      const result = await resolveInboxRows({ profileId, rowIds, action });
      setUndoSnapshot(snapshot);
      setReceipt(action === 'accept' ? `+${result.addedWrvu.toFixed(2)} wRVU · ${result.remainingAttention} remaining` : `Skipped · ${result.remainingAttention} remaining`);
      window.setTimeout(() => setUndoSnapshot(null), 10_000);
    } finally {
      setBusy(false);
    }
  }, [busy, profileId]);

  const undo = useCallback(async () => {
    if (!undoSnapshot) return;
    await restoreCaptureState(undoSnapshot);
    setUndoSnapshot(null);
    setReceipt('Decision undone');
  }, [undoSnapshot]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable) return;
      if (event.key === 'Enter' && current) void resolve([current.tempId], current.duplicateStatus === 'possible' ? 'skip' : 'accept');
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
  }, [current, pending, resolve, undo]);

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-[34px] font-bold text-rd-label-primary">Inbox · {pending.length}</h1>
          <p className="text-[13px] text-rd-label-secondary">Enter accept · E change · S skip · J/K move · Z undo</p>
        </div>
        {pending.length > 1 && <span className="text-[13px] text-rd-label-secondary">{activeIndex + 1} of {pending.length}</span>}
      </div>

      {receipt && <output className="block rounded-[10px] border border-rd-separator bg-rd-surface-2 px-3 py-2 text-[13px] text-rd-label-primary">{receipt} {undoSnapshot && <button type="button" onClick={() => void undo()} className="ml-2 font-semibold underline">Undo <KeyHint>Z</KeyHint></button>}</output>}

      {pending.length === 0 ? (
        <Card className="py-14 text-center"><p className="text-[22px] font-semibold text-rd-label-primary">All caught up. Everything counted.</p></Card>
      ) : current ? (
        <AttentionCard
          row={current}
          active
          onAccept={() => void resolve([current.tempId], 'accept')}
          onSkip={() => void resolve([current.tempId], 'skip')}
          onChangeCode={(index) => void selectInboxCandidate(profileId, current.tempId, index)}
          expandRequest={expandRequest}
        />
      ) : null}

      {pending.length > 1 && (
        <div className="space-y-1 border-t border-rd-separator pt-3">
          <p className="text-[12px] uppercase tracking-[0.06em] text-rd-label-secondary">Next</p>
          {pending.slice(activeIndex + 1, activeIndex + 4).map((row) => <button key={row.tempId} type="button" onClick={() => setActiveIndex(pending.indexOf(row))} className="flex min-h-11 w-full items-center justify-between rounded-[10px] px-3 text-left text-[13px] text-rd-label-primary hover:bg-rd-surface-2"><span className="truncate">{row.source.procedureName ?? row.source.examTitle}</span><span className="text-rd-label-secondary">{row.reviewReason ?? 'Needs review'}</span></button>)}
        </div>
      )}

      {session && <button type="button" onClick={onOpenLegacyReview} className="min-h-11 text-[13px] text-rd-label-secondary underline underline-offset-4">Open legacy review for parity fallback</button>}
    </div>
  );
}
