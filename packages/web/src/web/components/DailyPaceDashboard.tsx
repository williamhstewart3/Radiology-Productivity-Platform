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
      className="rounded-xl flex flex-col gap-1 transition-all duration-200"
      style={{
        background: highlight
          ? `linear-gradient(145deg, rgba(37,99,168,0.18), rgba(91,184,212,0.06))`
          : `linear-gradient(145deg, rgba(22,32,50,0.9), rgba(15,24,36,0.7))`,
        border: highlight
          ? '1px solid rgba(91,184,212,0.22)'
          : '1px solid rgba(91,184,212,0.09)',
        padding: '14px 16px',
        boxShadow: highlight ? '0 4px 16px rgba(37,99,168,0.12)' : '0 2px 8px rgba(0,0,0,0.2)',
      }}
    >
      <span
        style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--theme-text-disabled)' }}
      >
        {label}
      </span>
      <span
        style={{ fontSize: '1.375rem', fontWeight: 800, lineHeight: 1.1, letterSpacing: '-0.02em', color: valueColor ?? 'var(--theme-text-primary)', fontVariantNumeric: 'tabular-nums' }}
      >
        {value}
      </span>
      {sub && (
        <span style={{ fontSize: '10px', color: 'var(--theme-text-disabled)', lineHeight: 1.3 }}>
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
          glowColor={color}
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
              Daily goal complete 🎉
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
