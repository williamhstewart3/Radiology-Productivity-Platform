/**
 * DailyPaceDashboard.tsx
 *
 * Primary workday screen — shows real-time wRVU pace against daily goal.
 * Design: Apple Health / Bloomberg Terminal aesthetic, Baptist Medical Group branding.
 *
 * DATA SOURCE: studyLogs table only.
 * All study ingestion paths (manual, CSV, OCR, PowerScribe API) write to
 * studyLogs. This component never needs to change when new sources are added.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { motion } from 'framer-motion';
import { db } from '../db/database';
import { useProfile } from '../hooks/useProfile';
import {
  computeDailyPace,
  getStatusDisplay,
  formatMinutes,
  DEFAULT_DAILY_PACE_SETTINGS,
  type DailyPaceSettings,
  type DailyPaceMetrics,
} from '../utils/dailyPaceCalculations';
import { computeYtdStats, todayDateString } from '../utils/calculations';
import type { ActiveReviewSession, StudyLog, UserSettings } from '../types';
import { ConfettiCanvas } from './ConfettiCanvas';
import { MiniPaceWindow } from './MiniPaceWindow';
import { theme } from '../lib/theme';

// ─── Sparkline ───────────────────────────────────────────────────────────────

function Sparkline({ data, width = 120, height = 32 }: { data: number[]; width?: number; height?: number }) {
  const max = Math.max(1, ...data);
  const points = data
    .map((value, i) => {
      const x = (i / Math.max(1, data.length - 1)) * width;
      const y = height - (value / max) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg width={width} height={height} className="shrink-0">
      <polyline
        points={points}
        fill="none"
        stroke={theme.colors.accent}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ─── Status → color token ────────────────────────────────────────────────────

function statusColor(status: DailyPaceMetrics['status']): string {
  switch (status) {
    case 'goal_achieved': return theme.colors.goalGold;
    case 'ahead':         return theme.colors.ahead;
    case 'on_track':      return theme.colors.onTrack;
    case 'slightly_behind': return theme.colors.caution;
    case 'behind':        return theme.colors.behind;
    case 'after_work':    return theme.colors.accent;
    default:              return theme.colors.textMuted; // before_work
  }
}

// ─── Circular Gauge ──────────────────────────────────────────────────────────

interface GaugeProps {
  current: number;
  goal: number;
  status: DailyPaceMetrics['status'];
}

function CircularGauge({ current, goal, status }: GaugeProps) {
  const pct = Math.min(1, current / Math.max(1, goal));
  const radius = 90;
  const stroke = 10;
  const cx = 112;
  const cy = 112;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - pct);
  const color = statusColor(status);

  return (
    <div className="relative flex items-center justify-center">
      <svg
        width={224}
        height={224}
        style={{ filter: `drop-shadow(0 0 28px ${color}33)` }}
      >
        {/* Outer glow ring */}
        <circle
          cx={cx} cy={cy} r={radius + stroke}
          fill="none"
          stroke={`${color}08`}
          strokeWidth={1}
        />
        {/* Track */}
        <circle
          cx={cx} cy={cy} r={radius}
          fill="none"
          stroke="rgba(91,184,212,0.08)"
          strokeWidth={stroke}
        />
        {/* Track inner shade */}
        <circle
          cx={cx} cy={cy} r={radius}
          fill="none"
          stroke="rgba(0,0,0,0.15)"
          strokeWidth={stroke - 2}
        />
        {/* Progress arc */}
        <circle
          cx={cx} cy={cy} r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${cx} ${cy})`}
          style={{
            transition: 'stroke-dashoffset 0.9s cubic-bezier(0.34,1.56,0.64,1), stroke 0.5s ease',
            filter: `drop-shadow(0 0 6px ${color}88)`,
          }}
        />
        {/* Goal tick mark */}
        {pct < 0.98 && (
          <line
            x1={cx} y1={cy - radius + stroke / 2 - 4}
            x2={cx} y2={cy - radius - stroke / 2 + 2}
            stroke={`${color}50`}
            strokeWidth={2}
            strokeLinecap="round"
            transform={`rotate(0 ${cx} ${cy})`}
          />
        )}
      </svg>

      {/* Center text */}
      <div className="absolute flex flex-col items-center justify-center select-none gap-0.5">
        <span
          className="tabular-nums leading-none"
          style={{ fontSize: '2.75rem', fontWeight: 900, color, textShadow: `0 0 40px ${color}55`, letterSpacing: '-0.02em' }}
        >
          {current.toFixed(1)}
        </span>
        <div className="flex items-center gap-1 mt-0.5">
          <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--theme-text-muted)' }}>
            / {goal}
          </span>
          <span style={{ fontSize: '0.6875rem', color: 'var(--theme-text-disabled)', fontWeight: 500 }}>
            wRVU
          </span>
        </div>
        <span style={{ fontSize: '0.625rem', color: 'var(--theme-text-disabled)', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600 }}>
          today
        </span>
      </div>
    </div>
  );
}

// ─── Dual Progress Bars ──────────────────────────────────────────────────────

interface DualBarsProps {
  expectedPct: number;
  actualPct: number;
  progressStatus: 'ahead' | 'on_track' | 'behind' | 'neutral';
}

function DualProgressBars({ expectedPct, actualPct, progressStatus }: DualBarsProps) {
  const actualColor: Record<string, string> = {
    ahead:    theme.colors.ahead,
    on_track: theme.colors.onTrack,
    behind:   theme.colors.behind,
    neutral:  theme.colors.textDisabled,
  };
  const barColor = actualColor[progressStatus] ?? theme.colors.primary;
  const delta = actualPct - expectedPct;

  return (
    <div className="space-y-3">
      {/* Stacked overlay bars for intuitive comparison */}
      <div className="space-y-1.5">
        <div className="flex justify-between items-baseline">
          <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--theme-text-disabled)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
            Expected
          </span>
          <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--theme-text-muted)' }}>
            {expectedPct.toFixed(0)}%
          </span>
        </div>
        <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(91,184,212,0.07)' }}>
          <div
            className="h-2 rounded-full"
            style={{
              width: `${Math.min(100, expectedPct)}%`,
              background: 'linear-gradient(90deg, rgba(91,184,212,0.2), rgba(91,184,212,0.35))',
              transition: 'width 0.7s cubic-bezier(0.4,0,0.2,1)',
            }}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex justify-between items-baseline">
          <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--theme-text-disabled)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
            Actual
          </span>
          <div className="flex items-baseline gap-2">
            {Math.abs(delta) > 1 && (
              <span style={{
                fontSize: '11px', fontWeight: 700,
                color: delta >= 0 ? theme.colors.ahead : theme.colors.behind,
              }}>
                {delta >= 0 ? '+' : ''}{delta.toFixed(0)}%
              </span>
            )}
            <span style={{ fontSize: '13px', fontWeight: 700, color: barColor }}>
              {actualPct.toFixed(0)}%
            </span>
          </div>
        </div>
        <div className="h-2.5 rounded-full overflow-hidden" style={{ background: 'rgba(91,184,212,0.07)' }}>
          <div
            className="h-2.5 rounded-full"
            style={{
              width: `${Math.min(100, actualPct)}%`,
              background: `linear-gradient(90deg, ${barColor}cc, ${barColor})`,
              boxShadow: `0 0 10px ${barColor}44`,
              transition: 'width 0.8s cubic-bezier(0.34,1.2,0.64,1)',
            }}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

interface DailyPaceDashboardProps {
  onNavigate: (tab: string) => void;
}

export function DailyPaceDashboard({ onNavigate }: DailyPaceDashboardProps) {
  const today = todayDateString();
  const { activeProfile } = useProfile();
  const profileId = activeProfile?.id ?? null;

  const todayLogs = useLiveQuery(
    async () => {
      if (!profileId) return [];
      const all = await db.studyLogs.where('logDate').equals(today).toArray();
      return all.filter((l) => l.profileId === profileId || l.profileId == null);
    },
    [today, profileId],
    [],
  );

  const recentLogs = useLiveQuery<StudyLog[]>(
    async () => {
      if (!profileId) return [];
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 13);
      const cutoffDate = cutoff.toISOString().slice(0, 10);
      const all = await db.studyLogs.where('logDate').aboveOrEqual(cutoffDate).toArray();
      return all.filter((l) => !l.needsReview && !(l as any).deletedAt && (l.profileId === profileId || l.profileId == null));
    },
    [profileId],
    [],
  ) ?? [];

  const yearLogs = useLiveQuery<StudyLog[]>(
    async () => {
      if (!profileId) return [];
      const yearStart = `${new Date().getFullYear()}-01-01`;
      const all = await db.studyLogs.where('logDate').aboveOrEqual(yearStart).toArray();
      return all.filter((l) => !(l as any).deletedAt && (l.profileId === profileId || l.profileId == null));
    },
    [profileId],
    [],
  ) ?? [];

  const userSettings = useLiveQuery<UserSettings | undefined>(() => db.userSettings.get('default'), []);

  const activeSessions = useLiveQuery<ActiveReviewSession[]>(
    async () => {
      if (!profileId) return [];
      const all = await db.activeReviewSessions.toArray();
      return all.filter((s) => s.status === 'active' && (s.profileId === profileId || s.profileId == null));
    },
    [profileId],
    [],
  ) ?? [];
  const pendingReviewCount = activeSessions.reduce((sum, s) => sum + s.needsReviewCount, 0);

  const sparklineSeries = Array.from({ length: 14 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (13 - i));
    const date = d.toISOString().slice(0, 10);
    return recentLogs.filter((l) => l.logDate === date).reduce((sum, l) => sum + (l.workRvu ?? 0), 0);
  });
  const last14Total = sparklineSeries.reduce((sum, v) => sum + v, 0);

  const ytd = userSettings
    ? computeYtdStats(yearLogs, {
        ...userSettings,
        annualRvuGoal: activeProfile?.annualRvuGoal ?? userSettings.annualRvuGoal,
      })
    : null;
  const ytdPct = ytd && ytd.annualGoal > 0 ? Math.min(100, (ytd.ytdWorkRvu / ytd.annualGoal) * 100) : 0;

  const paceSettings: DailyPaceSettings = {
    dailyRvuGoal: activeProfile?.dailyRvuGoal ?? DEFAULT_DAILY_PACE_SETTINGS.dailyRvuGoal,
    workdayStart: activeProfile?.workdayStart ?? DEFAULT_DAILY_PACE_SETTINGS.workdayStart,
    workdayEnd:   activeProfile?.workdayEnd   ?? DEFAULT_DAILY_PACE_SETTINGS.workdayEnd,
    breakMinutes: activeProfile?.breakMinutes ?? DEFAULT_DAILY_PACE_SETTINGS.breakMinutes,
  };

  const prevAchievedRef = useRef(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [metrics, setMetrics] = useState<DailyPaceMetrics | null>(null);
  const [showMiniFallback, setShowMiniFallback] = useState(false);

  const recalculate = useCallback(() => {
    if (!todayLogs) return;
    const m = computeDailyPace(todayLogs, paceSettings, prevAchievedRef.current);
    setMetrics(m);

    if (m.goalJustAchieved) {
      prevAchievedRef.current = true;
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 4500);
    }
    if (m.currentRvu < m.dailyGoal) {
      prevAchievedRef.current = false;
    }
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

  const openMiniWindow = useCallback(() => {
    if (typeof window === 'undefined') return;
    const url = new URL('/?mini=pace', window.location.origin).toString();
    const popup = window.open(
      url,
      'wrvu-mini-pace',
      'width=700,height=300,resizable=yes,scrollbars=no,toolbar=no,menubar=no,location=no,status=no',
    );

    if (!popup) {
      setShowMiniFallback(true);
      return;
    }

    popup.focus();
  }, []);

  // ── Loading ──────────────────────────────────────────────────────────────
  if (!metrics || todayLogs === undefined) {
    return (
      <div className="flex items-center justify-center py-24">
        <div
          className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
          style={{ borderColor: `${theme.colors.accent} transparent ${theme.colors.accent} ${theme.colors.accent}` }}
        />
      </div>
    );
  }

  const sd = getStatusDisplay(metrics.status);
  const color = statusColor(metrics.status);

  function fmt12(hhmm: string) {
    const [h, m] = hhmm.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hr = h % 12 || 12;
    return `${hr}:${String(m).padStart(2, '0')} ${ampm}`;
  }

  return (
    <motion.div
      className="mx-auto max-w-3xl space-y-5"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
    >
      <ConfettiCanvas active={showConfetti} />
      {showMiniFallback && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/55 p-3 sm:items-center">
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            aria-label="Close mini pace"
            onClick={() => setShowMiniFallback(false)}
          />
          <div
            className="relative w-full max-w-3xl rounded-2xl border border-white/12 bg-slate-950 p-3 shadow-2xl"
            style={{ boxShadow: '0 24px 80px rgba(0,0,0,0.55)' }}
          >
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Mini Pace
              </span>
              <button
                type="button"
                onClick={() => setShowMiniFallback(false)}
                className="rounded-lg border border-white/10 px-2 py-1 text-xs text-slate-300 hover:border-white/25 hover:text-white"
              >
                Close
              </button>
            </div>
            <MiniPaceWindow embedded />
          </div>
        </div>
      )}

      {/* ── Header ───────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1
          className="text-2xl font-bold tracking-tight"
          style={{ color: 'var(--theme-text-primary)' }}
        >
          Home
        </h1>
        <div className="flex items-center gap-2">
          <button
            onClick={openMiniWindow}
            title="Open compact productivity HUD on second monitor"
            className="p-2 rounded-xl text-sm transition-all"
            style={{
              background: 'var(--theme-bg-card)',
              border: '1px solid var(--theme-border)',
              color: 'var(--theme-text-muted)',
            }}
          >
            📌
          </button>
          {pendingReviewCount > 0 ? (
            <button
              onClick={() => onNavigate('import')}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all"
              style={{ background: `linear-gradient(135deg, ${theme.colors.primary}, ${theme.colors.primaryLight})` }}
            >
              Review {pendingReviewCount} {pendingReviewCount === 1 ? 'study' : 'studies'}
            </button>
          ) : todayLogs.length === 0 ? (
            <button
              onClick={() => onNavigate('import')}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all"
              style={{ background: `linear-gradient(135deg, ${theme.colors.primary}, ${theme.colors.primaryLight})` }}
            >
              Add today's first capture
            </button>
          ) : null}
        </div>
      </div>

      {/* ── Gauge + Status ───────────────────────────────────────────── */}
      <div
        className="flex flex-col items-center gap-4 py-7 px-6 rounded-2xl transition-all"
        style={{
          background: `linear-gradient(160deg, rgba(22,32,50,0.95) 0%, rgba(15,22,34,0.98) 100%)`,
          border: `1px solid ${color}22`,
          boxShadow: `0 4px 30px rgba(0,0,0,0.4), 0 0 60px ${color}0a, inset 0 1px 0 rgba(255,255,255,0.04)`,
        }}
      >
        <CircularGauge
          current={metrics.currentRvu}
          goal={metrics.dailyGoal}
          status={metrics.status}
        />
        <div className="text-center space-y-1">
          <p style={{ fontSize: '1.375rem', fontWeight: 800, color, letterSpacing: '-0.01em' }}>
            {sd.emoji} {sd.label}
          </p>
          {metrics.status !== 'before_work' && metrics.status !== 'goal_achieved' && (
            <p style={{ fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>
              {formatMinutes(metrics.elapsedWorkMinutes)} elapsed
              <span style={{ color: 'var(--theme-text-disabled)', margin: '0 6px' }}>·</span>
              {formatMinutes(metrics.remainingWorkMinutes)} remaining
            </p>
          )}
          {metrics.status === 'goal_achieved' && (
            <p style={{ fontSize: '0.875rem', fontWeight: 600, color: theme.colors.goalGold + 'dd' }}>
              Daily goal complete
            </p>
          )}
          {metrics.status === 'before_work' && (
            <p style={{ fontSize: '0.8125rem', color: 'var(--theme-text-muted)' }}>
              Shift starts at {fmt12(paceSettings.workdayStart)}
            </p>
          )}
        </div>

        {/* Progress bars inline in the gauge card */}
        {metrics.status !== 'before_work' && (
          <div className="w-full pt-3 mt-1" style={{ borderTop: '1px solid rgba(91,184,212,0.08)' }}>
            <DualProgressBars
              expectedPct={metrics.expectedPercent}
              actualPct={metrics.actualPercent}
              progressStatus={sd.progressStatus}
            />
          </div>
        )}
      </div>

      {/* One line: projection + pending review, replacing the six-tile stat grid. */}
      {metrics.status !== 'before_work' && (
        <p className="text-sm px-1" style={{ color: 'var(--theme-text-muted)' }}>
          Projected {(metrics.status === 'after_work' || metrics.status === 'goal_achieved' ? metrics.currentRvu : metrics.projectedEndOfDay).toFixed(1)} by {fmt12(paceSettings.workdayEnd)}
          {pendingReviewCount > 0 && ` · ${pendingReviewCount} pending review`}
        </p>
      )}

      {/* ── Trends: 14-day sparkline + annual progress, one compact row ── */}
      <div
        className="flex items-center justify-between gap-6 rounded-2xl px-5 py-3.5 flex-wrap"
        style={{ background: 'var(--theme-bg-card)', border: '1px solid var(--theme-border)' }}
      >
        <div className="flex items-center gap-3">
          <Sparkline data={sparklineSeries} />
          <div>
            <p className="text-[11px]" style={{ color: 'var(--theme-text-disabled)' }}>Last 14 days</p>
            <p className="text-sm font-semibold" style={{ color: 'var(--theme-text-primary)' }}>{last14Total.toFixed(1)} wRVU</p>
          </div>
        </div>
        {ytd && (
          <div className="text-right">
            <p className="text-[11px]" style={{ color: 'var(--theme-text-disabled)' }}>Annual progress</p>
            <p className="text-sm font-semibold" style={{ color: 'var(--theme-text-primary)' }}>
              {ytdPct.toFixed(0)}% · {ytd.ytdWorkRvu.toFixed(0)} of {ytd.annualGoal.toFixed(0)}
            </p>
          </div>
        )}
      </div>

      {/* Study count */}
      <div className="flex items-center justify-between text-xs px-1" style={{ color: 'var(--theme-text-disabled)' }}>
        <span>
          {todayLogs.length} {todayLogs.length === 1 ? 'study' : 'studies'} logged today
        </span>
        <button
          onClick={() => onNavigate('history')}
          className="transition-colors"
          onMouseEnter={(e) => (e.currentTarget as HTMLButtonElement).style.color = 'var(--theme-text-secondary)'}
          onMouseLeave={(e) => (e.currentTarget as HTMLButtonElement).style.color = 'var(--theme-text-disabled)'}
        >
          View history →
        </button>
      </div>
    </motion.div>
  );
}
