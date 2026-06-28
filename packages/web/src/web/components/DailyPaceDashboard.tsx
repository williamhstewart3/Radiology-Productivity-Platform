/**
 * DailyPaceDashboard.tsx
 *
 * Primary workday screen — shows real-time wRVU pace against daily goal.
 *
 * DATA SOURCE: studyLogs table only.
 * All study ingestion paths (manual, CSV, OCR, PowerScribe API) write to
 * studyLogs. This component never needs to change when new sources are added.
 *
 * FUTURE NOTE: When PowerScribe ingestion is built, it should populate
 * studyLogs and this dashboard will reflect it automatically.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
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
  const stroke = 10;
  const cx = 110;
  const cy = 110;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - pct);

  // Color map for ring
  const ringColor: Record<string, string> = {
    before_work: '#64748b',
    goal_achieved: '#fbbf24',
    ahead: '#34d399',
    on_track: '#60a5fa',
    slightly_behind: '#fb923c',
    behind: '#f87171',
    after_work: '#a78bfa',
  };
  const color = ringColor[status] ?? '#6366f1';

  return (
    <div className="relative flex items-center justify-center">
      <svg
        width={220}
        height={220}
        className="drop-shadow-xl"
        style={{ filter: `drop-shadow(0 0 18px ${glowColor})` }}
      >
        {/* Track */}
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={stroke}
        />
        {/* Progress arc */}
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${cx} ${cy})`}
          style={{ transition: 'stroke-dashoffset 0.7s cubic-bezier(0.4,0,0.2,1), stroke 0.5s ease' }}
        />
      </svg>
      {/* Center text */}
      <div className="absolute flex flex-col items-center justify-center select-none">
        <span
          className="font-black tabular-nums leading-none"
          style={{ fontSize: '2.4rem', color }}
        >
          {current.toFixed(1)}
        </span>
        <span className="text-slate-400 text-sm font-medium mt-1">
          / {goal} wRVU
        </span>
        <span className="text-xs text-slate-500 mt-0.5">today</span>
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
  const actualColors: Record<string, string> = {
    ahead: 'from-emerald-500 to-teal-400',
    on_track: 'from-blue-500 to-indigo-400',
    behind: 'from-red-500 to-orange-400',
    neutral: 'from-slate-600 to-slate-500',
  };

  const actualGradient = actualColors[progressStatus] ?? 'from-indigo-500 to-violet-400';

  return (
    <div className="space-y-3">
      {/* Expected */}
      <div className="space-y-1.5">
        <div className="flex justify-between text-xs text-slate-400">
          <span className="font-medium">Expected by Now</span>
          <span className="text-white font-semibold">{expectedPct.toFixed(0)}%</span>
        </div>
        <div className="h-2.5 bg-white/5 rounded-full overflow-hidden">
          <div
            className="h-2.5 bg-gradient-to-r from-slate-500 to-slate-400 rounded-full"
            style={{
              width: `${Math.min(100, expectedPct)}%`,
              transition: 'width 0.7s cubic-bezier(0.4,0,0.2,1)',
            }}
          />
        </div>
      </div>

      {/* Actual */}
      <div className="space-y-1.5">
        <div className="flex justify-between text-xs text-slate-400">
          <span className="font-medium">Actual Progress</span>
          <span className="text-white font-semibold">{actualPct.toFixed(0)}%</span>
        </div>
        <div className="h-2.5 bg-white/5 rounded-full overflow-hidden">
          <div
            className={`h-2.5 bg-gradient-to-r ${actualGradient} rounded-full`}
            style={{
              width: `${Math.min(100, actualPct)}%`,
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
  accent?: string; // tailwind text color
  glow?: boolean;
}

function StatCard({ label, value, sub, accent = 'text-white', glow }: StatCardProps) {
  return (
    <div
      className={`rounded-2xl bg-white/[0.04] border border-white/8 p-4 flex flex-col gap-1 ${
        glow ? 'shadow-[0_0_18px_rgba(99,102,241,0.15)]' : ''
      }`}
    >
      <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">{label}</span>
      <span className={`text-xl font-bold tabular-nums ${accent} leading-tight`}>{value}</span>
      {sub && <span className="text-[11px] text-slate-500">{sub}</span>}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

interface DailyPaceDashboardProps {
  onNavigate: (tab: string) => void;
}

export function DailyPaceDashboard({ onNavigate }: DailyPaceDashboardProps) {
  const today = todayDateString();

  // Live queries — auto-update whenever DB changes (new study logged, imported, etc.)
  const todayLogs = useLiveQuery(
    () => db.studyLogs.where('logDate').equals(today).toArray(),
    [today],
    [],
  );

  const settings = useLiveQuery(
    () => db.userSettings.get('default'),
    [],
  );

  // Build DailyPaceSettings from UserSettings (merge with defaults for missing fields)
  const paceSettings: DailyPaceSettings = {
    dailyRvuGoal: settings?.dailyRvuGoal ?? DEFAULT_DAILY_PACE_SETTINGS.dailyRvuGoal,
    workdayStart: settings?.workdayStart ?? DEFAULT_DAILY_PACE_SETTINGS.workdayStart,
    workdayEnd: settings?.workdayEnd ?? DEFAULT_DAILY_PACE_SETTINGS.workdayEnd,
    breakMinutes: settings?.breakMinutes ?? DEFAULT_DAILY_PACE_SETTINGS.breakMinutes,
  };

  // Track whether goal was already achieved to suppress repeat confetti
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
    // Reset achievement tracking if user falls back below goal (e.g. deleted a log)
    if (m.currentRvu < m.dailyGoal) {
      prevAchievedRef.current = false;
    }
  }, [todayLogs, paceSettings.dailyRvuGoal, paceSettings.workdayStart, paceSettings.workdayEnd, paceSettings.breakMinutes]);

  // Recalculate immediately when deps change, then every 60s
  useEffect(() => {
    recalculate();
    const interval = setInterval(recalculate, 60_000);
    return () => clearInterval(interval);
  }, [recalculate]);

  // ── Loading state ────────────────────────────────────────────────────────
  if (!metrics || todayLogs === undefined) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const sd = getStatusDisplay(metrics.status);

  const paceDiffAbs = Math.abs(metrics.paceDifference);
  const paceDiffLabel =
    metrics.paceDifference >= 0
      ? `+${paceDiffAbs.toFixed(1)}`
      : `−${paceDiffAbs.toFixed(1)}`;
  const paceDiffColor =
    metrics.paceDifference >= 0.5 ? 'text-emerald-400' :
    metrics.paceDifference <= -0.5 ? 'text-red-400' : 'text-blue-400';

  // 12-hr formatted shift time display
  function fmt12(hhmm: string) {
    const [h, m] = hhmm.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hr = h % 12 || 12;
    return `${hr}:${String(m).padStart(2, '0')} ${ampm}`;
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-in fade-in duration-300">
      <ConfettiCanvas active={showConfetti} />

      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Daily Pace</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            {fmt12(paceSettings.workdayStart)} – {fmt12(paceSettings.workdayEnd)}
            {paceSettings.breakMinutes > 0 && ` · ${paceSettings.breakMinutes}m break`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Mini Window popout */}
          <button
            onClick={() => {
              const url = `${window.location.origin}/mini-pace`;
              window.open(url, 'wrvu-mini-pace', 'width=900,height=420,resizable=yes,scrollbars=no,toolbar=no,menubar=no,location=no,status=no');
            }}
            title="Open compact companion display on second monitor"
            className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-slate-400 text-sm font-medium hover:bg-white/10 hover:text-white transition-all flex items-center gap-1.5"
          >
            <span>📌</span>
            <span className="hidden sm:inline">Mini Window</span>
          </button>
          <button
            onClick={() => onNavigate('log')}
            className="px-4 py-2 rounded-xl bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 text-sm font-medium hover:bg-indigo-500/30 transition-all"
          >
            + Log Study
          </button>
        </div>
      </div>

      {/* ── TOP: Gauge + Status ─────────────────────────────────────────── */}
      <div className="card flex flex-col items-center gap-4 py-8">
        <CircularGauge
          current={metrics.currentRvu}
          goal={metrics.dailyGoal}
          glowColor={sd.glowColor}
          status={metrics.status}
        />

        <div className="text-center">
          <p className={`text-2xl font-bold ${sd.color}`}>
            {sd.emoji} {sd.label}
          </p>
          {metrics.status !== 'before_work' && metrics.status !== 'goal_achieved' && (
            <p className="text-slate-500 text-sm mt-1">
              {formatMinutes(metrics.elapsedWorkMinutes)} elapsed ·{' '}
              {formatMinutes(metrics.remainingWorkMinutes)} remaining
            </p>
          )}
          {metrics.status === 'goal_achieved' && (
            <p className="text-amber-400/70 text-sm mt-1 font-medium">
              Daily goal complete 🎉
            </p>
          )}
          {metrics.status === 'before_work' && (
            <p className="text-slate-500 text-sm mt-1">
              Shift starts at {fmt12(paceSettings.workdayStart)}
            </p>
          )}
        </div>
      </div>

      {/* ── MIDDLE: Dual Progress Bars ──────────────────────────────────── */}
      {metrics.status !== 'before_work' && (
        <div className="card space-y-2">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Progress vs Pace</p>
          <DualProgressBars
            expectedPct={metrics.expectedPercent}
            actualPct={metrics.actualPercent}
            progressStatus={sd.progressStatus}
          />
        </div>
      )}

      {/* ── BOTTOM: Stat Cards ──────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <StatCard
          label="Current"
          value={`${metrics.currentRvu.toFixed(1)}`}
          sub={`of ${metrics.dailyGoal} goal`}
          accent="text-white"
          glow
        />
        <StatCard
          label="Expected by Now"
          value={`${metrics.expectedRvu.toFixed(1)}`}
          sub="wRVU at current time"
          accent="text-slate-300"
        />
        <StatCard
          label="Ahead / Behind"
          value={metrics.status === 'before_work' ? '—' : `${paceDiffLabel} wRVU`}
          sub={metrics.status === 'before_work' ? 'not started' : 'vs linear pace'}
          accent={paceDiffColor}
        />
        <StatCard
          label="Projected Finish"
          value={
            metrics.status === 'before_work'
              ? '—'
              : metrics.status === 'after_work' || metrics.status === 'goal_achieved'
              ? `${metrics.currentRvu.toFixed(1)}`
              : `${metrics.projectedEndOfDay.toFixed(1)}`
          }
          sub="wRVU by end of shift"
          accent={
            metrics.projectedEndOfDay >= metrics.dailyGoal || metrics.status === 'goal_achieved'
              ? 'text-emerald-400'
              : 'text-orange-400'
          }
        />
        <StatCard
          label="Remaining"
          value={metrics.remainingToGoal > 0 ? `${metrics.remainingToGoal.toFixed(1)}` : '0.0'}
          sub="wRVU to goal"
          accent={metrics.remainingToGoal === 0 ? 'text-emerald-400' : 'text-white'}
        />
        <StatCard
          label="Required Rate"
          value={
            metrics.remainingWorkMinutes <= 0 || metrics.remainingToGoal <= 0
              ? '—'
              : `${metrics.requiredRvuPerHour.toFixed(1)}/hr`
          }
          sub="to finish at goal"
          accent={
            metrics.requiredRvuPerHour > 25
              ? 'text-red-400'
              : metrics.requiredRvuPerHour > 15
              ? 'text-orange-400'
              : 'text-slate-300'
          }
        />
      </div>

      {/* Study count + shortcut */}
      <div className="flex items-center justify-between text-xs text-slate-500 px-1">
        <span>{todayLogs.length} {todayLogs.length === 1 ? 'study' : 'studies'} logged today</span>
        <button
          onClick={() => onNavigate('history')}
          className="hover:text-slate-300 transition-colors"
        >
          View history →
        </button>
      </div>
    </div>
  );
}
