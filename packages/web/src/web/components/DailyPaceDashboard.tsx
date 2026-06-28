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
import { todayDateString } from '../utils/calculations';
import { ConfettiCanvas } from './ConfettiCanvas';
import { theme } from '../lib/theme';

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
  glowColor: string;
  status: DailyPaceMetrics['status'];
}

function CircularGauge({ current, goal, glowColor, status }: GaugeProps) {
  const pct = Math.min(1, current / Math.max(1, goal));
  const radius = 88;
  const stroke = 9;
  const cx = 110;
  const cy = 110;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - pct);
  const color = statusColor(status);

  return (
    <div className="relative flex items-center justify-center">
      <svg
        width={220}
        height={220}
        className="drop-shadow-xl"
        style={{ filter: `drop-shadow(0 0 20px ${color}44)` }}
      >
        {/* Track */}
        <circle
          cx={cx} cy={cy} r={radius}
          fill="none"
          stroke="rgba(91,184,212,0.07)"
          strokeWidth={stroke}
        />
        {/* Subtle inner track glow */}
        <circle
          cx={cx} cy={cy} r={radius - stroke - 2}
          fill="none"
          stroke="rgba(91,184,212,0.03)"
          strokeWidth={1}
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
            transition: 'stroke-dashoffset 0.8s cubic-bezier(0.4,0,0.2,1), stroke 0.5s ease',
          }}
        />
      </svg>

      {/* Center text */}
      <div className="absolute flex flex-col items-center justify-center select-none">
        <span
          className="font-black tabular-nums leading-none"
          style={{ fontSize: '2.5rem', color, textShadow: `0 0 32px ${color}66` }}
        >
          {current.toFixed(1)}
        </span>
        <span className="text-sm font-medium mt-1" style={{ color: 'var(--theme-text-muted)' }}>
          / {goal} wRVU
        </span>
        <span className="text-xs mt-0.5" style={{ color: 'var(--theme-text-disabled)' }}>
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

  return (
    <div className="space-y-4">
      {/* Expected */}
      <div className="space-y-2">
        <div className="flex justify-between text-xs" style={{ color: 'var(--theme-text-muted)' }}>
          <span className="font-medium">Expected by Now</span>
          <span className="font-semibold" style={{ color: 'var(--theme-text-primary)' }}>
            {expectedPct.toFixed(0)}%
          </span>
        </div>
        <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(91,184,212,0.08)' }}>
          <div
            className="h-2 rounded-full"
            style={{
              width: `${Math.min(100, expectedPct)}%`,
              background: 'rgba(91,184,212,0.3)',
              transition: 'width 0.7s cubic-bezier(0.4,0,0.2,1)',
            }}
          />
        </div>
      </div>

      {/* Actual */}
      <div className="space-y-2">
        <div className="flex justify-between text-xs" style={{ color: 'var(--theme-text-muted)' }}>
          <span className="font-medium">Actual Progress</span>
          <span className="font-semibold" style={{ color: 'var(--theme-text-primary)' }}>
            {actualPct.toFixed(0)}%
          </span>
        </div>
        <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(91,184,212,0.08)' }}>
          <div
            className="h-2 rounded-full"
            style={{
              width: `${Math.min(100, actualPct)}%`,
              background: barColor,
              boxShadow: `0 0 8px ${barColor}66`,
              transition: 'width 0.7s cubic-bezier(0.4,0,0.2,1)',
            }}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Stat Card ───────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: string;
  sub?: string;
  valueColor?: string;
  highlight?: boolean;
}

function StatCard({ label, value, sub, valueColor, highlight }: StatCardProps) {
  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-1 transition-all duration-200"
      style={{
        background: highlight
          ? `linear-gradient(135deg, rgba(37,99,168,0.15), rgba(91,184,212,0.08))`
          : 'var(--theme-bg-card)',
        border: highlight
          ? '1px solid rgba(91,184,212,0.2)'
          : '1px solid var(--theme-border)',
      }}
    >
      <span
        className="text-[11px] font-semibold uppercase tracking-wider"
        style={{ color: 'var(--theme-text-disabled)' }}
      >
        {label}
      </span>
      <span
        className="text-xl font-bold tabular-nums leading-tight"
        style={{ color: valueColor ?? 'var(--theme-text-primary)' }}
      >
        {value}
      </span>
      {sub && (
        <span className="text-[11px]" style={{ color: 'var(--theme-text-disabled)' }}>
          {sub}
        </span>
      )}
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

  const paceSettings: DailyPaceSettings = {
    dailyRvuGoal: activeProfile?.dailyRvuGoal ?? DEFAULT_DAILY_PACE_SETTINGS.dailyRvuGoal,
    workdayStart: activeProfile?.workdayStart ?? DEFAULT_DAILY_PACE_SETTINGS.workdayStart,
    workdayEnd:   activeProfile?.workdayEnd   ?? DEFAULT_DAILY_PACE_SETTINGS.workdayEnd,
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

  const paceDiffAbs = Math.abs(metrics.paceDifference);
  const paceDiffLabel =
    metrics.paceDifference >= 0 ? `+${paceDiffAbs.toFixed(1)}` : `−${paceDiffAbs.toFixed(1)}`;
  const paceDiffColor =
    metrics.paceDifference >= 0.5 ? theme.colors.ahead :
    metrics.paceDifference <= -0.5 ? theme.colors.behind :
    theme.colors.onTrack;

  function fmt12(hhmm: string) {
    const [h, m] = hhmm.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hr = h % 12 || 12;
    return `${hr}:${String(m).padStart(2, '0')} ${ampm}`;
  }

  return (
    <div className="max-w-2xl mx-auto space-y-5 animate-float-up">
      <ConfettiCanvas active={showConfetti} />

      {/* ── Header ───────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1
            className="text-2xl font-bold tracking-tight"
            style={{ color: 'var(--theme-text-primary)' }}
          >
            Daily Pace
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--theme-text-muted)' }}>
            {fmt12(paceSettings.workdayStart)} – {fmt12(paceSettings.workdayEnd)}
            {paceSettings.breakMinutes > 0 && ` · ${paceSettings.breakMinutes}m break`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              const url = `${window.location.origin}/mini-pace`;
              window.open(url, 'wrvu-mini-pace', 'width=700,height=300,resizable=yes,scrollbars=no,toolbar=no,menubar=no,location=no,status=no');
            }}
            title="Open compact companion display on second monitor"
            className="px-3 py-2 rounded-xl text-sm font-medium transition-all flex items-center gap-1.5"
            style={{
              background: 'var(--theme-bg-card)',
              border: '1px solid var(--theme-border)',
              color: 'var(--theme-text-muted)',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = 'var(--theme-text-primary)';
              (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--theme-border-active)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = 'var(--theme-text-muted)';
              (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--theme-border)';
            }}
          >
            <span>📌</span>
            <span className="hidden sm:inline">Mini Window</span>
          </button>
          <button
            onClick={() => onNavigate('log')}
            className="px-4 py-2 rounded-xl text-sm font-semibold transition-all"
            style={{
              background: `linear-gradient(135deg, ${theme.colors.primary}, ${theme.colors.primaryLight})`,
              color: '#fff',
              boxShadow: `0 2px 12px rgba(37,99,168,0.35)`,
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.boxShadow = `0 4px 20px rgba(37,99,168,0.5)`;
              (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.boxShadow = `0 2px 12px rgba(37,99,168,0.35)`;
              (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)';
            }}
          >
            + Log Study
          </button>
        </div>
      </div>

      {/* ── Gauge + Status ───────────────────────────────────────────── */}
      <div className="card flex flex-col items-center gap-5 py-8">
        <CircularGauge
          current={metrics.currentRvu}
          goal={metrics.dailyGoal}
          glowColor={color}
          status={metrics.status}
        />
        <div className="text-center">
          <p className="text-2xl font-bold" style={{ color }}>
            {sd.emoji} {sd.label}
          </p>
          {metrics.status !== 'before_work' && metrics.status !== 'goal_achieved' && (
            <p className="text-sm mt-1" style={{ color: 'var(--theme-text-muted)' }}>
              {formatMinutes(metrics.elapsedWorkMinutes)} elapsed ·{' '}
              {formatMinutes(metrics.remainingWorkMinutes)} remaining
            </p>
          )}
          {metrics.status === 'goal_achieved' && (
            <p className="text-sm mt-1 font-medium" style={{ color: theme.colors.goalGold + 'cc' }}>
              Daily goal complete 🎉
            </p>
          )}
          {metrics.status === 'before_work' && (
            <p className="text-sm mt-1" style={{ color: 'var(--theme-text-muted)' }}>
              Shift starts at {fmt12(paceSettings.workdayStart)}
            </p>
          )}
        </div>
      </div>

      {/* ── Progress Bars ────────────────────────────────────────────── */}
      {metrics.status !== 'before_work' && (
        <div className="card space-y-3">
          <p
            className="text-xs font-semibold uppercase tracking-wider"
            style={{ color: 'var(--theme-text-muted)' }}
          >
            Progress vs Pace
          </p>
          <DualProgressBars
            expectedPct={metrics.expectedPercent}
            actualPct={metrics.actualPercent}
            progressStatus={sd.progressStatus}
          />
        </div>
      )}

      {/* ── Stat Cards ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <StatCard
          label="Current"
          value={`${metrics.currentRvu.toFixed(1)}`}
          sub={`of ${metrics.dailyGoal} goal`}
          highlight
        />
        <StatCard
          label="Expected by Now"
          value={`${metrics.expectedRvu.toFixed(1)}`}
          sub="wRVU at current time"
          valueColor="var(--theme-text-secondary)"
        />
        <StatCard
          label="Ahead / Behind"
          value={metrics.status === 'before_work' ? '—' : `${paceDiffLabel} wRVU`}
          sub={metrics.status === 'before_work' ? 'not started' : 'vs linear pace'}
          valueColor={paceDiffColor}
        />
        <StatCard
          label="Projected Finish"
          value={
            metrics.status === 'before_work' ? '—' :
            metrics.status === 'after_work' || metrics.status === 'goal_achieved'
              ? `${metrics.currentRvu.toFixed(1)}`
              : `${metrics.projectedEndOfDay.toFixed(1)}`
          }
          sub="wRVU by end of shift"
          valueColor={
            metrics.projectedEndOfDay >= metrics.dailyGoal || metrics.status === 'goal_achieved'
              ? theme.colors.ahead
              : theme.colors.caution
          }
        />
        <StatCard
          label="Remaining"
          value={metrics.remainingToGoal > 0 ? `${metrics.remainingToGoal.toFixed(1)}` : '0.0'}
          sub="wRVU to goal"
          valueColor={
            metrics.remainingToGoal === 0 ? theme.colors.ahead : undefined
          }
        />
        <StatCard
          label="Required Rate"
          value={
            metrics.remainingWorkMinutes <= 0 || metrics.remainingToGoal <= 0 ? '—' :
            `${metrics.requiredRvuPerHour.toFixed(1)}/hr`
          }
          sub="to finish at goal"
          valueColor={
            metrics.requiredRvuPerHour > 25 ? theme.colors.behind :
            metrics.requiredRvuPerHour > 15 ? theme.colors.caution :
            'var(--theme-text-secondary)'
          }
        />
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
    </div>
  );
}
