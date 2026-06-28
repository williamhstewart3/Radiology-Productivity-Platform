/**
 * MiniPaceWindow.tsx
 *
 * Compact always-on-top companion display for the Daily Pace dashboard.
 * Designed to live on a second monitor while reading studies.
 *
 * DATA SOURCE: studyLogs table only (same as DailyPaceDashboard).
 * FUTURE NOTE: PowerScribe, OCR, or any other ingestion pipeline
 * should write to studyLogs — this window reflects changes automatically.
 *
 * Reuses: dailyPaceCalculations.ts, db/database.ts, UserSettings.
 * No navigation, no annual stats, no study list.
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

// ─── Sparkline chart ─────────────────────────────────────────────────────────

interface SparklineProps {
  metrics: DailyPaceMetrics;
  accentColor: string;
  workdayStart: string;
  workdayEnd: string;
}

function Sparkline({ metrics, accentColor, workdayStart, workdayEnd }: SparklineProps) {
  const W = 220;
  const H = 120;
  const PAD = { top: 12, right: 8, bottom: 24, left: 28 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  function hhmm(s: string) {
    const [h, m] = s.split(':').map(Number);
    return h * 60 + (m || 0);
  }

  const startMin = hhmm(workdayStart);
  const endMin = hhmm(workdayEnd);
  const shiftMin = Math.max(1, endMin - startMin);
  const goal = metrics.dailyGoal;

  // X: fraction of shift elapsed; Y: wRVU value (0–goal)
  function toX(elapsed: number) {
    return PAD.left + (elapsed / shiftMin) * chartW;
  }
  function toY(rvu: number) {
    return PAD.top + chartH - (Math.min(rvu, goal * 1.1) / (goal * 1.1)) * chartH;
  }

  // Actual line: goes from (0,0) → (elapsedMin, currentRvu)
  const ex = toX(metrics.elapsedWorkMinutes);
  const ey = toY(metrics.currentRvu);
  const actualPath = `M ${toX(0)} ${toY(0)} L ${ex} ${ey}`;
  const actualFill = `M ${toX(0)} ${toY(0)} L ${ex} ${ey} L ${ex} ${toY(0)} L ${toX(0)} ${toY(0)} Z`;

  // Expected line: (0,0) → (shiftMin, goal) — full dashed line
  const expectedPath = `M ${toX(0)} ${toY(0)} L ${toX(shiftMin)} ${toY(goal)}`;

  // Y-axis labels
  const yTicks = [0, Math.round(goal / 2), goal];
  // X-axis labels
  function minutesToLabel(min: number) {
    const total = startMin + min;
    const h = Math.floor(total / 60) % 24;
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hr = h % 12 || 12;
    return `${hr} ${ampm}`;
  }
  const xTicks = [0, shiftMin / 2, shiftMin];

  return (
    <svg width={W} height={H} className="flex-shrink-0">
      {/* Y grid lines */}
      {yTicks.map((v) => (
        <line
          key={v}
          x1={PAD.left}
          x2={PAD.left + chartW}
          y1={toY(v)}
          y2={toY(v)}
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={1}
        />
      ))}
      {/* Y axis labels */}
      {yTicks.map((v) => (
        <text
          key={v}
          x={PAD.left - 4}
          y={toY(v) + 4}
          textAnchor="end"
          fontSize={9}
          fill="rgba(148,163,184,0.7)"
        >
          {v}
        </text>
      ))}
      {/* X axis labels */}
      {xTicks.map((v, i) => (
        <text
          key={v}
          x={toX(v)}
          y={H - 4}
          textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}
          fontSize={9}
          fill="rgba(148,163,184,0.6)"
        >
          {minutesToLabel(v)}
        </text>
      ))}

      {/* Expected dashed line */}
      <path
        d={expectedPath}
        stroke="rgba(148,163,184,0.45)"
        strokeWidth={1.5}
        strokeDasharray="4 3"
        fill="none"
      />

      {/* Actual area fill */}
      <path d={actualFill} fill={accentColor} opacity={0.15} />

      {/* Actual line */}
      <path d={actualPath} stroke={accentColor} strokeWidth={2} fill="none" strokeLinecap="round" />

      {/* Current dot */}
      {metrics.elapsedWorkMinutes > 0 && (
        <circle cx={ex} cy={ey} r={4} fill={accentColor} />
      )}

      {/* Legend */}
      <g transform={`translate(${PAD.left + chartW - 90}, ${PAD.top})`}>
        <line x1={0} x2={14} y1={5} y2={5} stroke={accentColor} strokeWidth={2} />
        <text x={17} y={9} fontSize={9} fill={accentColor}>Actual</text>
        <line x1={40} x2={54} y1={5} y2={5} stroke="rgba(148,163,184,0.5)" strokeWidth={1.5} strokeDasharray="3 2" />
        <text x={57} y={9} fontSize={9} fill="rgba(148,163,184,0.6)">Expected</text>
      </g>
    </svg>
  );
}

// ─── Progress bar with ghost expected marker ─────────────────────────────────

interface PaceBarProps {
  actualPct: number;
  expectedPct: number;
  accentColor: string; // CSS color string
}

function PaceBar({ actualPct, expectedPct, accentColor }: PaceBarProps) {
  const clampedActual = Math.min(100, Math.max(0, actualPct));
  const clampedExpected = Math.min(100, Math.max(0, expectedPct));

  return (
    <div className="relative w-full h-7 bg-white/[0.06] rounded-lg overflow-hidden">
      {/* Expected ghost shading — fills up to expectedPct */}
      <div
        className="absolute inset-y-0 left-0 bg-white/[0.08] rounded-l-lg transition-all duration-700"
        style={{ width: `${clampedExpected}%` }}
      />
      {/* Expected vertical marker line */}
      <div
        className="absolute inset-y-0 w-0.5 bg-white/30 transition-all duration-700"
        style={{ left: `${clampedExpected}%`, transform: 'translateX(-50%)' }}
      />
      {/* Actual fill bar */}
      <div
        className="absolute inset-y-0 left-0 rounded-lg transition-all duration-700 ease-out"
        style={{
          width: `${clampedActual}%`,
          background: `linear-gradient(to right, ${accentColor}cc, ${accentColor})`,
          boxShadow: `0 0 12px ${accentColor}66`,
        }}
      />
    </div>
  );
}

// ─── Stat chip ────────────────────────────────────────────────────────────────

interface StatChipProps {
  label: string;
  value: string;
  icon: string;
  valueColor?: string;
}

function StatChip({ label, value, icon, valueColor = 'text-white' }: StatChipProps) {
  return (
    <div className="flex flex-col items-center gap-1 flex-1 min-w-0 border border-white/[0.07] rounded-xl px-3 py-3 bg-white/[0.03]">
      <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest whitespace-nowrap">{label}</span>
      <span className={`text-xl font-bold tabular-nums leading-none ${valueColor}`}>{value}</span>
      <span className="text-lg leading-none mt-0.5">{icon}</span>
    </div>
  );
}

// ─── Status colors (CSS values, not Tailwind, for inline use) ────────────────

function getAccentCss(status: DailyPaceMetrics['status']): string {
  switch (status) {
    case 'goal_achieved': return '#fbbf24';
    case 'ahead':         return '#34d399';
    case 'on_track':      return '#60a5fa';
    case 'slightly_behind': return '#fb923c';
    case 'behind':        return '#f87171';
    case 'after_work':    return '#a78bfa';
    default:              return '#64748b';
  }
}

function getGlowCss(status: DailyPaceMetrics['status']): string {
  const c = getAccentCss(status);
  return `0 0 60px ${c}22, 0 0 120px ${c}11`;
}

// ─── Main component ───────────────────────────────────────────────────────────

export function MiniPaceWindow() {
  const today = todayDateString();

  const todayLogs = useLiveQuery(
    () => db.studyLogs.where('logDate').equals(today).toArray(),
    [today],
    [],
  );

  const settings = useLiveQuery(() => db.userSettings.get('default'), []);

  const paceSettings: DailyPaceSettings = {
    dailyRvuGoal: settings?.dailyRvuGoal ?? DEFAULT_DAILY_PACE_SETTINGS.dailyRvuGoal,
    workdayStart: settings?.workdayStart ?? DEFAULT_DAILY_PACE_SETTINGS.workdayStart,
    workdayEnd: settings?.workdayEnd ?? DEFAULT_DAILY_PACE_SETTINGS.workdayEnd,
    breakMinutes: settings?.breakMinutes ?? DEFAULT_DAILY_PACE_SETTINGS.breakMinutes,
  };

  const prevAchievedRef = useRef(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [metrics, setMetrics] = useState<DailyPaceMetrics | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  const recalculate = useCallback(() => {
    if (!todayLogs) return;
    const m = computeDailyPace(todayLogs, paceSettings, prevAchievedRef.current);
    setMetrics(m);
    setLastUpdated(new Date());
    if (m.goalJustAchieved) {
      prevAchievedRef.current = true;
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 4500);
    }
    if (m.currentRvu < m.dailyGoal) {
      prevAchievedRef.current = false;
    }
  }, [todayLogs, paceSettings.dailyRvuGoal, paceSettings.workdayStart, paceSettings.workdayEnd, paceSettings.breakMinutes]);

  useEffect(() => {
    recalculate();
    const interval = setInterval(recalculate, 60_000);
    return () => clearInterval(interval);
  }, [recalculate]);

  // Set window title
  useEffect(() => {
    document.title = metrics
      ? `${metrics.currentRvu.toFixed(1)} / ${metrics.dailyGoal} wRVU — Daily Pace`
      : 'wRVU Daily Pace';
  }, [metrics]);

  if (!metrics || todayLogs === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#080c18]">
        <div className="w-7 h-7 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const sd = getStatusDisplay(metrics.status);
  const accent = getAccentCss(metrics.status);
  const glow = getGlowCss(metrics.status);

  const paceDiffAbs = Math.abs(metrics.paceDifference);
  const paceDiffLabel = metrics.status === 'before_work'
    ? '—'
    : metrics.paceDifference >= 0
      ? `+${paceDiffAbs.toFixed(1)}`
      : `−${paceDiffAbs.toFixed(1)}`;
  const paceDiffColor = metrics.paceDifference >= 0.5
    ? '#34d399' : metrics.paceDifference <= -0.5 ? '#f87171' : '#60a5fa';

  const projectedLabel = metrics.status === 'before_work' ? '—'
    : metrics.status === 'goal_achieved' || metrics.status === 'after_work'
    ? metrics.currentRvu.toFixed(1)
    : metrics.projectedEndOfDay.toFixed(1);

  const requiredLabel = metrics.remainingWorkMinutes <= 0 || metrics.remainingToGoal <= 0
    ? '—'
    : `${metrics.requiredRvuPerHour.toFixed(1)}`;

  const requiredColor = metrics.requiredRvuPerHour > 25 ? '#f87171'
    : metrics.requiredRvuPerHour > 15 ? '#fb923c' : 'white';

  function fmt12(hhmm: string) {
    const [h, m] = hhmm.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hr = h % 12 || 12;
    return `${hr}:${String(m).padStart(2, '0')} ${ampm}`;
  }

  function fmtTime(d: Date) {
    let h = d.getHours(), m = d.getMinutes();
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${String(m).padStart(2, '0')} ${ampm}`;
  }

  const todayLabel = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: '#080c18' }}
    >
      <ConfettiCanvas active={showConfetti} />

      {/* Window card */}
      <div
        className="w-full max-w-[860px] rounded-2xl border border-white/10 overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, #0d1225 0%, #0a0e1a 100%)',
          boxShadow: glow,
          transition: 'box-shadow 0.8s ease',
        }}
      >
        {/* ── Title bar ─────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.07] bg-white/[0.02]">
          <div className="flex items-center gap-2.5">
            <span className="text-indigo-400 text-base">📊</span>
            <span className="text-sm font-semibold text-white tracking-tight">wRVU Daily Pace</span>
          </div>
          <div className="flex items-center gap-3">
            {/* Pin indicator */}
            <span className="text-xs text-slate-500 flex items-center gap-1">
              <span className="text-slate-400">📌</span>
              <span className="hidden sm:inline">Companion Display</span>
            </span>
          </div>
        </div>

        {/* ── Main content ───────────────────────────────────────────────── */}
        <div className="p-5 space-y-5">

          {/* Row 1: date + status */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-slate-400 text-sm font-medium">{todayLabel}</span>
            <span
              className="flex items-center gap-1.5 text-sm font-semibold px-2.5 py-0.5 rounded-full border"
              style={{
                color: accent,
                borderColor: `${accent}44`,
                background: `${accent}18`,
              }}
            >
              <span
                className="w-2 h-2 rounded-full animate-pulse"
                style={{ background: accent }}
              />
              {sd.label}
            </span>
          </div>

          {/* Row 2: wRVU number + chart */}
          <div className="flex items-start gap-6">
            {/* Left: number + percent + bar */}
            <div className="flex-1 min-w-0 space-y-3">
              {/* Big number */}
              <div className="flex items-baseline gap-3 flex-wrap">
                <span
                  className="font-black tabular-nums leading-none"
                  style={{ fontSize: '3.5rem', color: accent, textShadow: `0 0 30px ${accent}66` }}
                >
                  {metrics.currentRvu.toFixed(1)}
                </span>
                <span className="text-slate-400 text-xl font-medium">
                  / {metrics.dailyGoal} wRVU
                </span>
                <span
                  className="text-2xl font-bold tabular-nums ml-auto"
                  style={{ color: accent }}
                >
                  {metrics.percentComplete.toFixed(0)}%
                </span>
              </div>

              {/* Progress bar with ghost expected marker */}
              <PaceBar
                actualPct={metrics.actualPercent}
                expectedPct={metrics.expectedPercent}
                accentColor={accent}
              />

              {/* Bar labels */}
              <div className="flex justify-between text-xs text-slate-500">
                <span style={{ color: accent }}>Actual</span>
                <span>
                  Expected {metrics.status === 'before_work' ? '—' : metrics.expectedRvu.toFixed(1)}
                </span>
              </div>
            </div>

            {/* Right: sparkline */}
            <div className="flex-shrink-0 hidden sm:block">
              <Sparkline
                metrics={metrics}
                accentColor={accent}
                workdayStart={paceSettings.workdayStart}
                workdayEnd={paceSettings.workdayEnd}
              />
            </div>
          </div>

          {/* Row 3: stat chips */}
          <div className="flex gap-2 flex-wrap">
            <StatChip
              label="Current"
              value={metrics.currentRvu.toFixed(1)}
              icon="📅"
              valueColor="text-white"
            />
            <StatChip
              label="Expected"
              value={metrics.status === 'before_work' ? '—' : metrics.expectedRvu.toFixed(1)}
              icon="🕐"
              valueColor="text-slate-300"
            />
            <StatChip
              label="Ahead / Behind"
              value={paceDiffLabel}
              icon="📈"
              valueColor={metrics.paceDifference >= 0.5 ? 'text-emerald-400' : metrics.paceDifference <= -0.5 ? 'text-red-400' : 'text-blue-400'}
            />
            <StatChip
              label="Projected Finish"
              value={projectedLabel}
              icon="🎯"
              valueColor={
                metrics.status === 'goal_achieved' ? 'text-emerald-400' :
                parseFloat(projectedLabel) >= metrics.dailyGoal ? 'text-emerald-400' : 'text-orange-400'
              }
            />
            <StatChip
              label="Remaining"
              value={metrics.remainingToGoal > 0 ? metrics.remainingToGoal.toFixed(1) : '0.0'}
              icon="⏳"
              valueColor={metrics.remainingToGoal === 0 ? 'text-emerald-400' : 'text-white'}
            />
            <StatChip
              label="Required / HR"
              value={requiredLabel}
              icon="🕐"
              valueColor={
                requiredLabel === '—' ? 'text-slate-400' :
                metrics.requiredRvuPerHour > 25 ? 'text-red-400' :
                metrics.requiredRvuPerHour > 15 ? 'text-orange-400' : 'text-white'
              }
            />
          </div>

          {/* Footer: last updated */}
          <div className="flex items-center justify-center gap-1.5 text-xs text-slate-600 pt-1 border-t border-white/[0.05]">
            <span className="text-slate-500">🔄</span>
            <span>Updated {fmtTime(lastUpdated)}</span>
            {metrics.status !== 'before_work' && metrics.status !== 'after_work' && (
              <span className="ml-2 text-slate-600">
                · {formatMinutes(metrics.remainingWorkMinutes)} remaining
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
