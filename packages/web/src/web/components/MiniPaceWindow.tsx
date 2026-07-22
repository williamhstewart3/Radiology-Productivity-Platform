/**
 * MiniPaceWindow.tsx
 *
 * The flagship instrument of the Density Pass (owner decision, 2026-07-12):
 * this window sits beside PACS for an entire shift while the radiologist
 * reads. The full app is the between-cases / end-of-day surface — this is
 * the one that's actually watched. Every figure reads from the same
 * selectors as Today (computeDailyPace, currentRatePerHour,
 * projectedFinishClockTime) — zero new math, reconciles by construction.
 *
 * Always dark (reading-room HUD), independent of the main window's
 * light/dark setting since this renders in its own popup document — colors
 * are hardcoded to match the app's dark-mode rd-* tokens rather than reading
 * CSS custom properties, since nothing sets the rd-dark class in a popup.
 *
 * DATA SOURCE: studyLogs + activeReviewSessions + userSettings, all via
 * Dexie live queries shared with the rest of the app.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import { useProfile } from '../hooks/useProfile';
import {
  computeDailyPace,
  currentRatePerHour,
  DEFAULT_DAILY_PACE_SETTINGS,
  formatMinutes,
  projectedFinishClockTime,
  type DailyPaceMetrics,
  type DailyPaceSettings,
} from '../utils/dailyPaceCalculations';
import { todayDateString } from '../utils/calculations';
import type { StudyLog } from '../types';

const HUD_BG = '#0A0E1A';
const HUD_SURFACE = '#111827';
const HUD_SEPARATOR = '#1E2D45';
const HUD_LABEL_PRIMARY = '#F0F4FF';
const HUD_LABEL_SECONDARY = '#8892A4';
const HUD_POSITIVE = '#4CC38A';
const HUD_POSITIVE_DARK = '#2A6B4C';
const HUD_CAUTION = '#E5A13D';
const HUD_CAUTION_DARK = '#7E5922';
const HUD_NEUTRAL = HUD_LABEL_SECONDARY;
const HUD_NEUTRAL_DARK = '#4B505A';
const HUD_FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif';

function isDeleted(log: StudyLog): boolean {
  return Boolean((log as StudyLog & { deletedAt?: string }).deletedAt);
}

function title(log: StudyLog): string {
  return log.examTitleDisplay?.trim() || log.examNameRaw;
}

/** [fill color, gradient-start color] for the given pace status — same
 *  four-state semantic vocabulary as the rest of the app (positive/caution/
 *  neutral); 'after_work' reads neutral, matching getStatusDisplay's
 *  'Shift Complete' treatment rather than an alarm tone. */
function paceColors(status: DailyPaceMetrics['status']): [string, string] {
  switch (status) {
    case 'ahead':
    case 'goal_achieved':
    case 'on_track':
      return [HUD_POSITIVE, HUD_POSITIVE_DARK];
    case 'slightly_behind':
    case 'behind':
      return [HUD_CAUTION, HUD_CAUTION_DARK];
    default:
      return [HUD_NEUTRAL, HUD_NEUTRAL_DARK];
  }
}

function deltaText(metrics: DailyPaceMetrics): string {
  if (metrics.status === 'before_work') return '—';
  if (metrics.status === 'goal_achieved') return 'Goal hit';
  const diff = metrics.paceDifference;
  if (Math.abs(diff) < 0.05) return 'On pace';
  const arrow = diff > 0 ? '▲' : '▼';
  return `${diff > 0 ? '+' : ''}${diff.toFixed(1)} ${arrow}`;
}

function expectedProjectedText(metrics: DailyPaceMetrics): string {
  if (metrics.status === 'before_work') return 'now — · proj —';
  const projected = metrics.status === 'goal_achieved' ? 'goal hit' : metrics.projectedEndOfDay.toFixed(0);
  const finish = metrics.status === 'goal_achieved' ? null : projectedFinishClockTime(metrics);
  return `now ${metrics.expectedRvu.toFixed(1)} · proj ${projected}${finish ? ` · ${finish}` : ''}`;
}

function rateText(metrics: DailyPaceMetrics): string {
  const rate = currentRatePerHour(metrics);
  const need = metrics.status === 'goal_achieved' || metrics.status === 'after_work' ? '—' : `${metrics.requiredRvuPerHour.toFixed(1)}/hr`;
  const at = rate == null ? '—' : `${rate.toFixed(1)}/hr`;
  return `need ${need} · at ${at}`;
}

interface MiniPaceWindowProps {
  embedded?: boolean;
  targetWindow?: Window;
  onNavigate?: (path: string) => void;
}

export function MiniPaceWindow({ embedded = false, targetWindow, onNavigate }: MiniPaceWindowProps) {
  const today = todayDateString();
  const { activeProfile } = useProfile();
  const profileId = activeProfile?.id ?? null;

  const todayLogs = useLiveQuery(
    async () => {
      if (!profileId) return [];
      const all = await db.studyLogs.where('logDate').equals(today).toArray();
      return all.filter((l) => !isDeleted(l) && (l.profileId === profileId || l.profileId == null));
    },
    [today, profileId],
    [],
  );
  const inboxCount = useLiveQuery(async () => {
    const sessions = await db.activeReviewSessions.where('status').equals('active').toArray();
    return sessions.filter((session) => session.profileId === profileId || session.profileId == null).reduce((sum, session) => sum + session.needsReviewCount, 0);
  }, [profileId], 0);
  const settings = useLiveQuery(() => db.userSettings.get('default'), [], undefined);
  const watcherArmed = settings?.autoImportClipboardScreenshots === true;

  const paceSettings: DailyPaceSettings = useMemo(() => ({
    dailyRvuGoal: activeProfile?.dailyRvuGoal ?? DEFAULT_DAILY_PACE_SETTINGS.dailyRvuGoal,
    workdayStart: activeProfile?.workdayStart ?? DEFAULT_DAILY_PACE_SETTINGS.workdayStart,
    workdayEnd:   activeProfile?.workdayEnd   ?? DEFAULT_DAILY_PACE_SETTINGS.workdayEnd,
    breakMinutes: activeProfile?.breakMinutes ?? DEFAULT_DAILY_PACE_SETTINGS.breakMinutes,
  }), [
    activeProfile?.dailyRvuGoal,
    activeProfile?.workdayStart,
    activeProfile?.workdayEnd,
    activeProfile?.breakMinutes,
  ]);

  const prevAchievedRef = useRef(false);
  const [metrics, setMetrics] = useState<DailyPaceMetrics | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());

  const recalculate = useCallback(() => {
    if (!todayLogs) return;
    const m = computeDailyPace(todayLogs, paceSettings, prevAchievedRef.current);
    setMetrics(m);
    setNowTick(Date.now());
    if (m.goalJustAchieved) prevAchievedRef.current = true;
    if (m.currentRvu < m.dailyGoal) prevAchievedRef.current = false;
  }, [todayLogs, paceSettings]);

  useEffect(() => {
    recalculate();
    const iv = setInterval(recalculate, 60_000);
    return () => clearInterval(iv);
  }, [recalculate]);

  useEffect(() => {
    const targetDocument = targetWindow?.document ?? document;
    targetDocument.title = metrics ? `${metrics.currentRvu.toFixed(1)} / ${metrics.dailyGoal} wRVU` : 'wRVU Pace';
  }, [metrics, targetWindow]);

  const recentStudies = useMemo(
    () => [...todayLogs]
      .filter((log) => !log.needsReview)
      .sort((a, b) => (b.studyDateTime ?? b.createdAt).localeCompare(a.studyDateTime ?? a.createdAt))
      .slice(0, 3),
    [todayLogs],
  );
  const recentStudiesKey = recentStudies.map((log) => log.id).join(',');

  const lastCaptureAt = useMemo(() => {
    if (todayLogs.length === 0) return null;
    return todayLogs.reduce((latest, log) => (log.createdAt > latest ? log.createdAt : latest), todayLogs[0].createdAt);
  }, [todayLogs]);

  // New-commit fade: mark ids newly present since the last tick, fade them
  // in once, then forget. Initial mount doesn't animate (nothing is "new").
  const seenIdsRef = useRef<Set<string> | null>(null);
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
  const reducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    const currentIds = new Set(recentStudiesKey ? recentStudiesKey.split(',') : []);
    if (seenIdsRef.current === null) {
      seenIdsRef.current = currentIds;
      return;
    }
    const newlyAdded = [...currentIds].filter((id) => !seenIdsRef.current!.has(id));
    seenIdsRef.current = currentIds;
    if (newlyAdded.length === 0 || reducedMotion) return;
    setFreshIds(new Set(newlyAdded));
    const timer = setTimeout(() => setFreshIds(new Set()), 200);
    return () => clearTimeout(timer);
  }, [recentStudiesKey, reducedMotion]);

  const goTo = useCallback((path: string) => {
    if (onNavigate) {
      onNavigate(path);
      return;
    }
    window.opener?.location.assign(path);
    window.focus();
  }, [onNavigate]);

  if (!metrics || todayLogs === undefined) {
    return (
      <div style={{ minHeight: embedded ? '200px' : '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: HUD_BG }}>
        <div style={{ width: 28, height: 28, borderRadius: '50%', border: `2px solid ${HUD_POSITIVE}`, borderTopColor: 'transparent', animation: 'rd-mini-spin 0.8s linear' }} />
        <style>{'@keyframes rd-mini-spin { to { transform: rotate(360deg); } }'}</style>
      </div>
    );
  }

  const [color, colorDark] = paceColors(metrics.status);
  const goalPercent = Math.max(0, Math.min(100, metrics.actualPercent));
  const elapsedSinceCapture = lastCaptureAt ? Math.max(0, (nowTick - new Date(lastCaptureAt).getTime()) / 60_000) : null;

  return (
    <div
      style={{
        minHeight: embedded ? 'auto' : '100vh',
        width: embedded ? '100%' : undefined,
        background: HUD_BG,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 14,
        fontFamily: HUD_FONT,
        boxSizing: 'border-box',
      }}
    >
      <style>{'@keyframes rd-mini-row-fade { from { opacity: 0; transform: translateY(-2px); } to { opacity: 1; transform: translateY(0); } }'}</style>

      {/* Rank #1 — pace block, owns the top half */}
      <button
        type="button"
        onClick={() => goTo('/today')}
        style={{ border: 0, padding: 0, background: 'transparent', textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}
      >
        <span style={{ fontSize: 34, fontWeight: 700, color: HUD_LABEL_PRIMARY, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
          {metrics.currentRvu.toFixed(1)}
        </span>
        <span style={{ fontSize: 15, fontWeight: 600, color, fontVariantNumeric: 'tabular-nums' }}>{deltaText(metrics)}</span>
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, color: HUD_LABEL_SECONDARY, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>of {metrics.dailyGoal}</span>
        <div style={{ flex: 1, height: 6, borderRadius: 3, background: HUD_SURFACE, overflow: 'hidden' }}>
          <div style={{ width: `${goalPercent}%`, height: '100%', borderRadius: 3, background: `linear-gradient(to right, ${colorDark}, ${color})` }} />
        </div>
        <span style={{ fontSize: 12, color: HUD_LABEL_SECONDARY, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{goalPercent.toFixed(0)}%</span>
      </div>

      <span style={{ fontSize: 12, color: HUD_LABEL_SECONDARY, fontVariantNumeric: 'tabular-nums' }}>{expectedProjectedText(metrics)}</span>
      <span style={{ fontSize: 12, color: HUD_LABEL_SECONDARY, fontVariantNumeric: 'tabular-nums' }}>{rateText(metrics)}</span>

      <div style={{ height: 1, background: HUD_SEPARATOR }} />

      {/* Rank #2 — last 3 studies, confirms captures are landing in real time */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {recentStudies.length === 0 ? (
          <span style={{ fontSize: 12, color: HUD_LABEL_SECONDARY }}>No studies yet today</span>
        ) : (
          recentStudies.map((log) => (
            <button
              key={log.id}
              type="button"
              onClick={() => goTo(`/history?date=${log.logDate}`)}
              style={{
                border: 0,
                padding: 0,
                background: 'transparent',
                cursor: 'pointer',
                display: 'grid',
                gridTemplateColumns: '44px 1fr auto',
                alignItems: 'center',
                gap: 6,
                width: '100%',
                animation: freshIds.has(log.id) ? 'rd-mini-row-fade 150ms ease-out' : undefined,
              }}
            >
              <span style={{ fontSize: 11, color: HUD_LABEL_SECONDARY, textAlign: 'left', fontVariantNumeric: 'tabular-nums' }}>
                {log.studyDateTime ? new Date(log.studyDateTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '—'}
              </span>
              <span style={{ fontSize: 12, color: HUD_LABEL_PRIMARY, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {title(log)}
              </span>
              <span style={{ fontSize: 12, color: HUD_LABEL_PRIMARY, fontVariantNumeric: 'tabular-nums' }}>{log.workRvu?.toFixed(2) ?? '—'}</span>
            </button>
          ))
        )}
      </div>

      <div style={{ height: 1, background: HUD_SEPARATOR }} />

      {/* Rank #4 — quietest line, never absent */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <button
          type="button"
          onClick={() => goTo('/inbox')}
          style={{ border: 0, padding: 0, background: 'transparent', cursor: 'pointer', fontSize: 12, color: inboxCount > 0 ? HUD_CAUTION : HUD_LABEL_SECONDARY }}
        >
          {inboxCount > 0 ? `◔ ${inboxCount} inbox` : 'All counted'}
        </button>
        <span style={{ fontSize: 12, color: HUD_LABEL_SECONDARY }}>
          {watcherArmed ? '● watching' : '○ not watching'}
          {watcherArmed && elapsedSinceCapture != null ? ` ${formatMinutes(elapsedSinceCapture)} ago` : ''}
        </span>
      </div>
    </div>
  );
}
