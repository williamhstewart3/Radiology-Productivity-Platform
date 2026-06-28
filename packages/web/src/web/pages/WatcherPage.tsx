/**
 * WatcherPage.tsx
 *
 * PowerScribe Screenshot Watcher — monitors a folder for new screenshots,
 * runs OCR, and auto-commits studies through the shared import pipeline.
 *
 * Desktop-only feature. Shows a "Desktop app required" message in the browser.
 *
 * PHI WARNING: displayed as a non-dismissable red banner at all times on this page.
 */

import { useRef, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { theme } from '../lib/theme';
import { isDesktop, getDesktopAPI } from '../lib/desktop';
import { db } from '../db/database';
import { useFolderWatcher, type ActivityEntry } from '../utils/folderWatcher';
import { useProfile } from '../hooks/useProfile';
import type { UserSettings } from '../types';

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return iso;
  }
}

function statusDot(status: ActivityEntry['status']): string {
  switch (status) {
    case 'processing':   return '🔄';
    case 'committed':    return '✅';
    case 'needs_review': return '⚠️';
    case 'skipped':      return '⏭️';
    case 'failed':       return '❌';
  }
}

function statusColor(status: ActivityEntry['status']): string {
  const t = theme.colors;
  switch (status) {
    case 'processing':   return t.textSecondary;
    case 'committed':    return t.ahead;
    case 'needs_review': return t.caution;
    case 'skipped':      return t.textMuted;
    case 'failed':       return t.behind;
  }
}

// ─── Desktop-only gate ─────────────────────────────────────────────────────────

function DesktopRequired() {
  return (
    <div className="flex flex-col items-center justify-center py-24 px-6 text-center">
      <div className="text-5xl mb-4">🖥️</div>
      <h2 className="text-xl font-semibold mb-2" style={{ color: theme.colors.textPrimary }}>
        Desktop App Required
      </h2>
      <p className="text-sm max-w-sm" style={{ color: theme.colors.textSecondary }}>
        The folder watcher uses native file-system access only available in the
        Electron desktop app. Open the app on your workstation to use this feature.
      </p>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export function WatcherPage({ onNavigateToImport }: { onNavigateToImport?: () => void }) {
  const { activeProfile } = useProfile();
  const api = getDesktopAPI();

  const settings = useLiveQuery<UserSettings | undefined>(
    () => db.userSettings.get('default'),
  );

  const watchFolder      = settings?.watchFolderPath ?? null;
  const autoDelete       = settings?.autoDeleteProcessed ?? false;

  const {
    status,
    isWatching,
    activityLog,
    stats,
    pendingReviewCount,
    start,
    stop,
    clearActivity,
  } = useFolderWatcher(activeProfile?.id, autoDelete);

  // Auto-scroll activity log
  const logEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activityLog]);

  // ── Folder picker ─────────────────────────────────────────────────────────

  const pickFolder = async () => {
    if (!api) return;
    const paths = await api.showOpenDialog({
      title: 'Select Watch Folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (paths.length > 0) {
      await db.userSettings.update('default', { watchFolderPath: paths[0] });
    }
  };

  const handleToggle = async () => {
    if (isWatching) {
      await stop();
    } else if (watchFolder) {
      await start(watchFolder);
    }
  };

  if (!isDesktop()) return <DesktopRequired />;

  const t = theme.colors;

  return (
    <div className="space-y-5 max-w-4xl">

      {/* ── PHI Warning Banner (non-dismissable) ─────────────────────────── */}
      <div
        className="flex items-start gap-3 rounded-xl px-4 py-3"
        style={{
          background: 'rgba(239,68,68,0.12)',
          border: `1px solid rgba(239,68,68,0.45)`,
        }}
      >
        <span className="text-lg mt-0.5">⚠️</span>
        <div>
          <p className="text-sm font-semibold" style={{ color: '#fca5a5' }}>
            PHI Warning — HIPAA Compliance Required
          </p>
          <p className="text-xs mt-0.5" style={{ color: '#fca5a5', opacity: 0.85 }}>
            This tool processes screenshots that may contain Protected Health Information (PHI).
            Use only on HIPAA-compliant, encrypted workstations. Do not use on shared or
            personally-owned devices. Ensure your institution's policies permit local screenshot capture.
            Processed files are stored locally and never transmitted.
          </p>
        </div>
      </div>

      {/* ── Folder + Controls ─────────────────────────────────────────────── */}
      <div
        className="rounded-xl p-5"
        style={{ background: t.bgCard, border: `1px solid ${t.border}` }}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold" style={{ color: t.textPrimary }}>
            Watch Folder
          </h2>
          {/* Status pill */}
          <span
            className="text-xs font-medium px-3 py-1 rounded-full"
            style={{
              background: isWatching
                ? 'rgba(34,197,94,0.12)'
                : status === 'error'
                ? 'rgba(239,68,68,0.12)'
                : 'rgba(100,116,139,0.12)',
              color: isWatching ? t.ahead : status === 'error' ? t.behind : t.textMuted,
              border: `1px solid ${isWatching ? 'rgba(34,197,94,0.3)' : status === 'error' ? 'rgba(239,68,68,0.3)' : 'rgba(100,116,139,0.2)'}`,
            }}
          >
            {isWatching ? '● Watching' : status === 'stopping' ? 'Stopping…' : status === 'error' ? '✕ Error' : '○ Idle'}
          </span>
        </div>

        {/* Folder path display */}
        <div className="flex items-center gap-3 mb-4">
          <div
            className="flex-1 rounded-lg px-3 py-2 text-sm font-mono truncate"
            style={{
              background: t.bgDeep,
              border: `1px solid ${t.border}`,
              color: watchFolder ? t.textPrimary : t.textMuted,
            }}
          >
            {watchFolder ?? 'No folder selected'}
          </div>
          <button
            onClick={pickFolder}
            disabled={isWatching}
            className="px-3 py-2 rounded-lg text-sm font-medium transition-colors"
            style={{
              background: isWatching ? t.bgDeep : t.primary,
              color: isWatching ? t.textDisabled : '#fff',
              cursor: isWatching ? 'not-allowed' : 'pointer',
              border: 'none',
              opacity: isWatching ? 0.5 : 1,
            }}
          >
            Browse…
          </button>
        </div>

        {/* Start / Stop button */}
        <button
          onClick={handleToggle}
          disabled={!watchFolder && !isWatching}
          className="w-full py-2.5 rounded-lg text-sm font-semibold transition-all"
          style={{
            background: isWatching
              ? 'rgba(239,68,68,0.15)'
              : !watchFolder
              ? t.bgDeep
              : t.primary,
            color: isWatching ? t.behind : !watchFolder ? t.textDisabled : '#fff',
            border: isWatching ? `1px solid rgba(239,68,68,0.35)` : 'none',
            cursor: !watchFolder && !isWatching ? 'not-allowed' : 'pointer',
          }}
        >
          {isWatching ? '⏹ Stop Watcher' : status === 'stopping' ? 'Stopping…' : '▶ Start Watcher'}
        </button>

        {!watchFolder && !isWatching && (
          <p className="text-xs text-center mt-2" style={{ color: t.textMuted }}>
            Select a folder first to enable the watcher
          </p>
        )}
      </div>

      {/* ── Today's Stats ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Files Processed',  value: stats.filesProcessed,      color: t.textPrimary },
          { label: 'RVUs Captured',    value: stats.rvusCaptured.toFixed(2), color: t.ahead },
          { label: 'Studies Committed',value: stats.studiesCommitted,     color: t.onTrack },
          { label: 'Needs Review',     value: stats.studiesNeedingReview, color: stats.studiesNeedingReview > 0 ? t.caution : t.textMuted },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-xl p-4 text-center"
            style={{ background: t.bgCard, border: `1px solid ${t.border}` }}
          >
            <div className="text-2xl font-bold" style={{ color: stat.color }}>
              {stat.value}
            </div>
            <div className="text-xs mt-1" style={{ color: t.textMuted }}>
              {stat.label}
            </div>
          </div>
        ))}
      </div>

      {/* ── Review Queue Notice ────────────────────────────────────────────── */}
      {pendingReviewCount > 0 && (
        <div
          className="flex items-center justify-between rounded-xl px-4 py-3"
          style={{
            background: 'rgba(245,158,11,0.08)',
            border: `1px solid rgba(245,158,11,0.3)`,
          }}
        >
          <div className="flex items-center gap-2">
            <span className="text-base">⚠️</span>
            <p className="text-sm" style={{ color: t.caution }}>
              <strong>{pendingReviewCount}</strong> study{pendingReviewCount !== 1 ? 's' : ''} need manual review — OCR confidence too low to auto-commit.
            </p>
          </div>
          {onNavigateToImport && (
            <button
              onClick={onNavigateToImport}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg"
              style={{ background: 'rgba(245,158,11,0.15)', color: t.caution, border: `1px solid rgba(245,158,11,0.3)` }}
            >
              Go to Import →
            </button>
          )}
        </div>
      )}

      {/* ── Activity Log ──────────────────────────────────────────────────── */}
      <div
        className="rounded-xl"
        style={{ background: t.bgCard, border: `1px solid ${t.border}` }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: t.border }}>
          <h3 className="text-sm font-semibold" style={{ color: t.textPrimary }}>
            Activity Log
          </h3>
          {activityLog.length > 0 && (
            <button
              onClick={clearActivity}
              className="text-xs"
              style={{ color: t.textMuted, background: 'none', border: 'none', cursor: 'pointer' }}
            >
              Clear
            </button>
          )}
        </div>

        {activityLog.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-sm" style={{ color: t.textMuted }}>
              {isWatching ? 'Watching for screenshots…' : 'Start the watcher to see activity here.'}
            </p>
          </div>
        ) : (
          <div className="max-h-80 overflow-y-auto">
            {activityLog.map((entry) => (
              <div
                key={entry.id}
                className="flex items-start gap-3 px-4 py-2.5 border-b last:border-0"
                style={{ borderColor: t.border }}
              >
                <span className="text-base mt-0.5 shrink-0">{statusDot(entry.status)}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className="text-xs font-mono truncate max-w-[240px]"
                      style={{ color: t.textSecondary }}
                      title={entry.filePath}
                    >
                      {entry.fileName || entry.filePath}
                    </span>
                    <span className="text-xs" style={{ color: statusColor(entry.status) }}>
                      {entry.message}
                    </span>
                  </div>
                  {entry.studiesCommitted !== undefined && entry.studiesCommitted > 0 && (
                    <div className="text-xs mt-0.5" style={{ color: t.textMuted }}>
                      +{entry.rvusCaptured?.toFixed(2) ?? '0'} RVUs · {entry.studiesCommitted} committed
                    </div>
                  )}
                </div>
                <span className="text-xs shrink-0" style={{ color: t.textMuted }}>
                  {formatTime(entry.timestamp)}
                </span>
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        )}
      </div>

      {/* ── Setup Tips ────────────────────────────────────────────────────── */}
      <div
        className="rounded-xl p-4"
        style={{ background: t.bgCard, border: `1px solid ${t.border}` }}
      >
        <p className="text-xs font-semibold mb-2" style={{ color: t.textSecondary }}>
          Setup Tips
        </p>
        <ul className="space-y-1 text-xs list-disc list-inside" style={{ color: t.textMuted }}>
          <li>Use the <strong style={{ color: t.textSecondary }}>PowerScribe_Watcher.ahk</strong> AutoHotkey script to auto-screenshot with <kbd>Win+Shift+P</kbd></li>
          <li>Screenshots saved to the watch folder are processed automatically within ~1 second</li>
          <li>Processed files move to <code style={{ color: t.textSecondary }}>processed/</code> · Failed files go to <code style={{ color: t.textSecondary }}>failed/</code></li>
          <li>Toggle <strong style={{ color: t.textSecondary }}>Auto-delete processed</strong> in Settings → Watcher if you prefer not to keep copies</li>
          <li>High-confidence studies are committed immediately; low-confidence ones appear in the Import tab for review</li>
        </ul>
      </div>

    </div>
  );
}
