/**
 * Today.tsx
 *
 * The workday-first HUD per the UI modernization spec's "Today" screen.
 * Reskins the existing Daily Pace logic (computeDailyPace) — the math is
 * untouched, only the presentation changes.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import { useOrg } from '../hooks/useOrg';
import {
  computeDailyPace,
  currentRatePerHour,
  DEFAULT_DAILY_PACE_SETTINGS,
  formatMinutes,
  projectedFinishClockTime,
  type DailyPaceMetrics,
  type DailyPaceSettings,
} from '../utils/dailyPaceCalculations';
import { computeByModality, computeYtdStats, todayDateString, topModalityShares } from '../utils/calculations';
import { buildTimelineBuckets, lensStart } from '../utils/historyTimeline';
import { MiniPaceWindow } from '../components/MiniPaceWindow';
import { Readout, type ReadoutTone } from '../components/ui/Readout';
import { Ring, useCountUp } from '../components/ui/Ring';
import { StatCard } from '../components/ui/StatCard';
import { StatusPill } from '../components/ui/StatusPill';
import { GroupedList, Row } from '../components/ui/GroupedList';
import { MatchSourceFootnote } from '../components/ui/MatchSourceFootnote';
import type { StudyLog } from '../types';
import { MODALITY_LABELS } from '../types';

const SPARKLINE_DAYS = 14;

/** One fixed-position cluster cell — label never disappears, value shows "—" when unavailable. */
function ClusterCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[20px] font-semibold leading-none text-rd-label-primary [font-variant-numeric:tabular-nums]">
        {value}
      </span>
      <span className="text-[12px] text-rd-label-secondary">{label}</span>
    </div>
  );
}

function displayTitle(log: StudyLog): string {
  return log.examTitleDisplay?.trim() || log.examNameRaw;
}

function isDeleted(log: StudyLog): boolean {
  return Boolean((log as any).deletedAt);
}

function isCaptureCommitted(log: StudyLog): boolean {
  return log.dateTimeSource === 'ocr' || log.dateTimeSource === 'llm_ocr_cleanup';
}

/** Combo (multi-CPT) commits share one sessionId across their StudyLog rows -- group them back into one line. */
function groupBySession(rows: StudyLog[]): StudyLog[][] {
  const bySession = new Map<string, StudyLog[]>();
  for (const log of rows) {
    if (!log.sessionId) continue;
    const arr = bySession.get(log.sessionId) ?? [];
    arr.push(log);
    bySession.set(log.sessionId, arr);
  }
  const groups: StudyLog[][] = [];
  const emitted = new Set<string>();
  for (const log of rows) {
    const combo = log.sessionId ? bySession.get(log.sessionId) : undefined;
    if (combo && combo.length > 1) {
      if (emitted.has(log.sessionId!)) continue;
      emitted.add(log.sessionId!);
      groups.push(combo);
    } else {
      groups.push([log]);
    }
  }
  return groups;
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
      // Over-fetch beyond the 8-row display limit so a multi-CPT combo's
      // sibling StudyLog rows aren't truncated mid-group before grouping.
      return all
        .filter((log) => !isDeleted(log) && (log.profileId === profileId || log.profileId == null))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 24);
    },
    [today, profileId],
    [],
  );
  const recentGroups = useMemo(() => groupBySession(recentLogs).slice(0, 8), [recentLogs]);

  const sparklineWindowStart = useMemo(() => lensStart('day', today, SPARKLINE_DAYS), [today]);
  const sparklineLogs = useLiveQuery(
    async () => {
      if (!profileId) return [];
      const all = await db.studyLogs.where('logDate').between(sparklineWindowStart, today, true, true).toArray();
      return all.filter((log) => !isDeleted(log) && (log.profileId === profileId || log.profileId == null));
    },
    [sparklineWindowStart, today, profileId],
    [],
  );

  const yearStart = useMemo(() => lensStart('year', today), [today]);
  const ytdLogs = useLiveQuery(
    async () => {
      if (!profileId) return [];
      const all = await db.studyLogs.where('logDate').between(yearStart, today, true, true).toArray();
      return all.filter((log) => !isDeleted(log) && (log.profileId === profileId || log.profileId == null));
    },
    [yearStart, today, profileId],
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
  const [metrics, setMetrics] = useState<DailyPaceMetrics | null>(null);

  const recalculate = useCallback(() => {
    if (!todayLogs) return;
    const m = computeDailyPace(todayLogs, paceSettings, prevAchievedRef.current);
    setMetrics(m);
    if (m.goalJustAchieved) prevAchievedRef.current = true;
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
      'width=320,height=280,resizable=yes,scrollbars=no,toolbar=no,menubar=no,location=no,status=no',
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
      <div className="mx-auto max-w-2xl space-y-10">
        <div className="sticky top-0 z-20 -mx-3 border-b border-rd-separator bg-rd-bg/95 px-3 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0 sm:backdrop-blur-none">
          <Readout parts={[
            { text: '0.0 wRVU' },
            { text: 'Not started yet' },
            { text: 'all counted', tone: 'positive' },
          ]} />
        </div>
        <div className="flex flex-col items-center gap-6 py-16 text-center">
          <Ring percent={0} size={180} label="No studies logged yet">
            <span className="text-[40px] font-bold leading-none text-rd-label-secondary [font-variant-numeric:tabular-nums]">
              0.0
            </span>
          </Ring>
          <h1 className="text-[28px] font-bold text-rd-label-primary">Nothing logged yet today</h1>
          <button
            type="button"
            onClick={() => onNavigate('/log')}
            className="min-h-11 rounded-[10px] bg-rd-label-primary px-6 py-2.5 text-[15px] font-semibold text-rd-bg"
          >
            + Capture
          </button>
        </div>
      </div>
    );
  }

  const pace = paceLine(metrics);
  const attentionCount = activeSession?.needsReviewCount ?? 0;
  const paceTone: ReadoutTone = metrics.status === 'goal_achieved'
    ? 'reached'
    : pace.tone === 'positive'
      ? 'positive'
      : pace.tone === 'caution'
        ? 'caution'
        : 'neutral';

  // ── Pace cluster: fixed six-cell grid, every value from computeDailyPace's
  // own outputs (or a simple derived rate) — no parallel math, no new queries.
  const notStarted = metrics.status === 'before_work';
  const rate = currentRatePerHour(metrics);
  const projectedValue = notStarted ? '—' : metrics.status === 'goal_achieved' ? 'Goal hit' : metrics.projectedEndOfDay.toFixed(0);
  const projectedTime = notStarted || metrics.status === 'goal_achieved' ? null : projectedFinishClockTime(metrics);
  const cluster = {
    expectedNow: notStarted ? '—' : metrics.expectedRvu.toFixed(1),
    aheadBehind: notStarted ? '—' : `${metrics.paceDifference >= 0 ? '+' : ''}${metrics.paceDifference.toFixed(1)}`,
    projected: projectedTime ? `${projectedValue} · ${projectedTime}` : projectedValue,
    remaining: metrics.status === 'goal_achieved' ? '0.0' : metrics.remainingToGoal.toFixed(1),
    requiredRate: metrics.status === 'goal_achieved' || metrics.status === 'after_work' ? '—' : `${metrics.requiredRvuPerHour.toFixed(1)}/hr`,
    currentRate: rate == null ? '—' : `${rate.toFixed(1)}/hr`,
  };

  // ── Trends row: sparkline, annual progress, modality mix — all derived
  // from data already queried on this screen, reconciled by construction.
  const sparklineBuckets = buildTimelineBuckets('day', sparklineLogs, today, SPARKLINE_DAYS);
  const sparklineMax = Math.max(1, ...sparklineBuckets.map((bucket) => bucket.rvu));
  const modalityShares = topModalityShares(computeByModality(todayLogs));
  const ytdStats = settings ? computeYtdStats(ytdLogs, settings) : null;
  let annualText: string | null = null;
  if (ytdStats && ytdStats.annualGoal > 0) {
    const totalDaysInYear = ytdStats.daysElapsedInYear + ytdStats.daysRemainingInYear;
    const yearFraction = totalDaysInYear > 0 ? ytdStats.daysElapsedInYear / totalDaysInYear : 0;
    const expectedYtd = ytdStats.annualGoal * yearFraction;
    const pctVsExpected = expectedYtd > 0 ? ((ytdStats.ytdWorkRvu - expectedYtd) / expectedYtd) * 100 : 0;
    const vsTarget = Math.abs(pctVsExpected) < 1
      ? 'on target'
      : `${Math.abs(pctVsExpected).toFixed(0)}% ${pctVsExpected >= 0 ? 'over' : 'under'} target`;
    annualText = `Annual ${ytdStats.ytdWorkRvu.toFixed(0)}/${ytdStats.annualGoal.toLocaleString('en-US')} · ${vsTarget}`;
  } else if (ytdStats) {
    annualText = `Annual ${ytdStats.ytdWorkRvu.toLocaleString('en-US', { maximumFractionDigits: 0 })} wRVU`;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="sticky top-0 z-20 -mx-3 border-b border-rd-separator bg-rd-bg/95 px-3 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0 sm:backdrop-blur-none">
        <Readout parts={[
          { text: `${metrics.currentRvu.toFixed(1)} wRVU` },
          { text: pace.text, tone: paceTone },
          {
            text: attentionCount === 0
              ? 'all counted'
              : `${attentionCount} ${attentionCount === 1 ? 'needs' : 'need'} your eyes`,
            tone: attentionCount > 0 ? 'caution' : 'positive',
          },
        ]} />
      </div>

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
        {metrics.status !== 'before_work' && metrics.status !== 'goal_achieved' && (
          <p className="text-[13px] text-rd-label-secondary">
            {formatMinutes(metrics.elapsedWorkMinutes)} elapsed · {formatMinutes(metrics.remainingWorkMinutes)} remaining
          </p>
        )}
        {settings?.estimatedCompPerWrvu != null && settings.estimatedCompPerWrvu > 0 && (
          <p className="text-[13px] text-rd-label-secondary">
            ≈ ${(metrics.currentRvu * settings.estimatedCompPerWrvu).toLocaleString('en-US', { maximumFractionDigits: 0 })} earned today
          </p>
        )}
      </div>

      <div className="grid grid-cols-3 gap-x-4 gap-y-3 rounded-[16px] bg-rd-surface p-4" style={{ boxShadow: 'var(--rd-shadow-card)' }}>
        <ClusterCell label="Expected now" value={cluster.expectedNow} />
        <ClusterCell label="Ahead/behind" value={cluster.aheadBehind} />
        <ClusterCell label="Projected" value={cluster.projected} />
        <ClusterCell label="Remaining" value={cluster.remaining} />
        <ClusterCell label="Required rate" value={cluster.requiredRate} />
        <ClusterCell label="Current rate" value={cluster.currentRate} />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Today" value={String(todayLogs.length)} onClick={() => onNavigate('/trends')} />
        <StatCard label="This week" value={String(weekCount)} onClick={() => onNavigate('/trends')} />
        <StatCard label="This month" value={String(monthCount)} onClick={() => onNavigate('/trends')} />
      </div>

      <div className="space-y-2 rounded-[16px] bg-rd-surface p-4" style={{ boxShadow: 'var(--rd-shadow-card)' }}>
        <p className="sr-only">
          Daily wRVU for the last {SPARKLINE_DAYS} days: {sparklineBuckets.map((bucket) => `${bucket.label} ${bucket.rvu.toFixed(1)}`).join(', ')}
        </p>
        <div className="flex h-8 items-end gap-[3px]" aria-hidden="true">
          {sparklineBuckets.map((bucket) => (
            <span
              key={bucket.key}
              title={`${bucket.label}: ${bucket.rvu.toFixed(1)} wRVU`}
              className="flex-1 rounded-[2px] bg-rd-label-primary"
              style={{ height: `${Math.max(6, (bucket.rvu / sparklineMax) * 100)}%`, opacity: bucket.key === today ? 1 : 0.45 }}
            />
          ))}
        </div>
        {annualText && (
          <button
            type="button"
            onClick={() => onNavigate('/trends/history?lens=year')}
            className="block text-[13px] text-rd-label-secondary"
          >
            {annualText}
          </button>
        )}
        {modalityShares.length > 0 && (
          <p className="text-[13px] text-rd-label-secondary [font-variant-numeric:tabular-nums]">
            {modalityShares.map((share, index) => (
              <span key={share.modality}>
                {index > 0 && ' · '}
                {share.label} {share.percent.toFixed(0)}%
              </span>
            ))}
            {' of today’s wRVU'}
          </p>
        )}
      </div>

      <GroupedList header="Recent studies">
        {recentGroups.length === 0 && <Row dense footnote="Nothing logged yet">No recent studies</Row>}
        {recentGroups.map((comboLogs, index) => {
          const log = comboLogs[0];
          const cptDisplay = comboLogs.length > 1 ? comboLogs.map((l) => l.cptCode).filter(Boolean).join(' + ') : log.cptCode;
          const wrvuDisplay = comboLogs.length > 1 ? comboLogs.reduce((sum, l) => sum + (l.workRvu ?? 0), 0).toFixed(2) : (log.workRvu?.toFixed(2) ?? '—');
          return (
            <Row
              key={log.sessionId ?? log.id}
              dense
              className={index >= 6 ? 'rd-density-extra' : undefined}
              footnote={
                <div className="flex items-center gap-1.5 text-[13px] text-rd-label-secondary">
                  {log.modality && <span>{MODALITY_LABELS[log.modality]}</span>}
                  <MatchSourceFootnote method={log.matchMethod} />
                </div>
              }
              trailing={
                <span className="text-[15px] font-semibold text-rd-label-primary [font-variant-numeric:tabular-nums]">
                  {wrvuDisplay}
                </span>
              }
            >
              <div className="flex items-center gap-1.5">
                {isCaptureCommitted(log) && <span title="Auto-committed from capture">📷</span>}
                <span className="truncate">{cptDisplay ? `${cptDisplay} — ` : ''}{displayTitle(log)}</span>
              </div>
            </Row>
          );
        })}
        <Row dense onClick={() => onNavigate('/trends/history')} trailing={<span className="text-rd-accent">→</span>}>
          See all
        </Row>
      </GroupedList>
    </div>
  );
}
