/**
 * Today.tsx
 *
 * The workday-first HUD per the UI modernization spec's "Today" screen.
 * Reskins the existing Daily Pace logic (computeDailyPace) — the math is
 * untouched, only the presentation changes.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import { useOrg } from '../hooks/useOrg';
import {
  computeDailyPace,
  DEFAULT_DAILY_PACE_SETTINGS,
  formatMinutes,
  type DailyPaceMetrics,
  type DailyPaceSettings,
} from '../utils/dailyPaceCalculations';
import { todayDateString } from '../utils/calculations';
import { ConfettiCanvas } from '../components/ConfettiCanvas';
import { MiniPaceWindow } from '../components/MiniPaceWindow';
import { Ring, useCountUp } from '../components/ui/Ring';
import { StatCard } from '../components/ui/StatCard';
import { StatusPill } from '../components/ui/StatusPill';
import { GroupedList, Row } from '../components/ui/GroupedList';
import { MatchSourceFootnote } from '../components/ui/MatchSourceFootnote';
import type { StudyLog } from '../types';
import { MODALITY_LABELS } from '../types';

function displayTitle(log: StudyLog): string {
  return log.examTitleDisplay?.trim() || log.examNameRaw;
}

function isDeleted(log: StudyLog): boolean {
  return Boolean((log as any).deletedAt);
}

function isCaptureCommitted(log: StudyLog): boolean {
  return log.dateTimeSource === 'ocr' || log.dateTimeSource === 'llm_ocr_cleanup';
}

function startOfWeek(date: string): string {
  const d = new Date(date + 'T12:00:00');
  d.setDate(d.getDate() - d.getDay());
  return d.toISOString().slice(0, 10);
}

function startOfMonth(date: string): string {
  return date.slice(0, 7) + '-01';
}

function paceLine(metrics: DailyPaceMetrics): { text: string; tone: 'positive' | 'caution' | 'neutral' } {
  if (metrics.status === 'before_work') return { text: 'Not started yet', tone: 'neutral' };
  if (metrics.status === 'goal_achieved') return { text: 'Goal achieved', tone: 'positive' };
  const diff = metrics.paceDifference;
  if (Math.abs(diff) < 1) return { text: 'On pace', tone: 'positive' };
  if (diff > 0) return { text: `Ahead by ${diff.toFixed(1)}`, tone: 'positive' };
  return { text: `${Math.abs(diff).toFixed(1)} behind pace`, tone: 'caution' };
}

interface TodayProps {
  onNavigate: (path: string) => void;
}

export function Today({ onNavigate }: TodayProps) {
  const today = todayDateString();
  const { activeProfile } = useOrg();
  const profileId = activeProfile?.id ?? null;

  const todayLogs = useLiveQuery(
    async () => {
      if (!profileId) return [];
      const all = await db.studyLogs.where('logDate').equals(today).toArray();
      return all.filter((log) => !isDeleted(log) && (log.profileId === profileId || log.profileId == null));
    },
    [today, profileId],
    [],
  );

  const weekCount = useLiveQuery(
    async () => {
      if (!profileId) return 0;
      const all = await db.studyLogs.where('logDate').between(startOfWeek(today), today, true, true).toArray();
      return all.filter((log) => !isDeleted(log) && (log.profileId === profileId || log.profileId == null)).length;
    },
    [today, profileId],
    0,
  );

  const monthCount = useLiveQuery(
    async () => {
      if (!profileId) return 0;
      const all = await db.studyLogs.where('logDate').between(startOfMonth(today), today, true, true).toArray();
      return all.filter((log) => !isDeleted(log) && (log.profileId === profileId || log.profileId == null)).length;
    },
    [today, profileId],
    0,
  );

  const recentLogs = useLiveQuery(
    async () => {
      if (!profileId) return [];
      // createdAt isn't an indexed field — use the indexed logDate to bound
      // the scan to the trailing 30 days, then sort by createdAt in memory.
      const thirtyDaysAgo = new Date(today + 'T12:00:00');
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const windowStart = thirtyDaysAgo.toISOString().slice(0, 10);
      const all = await db.studyLogs.where('logDate').between(windowStart, today, true, true).toArray();
      return all
        .filter((log) => !isDeleted(log) && (log.profileId === profileId || log.profileId == null))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 5);
    },
    [today, profileId],
    [],
  );

  const everLoggedCount = useLiveQuery(
    async () => {
      if (!profileId) return 0;
      const all = await db.studyLogs.toArray();
      return all.filter((log) => !isDeleted(log) && (log.profileId === profileId || log.profileId == null)).length;
    },
    [profileId],
    0,
  );

  const activeSession = useLiveQuery(
    async () => {
      const sessions = await db.activeReviewSessions.where('status').equals('active').reverse().sortBy('updatedAt');
      return sessions.find((session) => session.profileId === profileId || session.profileId == null) ?? null;
    },
    [profileId],
    null,
  );

  const settings = useLiveQuery(() => db.userSettings.get('default'), [], undefined);
  const watcherArmed = settings?.autoImportClipboardScreenshots === true;

  const paceSettings: DailyPaceSettings = {
    dailyRvuGoal: activeProfile?.dailyRvuGoal ?? DEFAULT_DAILY_PACE_SETTINGS.dailyRvuGoal,
    workdayStart: activeProfile?.workdayStart ?? DEFAULT_DAILY_PACE_SETTINGS.workdayStart,
    workdayEnd: activeProfile?.workdayEnd ?? DEFAULT_DAILY_PACE_SETTINGS.workdayEnd,
    breakMinutes: activeProfile?.breakMinutes ?? DEFAULT_DAILY_PACE_SETTINGS.breakMinutes,
  };

  const prevAchievedRef = useRef(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [metrics, setMetrics] = useState<DailyPaceMetrics | null>(null);

  const recalculate = useCallback(() => {
    if (!todayLogs) return;
    const m = computeDailyPace(todayLogs, paceSettings, prevAchievedRef.current);
    setMetrics(m);
    if (m.goalJustAchieved) {
      prevAchievedRef.current = true;
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 4500);
    }
    if (m.currentRvu < m.dailyGoal) prevAchievedRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    todayLogs,
    paceSettings.dailyRvuGoal,
    paceSettings.workdayStart,
    paceSettings.workdayEnd,
    paceSettings.breakMinutes,
  ]);

  useEffect(() => {
    recalculate();
    const interval = setInterval(recalculate, 60_000);
    return () => clearInterval(interval);
  }, [recalculate]);

  const [miniFallbackOpen, setMiniFallbackOpen] = useState(false);
  const openMiniWindow = useCallback(() => {
    if (typeof window === 'undefined') return;
    const url = new URL('/?mini=pace', window.location.origin).toString();
    const popup = window.open(
      url,
      'wrvu-mini-pace',
      'width=440,height=230,resizable=yes,scrollbars=no,toolbar=no,menubar=no,location=no,status=no',
    );
    if (!popup) {
      setMiniFallbackOpen(true);
      return;
    }
    popup.focus();
  }, []);

  const animatedRvu = useCountUp(metrics?.currentRvu ?? 0);

  if (!metrics || todayLogs === undefined) {
    return (
      <div className="flex items-center justify-center py-24">
        <div
          className="h-8 w-8 animate-spin rounded-full border-2 border-t-transparent"
          style={{ borderColor: 'var(--rd-accent) transparent var(--rd-accent) var(--rd-accent)' }}
        />
      </div>
    );
  }

  // First-time empty state: never logged anything, ever.
  if (everLoggedCount === 0) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-6 py-20 text-center">
        <Ring percent={0} size={180} label="No studies logged yet">
          <span className="text-[40px] font-bold leading-none text-rd-label-secondary [font-variant-numeric:tabular-nums]">
            0.0
          </span>
        </Ring>
        <div>
          <h1 className="text-[28px] font-bold text-rd-label-primary">Log your first study</h1>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('/log')}
          className="min-h-11 rounded-[10px] px-6 py-2.5 text-[15px] font-semibold text-white"
          style={{ background: 'var(--rd-accent)' }}
        >
          Log a study
        </button>
      </div>
    );
  }

  const pace = paceLine(metrics);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <ConfettiCanvas active={showConfetti} />

      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[34px] font-bold leading-tight text-rd-label-primary">Today</h1>
          <p className="text-[13px] text-rd-label-secondary">
            {activeProfile?.name ?? 'No radiologist'}
            {metrics.status === 'before_work' && ` · Shift starts at ${paceSettings.workdayStart}`}
          </p>
        </div>
        <button
          type="button"
          onClick={openMiniWindow}
          title="Open mini pace window"
          className="mt-1 flex size-9 shrink-0 items-center justify-center rounded-full text-rd-label-secondary hover:bg-rd-surface"
        >
          📌
        </button>
      </div>

      {miniFallbackOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-3">
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            aria-label="Close mini pace"
            onClick={() => setMiniFallbackOpen(false)}
          />
          <div className="relative w-full max-w-md overflow-hidden rounded-2xl bg-black shadow-2xl">
            <button
              type="button"
              onClick={() => setMiniFallbackOpen(false)}
              className="absolute right-2 top-2 z-10 rounded-lg border border-white/10 px-2 py-1 text-xs text-slate-300 hover:border-white/25 hover:text-white"
            >
              Close
            </button>
            <MiniPaceWindow embedded />
          </div>
        </div>
      )}

      {(watcherArmed || (activeSession && activeSession.needsReviewCount > 0)) && (
        <div className="flex flex-wrap gap-2">
          {watcherArmed && <StatusPill tone="accent">Watching for screenshots</StatusPill>}
          {activeSession && activeSession.needsReviewCount > 0 && (
            <StatusPill tone="caution" onClick={() => onNavigate('/log')}>
              {activeSession.needsReviewCount} {activeSession.needsReviewCount === 1 ? 'study needs' : 'studies need'} review
            </StatusPill>
          )}
        </div>
      )}

      <div className="flex flex-col items-center gap-3 py-4">
        <Ring percent={metrics.actualPercent} size={220} label={`${metrics.currentRvu.toFixed(1)} of ${metrics.dailyGoal} wRVU goal`}>
          <span className="text-[52px] font-bold leading-none text-rd-label-primary [font-variant-numeric:tabular-nums]">
            {animatedRvu.toFixed(1)}
          </span>
          <span className="mt-1 text-[13px] text-rd-label-secondary">of {metrics.dailyGoal} goal</span>
        </Ring>
        <p
          className="text-[17px] font-semibold"
          style={{ color: pace.tone === 'positive' ? 'var(--rd-positive)' : pace.tone === 'caution' ? 'var(--rd-caution)' : 'var(--rd-label-secondary)' }}
        >
          {pace.text}
        </p>
        {metrics.status !== 'before_work' && metrics.status !== 'goal_achieved' && (
          <p className="text-[13px] text-rd-label-secondary">
            {formatMinutes(metrics.elapsedWorkMinutes)} elapsed · {formatMinutes(metrics.remainingWorkMinutes)} remaining
          </p>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Today" value={String(todayLogs.length)} onClick={() => onNavigate('/trends')} />
        <StatCard label="This week" value={String(weekCount)} onClick={() => onNavigate('/trends')} />
        <StatCard label="This month" value={String(monthCount)} onClick={() => onNavigate('/trends')} />
      </div>

      <GroupedList header="Recent studies">
        {recentLogs.length === 0 && <Row footnote="Nothing logged yet">No recent studies</Row>}
        {recentLogs.map((log) => (
          <Row
            key={log.id}
            footnote={
              <div className="flex items-center gap-1.5 text-[13px] text-rd-label-secondary">
                {log.modality && <span>{MODALITY_LABELS[log.modality]}</span>}
                <MatchSourceFootnote method={log.matchMethod} />
              </div>
            }
            trailing={
              <span className="text-[15px] font-semibold text-rd-label-primary [font-variant-numeric:tabular-nums]">
                {log.workRvu?.toFixed(2) ?? '—'}
              </span>
            }
          >
            <div className="flex items-center gap-1.5">
              {isCaptureCommitted(log) && <span title="Auto-committed from capture">📷</span>}
              <span className="truncate">{log.cptCode ? `${log.cptCode} — ` : ''}{displayTitle(log)}</span>
            </div>
          </Row>
        ))}
        <Row onClick={() => onNavigate('/trends/history')} trailing={<span className="text-rd-accent">→</span>}>
          See all
        </Row>
      </GroupedList>
    </div>
  );
}
