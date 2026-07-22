/**
 * RecentBatches.tsx
 *
 * Every commit made today, one line per Inbox Accept action (grouped by
 * StudyLog.sourceImportId), each with an Undo that works any time within
 * the same day -- not just the 10-second receipt window. Shared between
 * the Inbox header and the top of History's Day lens.
 */

import { useState } from 'react';
import { batchConfirmLine, type RecentBatch } from '../services/studyLogService';

function shortTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function RecentBatches({ batches, onUndo }: {
  batches: RecentBatch[];
  onUndo: (batch: RecentBatch) => void;
}) {
  const [open, setOpen] = useState(false);
  if (batches.length === 0) return null;

  return (
    <div className="rounded-[12px] border border-rd-separator bg-rd-surface">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-11 w-full items-center justify-between px-4 text-left text-[13px] font-medium text-rd-label-primary"
        aria-expanded={open}
      >
        Recent batches · {batches.length}
        <span aria-hidden="true">{open ? '⌃' : '⌄'}</span>
      </button>
      {open && (
        <div className="space-y-1 border-t border-rd-separator p-2">
          {batches.map((batch) => (
            <div key={batch.sourceImportId} className="flex items-center justify-between gap-3 rounded-[10px] px-2 py-1.5 text-[13px]">
              <span className="min-w-0 truncate text-rd-label-primary">
                {batch.sourceLabel} · {shortTime(batch.capturedAt)} · {batch.studyCount} stud{batch.studyCount === 1 ? 'y' : 'ies'} · {batch.totalWrvu.toFixed(1)} wRVU
              </span>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(batchConfirmLine(batch))) onUndo(batch);
                }}
                className="shrink-0 text-[13px] font-semibold text-rd-caution underline underline-offset-4"
              >
                Undo batch
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
