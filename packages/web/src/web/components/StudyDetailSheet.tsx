/**
 * StudyDetailSheet.tsx
 *
 * The per-study escape hatch: reachable from any committed-study row
 * (Today's Recent list, History's Day lens), this exposes the same
 * rename/delete paths History's legacy table already has, without making
 * the radiologist navigate there first. Delete has no time limit -- it's
 * the same soft-delete studyLogService.softDeleteStudyLogs uses everywhere
 * else, so totals update live on every surface, including the Mini window.
 */

import { useEffect, useState } from 'react';
import { Sheet } from './ui/Sheet';
import { renameStudyLog, softDeleteStudyLogs } from '../services/studyLogService';
import type { StudyLog } from '../types';

function displayTitle(log: StudyLog): string {
  return log.examTitleDisplay?.trim() || log.examNameRaw;
}

export function StudyDetailSheet({ open, logs, onClose, profileId }: {
  open: boolean;
  /** All StudyLog rows for this exam -- more than one for a multi-CPT combo. */
  logs: StudyLog[] | null;
  onClose: () => void;
  profileId: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setEditing(false);
    setTitle(logs?.[0] ? displayTitle(logs[0]) : '');
  }, [open, logs]);

  if (!logs || logs.length === 0) return null;
  const primary = logs[0];
  const totalWrvu = logs.reduce((sum, log) => sum + (log.workRvu ?? 0), 0);

  async function handleDelete() {
    if (!logs) return;
    const count = logs.length;
    if (!window.confirm(`Delete this ${count > 1 ? 'combined study' : 'study'}? ${count} CPT row${count === 1 ? '' : 's'} · ${totalWrvu.toFixed(2)} wRVU. This can't be undone from here after today.`)) return;
    setBusy(true);
    try {
      await softDeleteStudyLogs(logs.map((log) => log.id), {
        profileId,
        summary: `Deleted ${displayTitle(primary)} from the study sheet`,
      });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  async function handleSave() {
    setBusy(true);
    try {
      await renameStudyLog(primary, title, profileId);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Study">
      <div className="space-y-4">
        {editing ? (
          <div className="flex gap-2">
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') void handleSave(); }}
              aria-label="Exam title"
              className="h-11 flex-1 rounded-[10px] bg-rd-surface-2 px-3 text-[15px] text-rd-label-primary outline-none"
            />
            <button type="button" onClick={() => void handleSave()} disabled={busy} className="min-h-11 rounded-[10px] bg-rd-label-primary px-3 text-[13px] font-semibold text-rd-bg">Save</button>
          </div>
        ) : (
          <div>
            <p className="text-[20px] font-semibold text-rd-label-primary">{displayTitle(primary)}</p>
            <button type="button" onClick={() => setEditing(true)} className="mt-1 text-[13px] text-rd-label-secondary underline underline-offset-4">Rename</button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1.5">
          {logs.map((log) => (
            <span key={log.id} className="rounded-full bg-rd-surface-2 px-2.5 py-1 font-mono text-[13px] text-rd-label-primary">
              {log.cptCode ?? '—'} · {log.workRvu?.toFixed(2) ?? '—'}
            </span>
          ))}
          {logs.length > 1 && (
            <span className="font-mono text-[13px] font-semibold text-rd-label-primary [font-variant-numeric:tabular-nums]">= {totalWrvu.toFixed(2)} wRVU</span>
          )}
        </div>

        <div className="text-[13px] text-rd-label-secondary">
          {primary.examDateTime && <p>Exam {new Date(primary.examDateTime).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</p>}
          {primary.studyDateTime && <p>Read {new Date(primary.studyDateTime).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</p>}
        </div>

        <div className="flex items-center justify-between border-t border-rd-separator pt-3">
          <button type="button" onClick={onClose} className="min-h-11 px-2 text-[15px] text-rd-label-secondary">Close</button>
          <button type="button" onClick={() => void handleDelete()} disabled={busy} className="min-h-11 rounded-[10px] px-4 text-[15px] font-semibold text-rd-negative disabled:opacity-40">
            Delete
          </button>
        </div>
      </div>
    </Sheet>
  );
}
