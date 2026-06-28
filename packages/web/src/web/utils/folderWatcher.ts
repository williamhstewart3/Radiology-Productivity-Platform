/**
 * folderWatcher.ts
 *
 * React hook that bridges the Electron folder-watcher IPC with the shared
 * import pipeline.  Renderer-side only — the actual fs.watch lives in main.ts.
 *
 * Flow per file:
 *   1. main.ts detects new PNG/JPG → sends "watcher:new-file" with full path
 *   2. This hook receives the path, reads it as base64 via fs:readBuffer
 *   3. Converts base64 → Blob → feeds to OCRImportProvider
 *   4. Runs runImportPipeline()
 *   5. Studies with needsReview=false → auto-committed via commitPipelineResults()
 *   6. Studies needing review → added to pendingReview queue (shown in WatcherPage)
 *   7. Moves file to {watchFolder}/processed/ (or deletes) on success,
 *      {watchFolder}/failed/ on error
 *
 * Security: all file I/O is local. Nothing is transmitted externally.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { getDesktopAPI } from '../lib/desktop';
import { OCRImportProvider } from '../providers/OCRImportProvider';
import { runImportPipeline, commitPipelineResults } from '../pipeline/importPipeline';
import { todayDateString } from './calculations';
import type { PipelineReviewRow } from '../pipeline/importPipeline';

// ─── Types ─────────────────────────────────────────────────────────────────────

export type WatcherStatus = 'idle' | 'watching' | 'stopping' | 'error';

export interface ActivityEntry {
  id: string;
  timestamp: string;       // ISO
  filePath: string;
  fileName: string;
  status: 'processing' | 'committed' | 'needs_review' | 'skipped' | 'failed';
  message: string;
  rvusCaptured?: number;
  studiesCommitted?: number;
  studiesNeedingReview?: number;
}

export interface WatcherStats {
  filesProcessed: number;
  rvusCaptured: number;
  studiesCommitted: number;
  studiesNeedingReview: number;
}

export interface UseFolderWatcherReturn {
  status: WatcherStatus;
  isWatching: boolean;
  activityLog: ActivityEntry[];
  stats: WatcherStats;
  pendingReviewCount: number;
  pendingReviewRows: PipelineReviewRow[];
  start: (folderPath: string) => Promise<void>;
  stop: () => Promise<void>;
  clearActivity: () => void;
}

// ─── Hook ──────────────────────────────────────────────────────────────────────

export function useFolderWatcher(
  profileId: string | null | undefined,
  autoDelete: boolean,
): UseFolderWatcherReturn {
  const api = getDesktopAPI();

  const [status, setStatus] = useState<WatcherStatus>('idle');
  const [activityLog, setActivityLog] = useState<ActivityEntry[]>([]);
  const [stats, setStats] = useState<WatcherStats>({
    filesProcessed: 0,
    rvusCaptured: 0,
    studiesCommitted: 0,
    studiesNeedingReview: 0,
  });
  const [pendingReviewRows, setPendingReviewRows] = useState<PipelineReviewRow[]>([]);

  // Keep mutable refs so the callback closure always sees fresh values
  const watchFolderRef = useRef<string | null>(null);
  const autoDeleteRef  = useRef(autoDelete);
  const profileIdRef   = useRef(profileId);

  useEffect(() => { autoDeleteRef.current = autoDelete; }, [autoDelete]);
  useEffect(() => { profileIdRef.current = profileId; }, [profileId]);

  // ── File processor ─────────────────────────────────────────────────────────

  const processFile = useCallback(async (filePath: string) => {
    if (!api) return;

    const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
    const entryId  = crypto.randomUUID();
    const watchFolder = watchFolderRef.current!;

    // Add a "processing" entry immediately so the UI feels live
    const processingEntry: ActivityEntry = {
      id: entryId,
      timestamp: new Date().toISOString(),
      filePath,
      fileName,
      status: 'processing',
      message: 'Running OCR…',
    };
    setActivityLog((prev) => [processingEntry, ...prev].slice(0, 200));

    const updateEntry = (patch: Partial<ActivityEntry>) =>
      setActivityLog((prev) =>
        prev.map((e) => (e.id === entryId ? { ...e, ...patch } : e)),
      );

    try {
      // 1. Read file as base64
      const base64 = await api.readFileBuffer(filePath);
      const mimeType = /\.png$/i.test(fileName) ? 'image/png' : 'image/jpeg';
      const byteChars = atob(base64);
      const byteArr   = new Uint8Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) byteArr[i] = byteChars.charCodeAt(i);
      const blob = new Blob([byteArr], { type: mimeType });

      // 2. OCR + import pipeline
      const logDate = todayDateString();
      const provider = new OCRImportProvider(blob as File, logDate);
      const studies  = await provider.importStudies();

      if (studies.length === 0) {
        updateEntry({
          status: 'skipped',
          message: 'No studies found in image',
        });
        // Still move to processed so it's out of the watch folder
        await routeFile(api, filePath, watchFolder, 'processed', autoDeleteRef.current);
        return;
      }

      const result = await runImportPipeline(studies, logDate, profileIdRef.current);

      // 3. Auto-commit rows that don't need review
      const autoRows = result.reviewRows.filter((r) => !r.needsReview && r.included);
      const reviewRows = result.reviewRows.filter((r) => r.needsReview && r.included);

      let rvusCaptured = 0;
      if (autoRows.length > 0) {
        const commitResult = await commitPipelineResults(
          autoRows,
          logDate,
          result.skippedRows.length,
          profileIdRef.current,
        );
        rvusCaptured = autoRows.reduce((sum, row) => {
          if (row.selectedCandidateIndex === null) return sum;
          const cand = row.candidates[row.selectedCandidateIndex];
          return sum + (cand?.workRvu ?? 0);
        }, 0);
        setStats((prev) => ({
          filesProcessed:       prev.filesProcessed + 1,
          rvusCaptured:         prev.rvusCaptured + rvusCaptured,
          studiesCommitted:     prev.studiesCommitted + commitResult.importedCount,
          studiesNeedingReview: prev.studiesNeedingReview + reviewRows.length,
        }));
      } else {
        setStats((prev) => ({
          ...prev,
          filesProcessed:       prev.filesProcessed + 1,
          studiesNeedingReview: prev.studiesNeedingReview + reviewRows.length,
        }));
      }

      // 4. Queue review rows
      if (reviewRows.length > 0) {
        setPendingReviewRows((prev) => [...prev, ...reviewRows]);
      }

      const statusLabel: ActivityEntry['status'] =
        reviewRows.length > 0
          ? autoRows.length > 0
            ? 'needs_review'
            : 'needs_review'
          : 'committed';

      const parts: string[] = [];
      if (autoRows.length > 0)   parts.push(`${autoRows.length} study${autoRows.length > 1 ? 'ies' : ''} committed`);
      if (reviewRows.length > 0) parts.push(`${reviewRows.length} need review`);
      if (result.skippedRows.length > 0) parts.push(`${result.skippedRows.length} duplicate${result.skippedRows.length > 1 ? 's' : ''} skipped`);

      updateEntry({
        status: statusLabel,
        message: parts.join(', ') || 'Processed',
        rvusCaptured,
        studiesCommitted: autoRows.length,
        studiesNeedingReview: reviewRows.length,
      });

      // 5. Route file
      await routeFile(api, filePath, watchFolder, 'processed', autoDeleteRef.current);

    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      updateEntry({ status: 'failed', message: `Error: ${message}` });
      // Move to failed/ so it's quarantined but not lost
      try {
        await routeFile(api, filePath, watchFolder, 'failed', false);
      } catch {
        // If routing also fails, just leave it in place
      }
    }
  }, [api]);

  // ── Start / stop ───────────────────────────────────────────────────────────

  const start = useCallback(async (folderPath: string) => {
    if (!api) return;
    try {
      setStatus('watching');
      watchFolderRef.current = folderPath;

      // Ensure processed/ and failed/ subdirectories exist
      await api.ensureDir(`${folderPath}/processed`);
      await api.ensureDir(`${folderPath}/failed`);

      await api.watchFolder(folderPath);
    } catch (err) {
      setStatus('error');
      const message = err instanceof Error ? err.message : String(err);
      const errEntry: ActivityEntry = {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        filePath: '',
        fileName: '',
        status: 'failed',
        message: `Failed to start watcher: ${message}`,
      };
      setActivityLog((prev) => [errEntry, ...prev].slice(0, 200));
    }
  }, [api]);

  const stop = useCallback(async () => {
    if (!api) return;
    setStatus('stopping');
    await api.stopWatcher();
    watchFolderRef.current = null;
    setStatus('idle');
  }, [api]);

  const clearActivity = useCallback(() => setActivityLog([]), []);

  // ── Register IPC listeners ─────────────────────────────────────────────────

  useEffect(() => {
    if (!api) return;

    const unsubFile  = api.onWatcherFile(processFile);
    const unsubError = api.onWatcherError((errMsg) => {
      setStatus('error');
      const errEntry: ActivityEntry = {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        filePath: '',
        fileName: '',
        status: 'failed',
        message: `Watcher error: ${errMsg}`,
      };
      setActivityLog((prev) => [errEntry, ...prev].slice(0, 200));
    });

    return () => {
      unsubFile();
      unsubError();
    };
  }, [api, processFile]);

  // ── Cleanup on unmount ─────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (api && watchFolderRef.current) {
        api.stopWatcher().catch(() => {});
      }
    };
  }, [api]);

  return {
    status,
    isWatching: status === 'watching',
    activityLog,
    stats,
    pendingReviewCount: pendingReviewRows.length,
    pendingReviewRows,
    start,
    stop,
    clearActivity,
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

async function routeFile(
  api: NonNullable<ReturnType<typeof getDesktopAPI>>,
  filePath: string,
  watchFolder: string,
  dest: 'processed' | 'failed',
  shouldDelete: boolean,
): Promise<void> {
  if (dest === 'processed' && shouldDelete) {
    await api.deleteFile(filePath);
    return;
  }
  const fileName = filePath.split(/[\\/]/).pop()!;
  const destPath = `${watchFolder}/${dest}/${fileName}`;
  await api.moveFile(filePath, destPath);
}
