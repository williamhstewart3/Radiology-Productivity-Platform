/**
 * MiniPaceWindow.tsx
 *
 * Ultra-glanceable cockpit instrument panel. Designed to live on a second
 * monitor, readable in under 1 second at a glance.
 *
 * DATA SOURCE: studyLogs table only.
 * FUTURE NOTE: PowerScribe, OCR, or any other ingestion pipeline writes to
 * studyLogs — this window reflects changes automatically with no code changes.
 *
 * Reuses: dailyPaceCalculations.ts entirely. Zero duplicated logic.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import {
  computeDailyPace,
  getStatusDisplay,
  formatTimePaceLabel,
  DEFAULT_DAILY_PACE_SETTINGS,
  type DailyPaceSettings,
  type DailyPaceMetrics,
} from '../utils/dailyPaceCalculations';
import { todayDateString } from '../utils/calculations';
import { ConfettiCanvas } from './ConfettiCanvas';

// ─── CSS accent colors keyed to PaceStatus ───────────────────────────────────

function accentCss(status: DailyPaceMetrics['status']): string {
  switch (status) {
    case 'goal_achieved':   return '#fbbf24'; // gold
    case 'ahead':           return '#34d399'; // emerald
    case 'on_track':        return '#60a5fa'; // blue
    case 'slightly_behind': return '#fb923c'; // amber
    case 'behind':          return '#f87171'; // red
    case 'after_work':      return '#a78bfa'; // violet
    default:                return '#64748b'; // slate
  }
}

function glowCss(status: DailyPaceMetrics['status']): string {
  const c = accentCss(status);
  return `0 0 40px ${c}28, 0 0 80px ${c}12, inset 0 0 0 1px ${c}22`;
}

// ─── Instrument progress bar ──────────────────────────────────────────────────
// Single bar: actual fill + ghost expected region + white expected marker line

interface InstrumentBarProps {
  actualPct: number;      // 0–100
  expectedPct: number;    // 0–100
  accent: string;         // CSS color
  flash: 'none' | 'green' | 'amber';
}

function InstrumentBar({ actualPct, expectedPct, accent, flash }: InstrumentBarProps) {
  const cActual   = Math.min(100, Math.max(0, actualPct));
  const cExpected = Math.min(100, Math.max(0, expectedPct));

  // Flash overlay color
  const flashColor =
    flash === 'green' ? 'rgba(52,211,153,0.22)' :
    flash === 'amber' ? 'rgba(251,146,60,0.18)' : 'transparent';

  return (
    <div className="relative w-full rounded-xl overflow-hidden" style={{ height: 44 }}>
      {/* Track */}
      <div className="absolute inset-0 rounded-xl" style={{ background: 'rgba(255,255,255,0.05)' }} />

      {/* Ghost expected fill — subtle region from 0 → expectedPct */}
      <div
        className="absolute inset-y-0 left-0 rounded-l-xl"
        style={{
          width: `${cExpected}%`,
          background: 'rgba(255,255,255,0.07)',
          transition: 'width 0.7s cubic-bezier(0.4,0,0.2,1)',
        }}
      />

      {/* Actual fill bar */}
      <div
        className="absolute inset-y-0 left-0 rounded-xl"
        style={{
          width: `${cActual}%`,
          background: `linear-gradient(90deg, ${accent}bb 0%, ${accent} 100%)`,
          boxShadow: `0 0 16px ${accent}55`,
          transition: 'width 0.7s cubic-bezier(0.4,0,0.2,1)',
        }}
      />

      {/* Expected pace vertical marker */}
      {cExpected > 1 && cExpected < 99 && (
        <div
          className="absolute inset-y-0"
          style={{
            left: `${cExpected}%`,
            width: 2,
            background: 'rgba(255,255,255,0.55)',
            boxShadow: '0 0 6px rgba(255,255,255,0.3)',
            transition: 'left 0.7s cubic-bezier(0.4,0,0.2,1)',
            transform: 'translateX(-50%)',
          }}
        />
      )}

      {/* Flash pulse overlay */}
      <div
        className="absolute inset-0 rounded-xl pointer-events-none"
        style={{
          background: flashColor,
          transition: 'background 0.15s ease',
        }}
      />
    </div>
  );
}

// ─── Bottom stat pill ─────────────────────────────────────────────────────────

interface StatPillProps {
  label: string;
  value: string;
  valueColor?: string;
}
function StatPill({ label, value, valueColor = 'rgba(255,255,255,0.9)' }: StatPillProps) {
  return (
    <div className="flex flex-col items-center gap-0.5 flex-1">
      <span style={{ fontSize: 10, color: 'rgba(148,163,184,0.7)', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        {label}
      </span>
      <span style={{ fontSize: 15, fontWeight: 700, color: valueColor, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
        {value}
      </span>
    </div>
  );
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
    dailyRvuGoal:  settings?.dailyRvuGoal  ?? DEFAULT_DAILY_PACE_SETTINGS.dailyRvuGoal,
    workdayStart:  settings?.workdayStart  ?? DEFAULT_DAILY_PACE_SETTINGS.workdayStart,
    workdayEnd:    settings?.workdayEnd    ?? DEFAULT_DAILY_PACE_SETTINGS.workdayEnd,
    breakMinutes:  settings?.breakMinutes  ?? DEFAULT_DAILY_PACE_SETTINGS.breakMinutes,
  };

  const prevAchievedRef  = useRef(false);
  const prevRvuRef       = useRef<number | null>(null);
  const flashTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [showConfetti, setShowConfetti]   = useState(false);
  const [metrics, setMetrics]             = useState<DailyPaceMetrics | null>(null);
  const [lastUpdated, setLastUpdated]     = useState<Date>(new Date());
  const [flash, setFlash]                 = useState<'none' | 'green' | 'amber'>('none');

  const recalculate = useCallback(() => {
    if (!todayLogs) return;
    const m = computeDailyPace(todayLogs, paceSettings, prevAchievedRef.current);
    setMetrics(m);
    setLastUpdated(new Date());

    // Confetti
    if (m.goalJustAchieved) {
      prevAchievedRef.current = true;
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 4500);
    }
    if (m.currentRvu < m.dailyGoal) prevAchievedRef.current = false;

    // Flash on new study logged
    if (prevRvuRef.current !== null && m.currentRvu > prevRvuRef.current + 0.01) {
      const flashType = m.status === 'behind' || m.status === 'slightly_behind' ? 'amber' : 'green';
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      setFlash(flashType);
      flashTimerRef.current = setTimeout(() => setFlash('none'), 450);
    }
    prevRvuRef.current = m.currentRvu;
  }, [todayLogs, paceSettings.dailyRvuGoal, paceSettings.workdayStart, paceSettings.workdayEnd, paceSettings.breakMinutes]);

  useEffect(() => {
    recalculate();
    const iv = setInterval(recalculate, 60_000);
    return () => { clearInterval(iv); if (flashTimerRef.current) clearTimeout(flashTimerRef.current); };
  }, [recalculate]);

  useEffect(() => {
    document.title = metrics
      ? `${metrics.currentRvu.toFixed(1)} / ${metrics.dailyGoal} · wRVU Pace`
      : 'wRVU Pace';
  }, [metrics]);

  // ── Loading ───────────────────────────────────────────────────────────────
  if (!metrics || todayLogs === undefined) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#07090f' }}>
        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const accent = accentCss(metrics.status);
  const sd     = getStatusDisplay(metrics.status);

  // Time pace label — the headline status ("34 min ahead", "On pace", etc.)
  const timePaceLabel = formatTimePaceLabel(metrics.timeAheadBehindMinutes, metrics.status);

  // wRVU difference label (secondary)
  const rvuDiff = metrics.paceDifference;
  const rvuDiffLabel =
    metrics.status === 'before_work' ? '' :
    rvuDiff >= 0 ? `+${rvuDiff.toFixed(1)} wRVU` : `${rvuDiff.toFixed(1)} wRVU`;

  // Projected finish label
  const projLabel =
    metrics.status === 'before_work' ? '—' :
    (metrics.status === 'goal_achieved' || metrics.status === 'after_work')
      ? metrics.currentRvu.toFixed(1)
      : metrics.projectedEndOfDay.toFixed(1);

  const projColor =
    metrics.status === 'goal_achieved' ? '#34d399' :
    parseFloat(projLabel) >= metrics.dailyGoal ? '#34d399' : '#fb923c';

  // Required/hr label
  const reqLabel =
    metrics.remainingWorkMinutes <= 0 || metrics.remainingToGoal <= 0
      ? '—'
      : `${metrics.requiredRvuPerHour.toFixed(1)}/hr`;

  const reqColor =
    metrics.requiredRvuPerHour > 25 ? '#f87171' :
    metrics.requiredRvuPerHour > 15 ? '#fb923c' : 'rgba(255,255,255,0.85)';

  // Last updated
  const d = lastUpdated;
  let h = d.getHours(), mi = d.getMinutes();
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  const updatedLabel = `${h}:${String(mi).padStart(2, '0')} ${ap}`;

  // Status color for time label
  const timeLabelColor =
    metrics.status === 'goal_achieved' ? '#fbbf24' :
    metrics.status === 'ahead'         ? '#34d399' :
    metrics.status === 'on_track'      ? '#60a5fa' :
    metrics.status === 'slightly_behind' ? '#fb923c' :
    metrics.status === 'behind'        ? '#f87171' : 'rgba(148,163,184,0.8)';

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#07090f',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
      }}
    >
      <ConfettiCanvas active={showConfetti} />

      {/* ── Instrument card ─────────────────────────────────────────────── */}
      <div
        style={{
          width: '100%',
          maxWidth: 660,
          borderRadius: 20,
          border: `1px solid ${accent}22`,
          background: 'linear-gradient(160deg, #0d1225 0%, #090c18 100%)',
          boxShadow: glowCss(metrics.status),
          transition: 'box-shadow 0.9s ease, border-color 0.9s ease',
          padding: '20px 24px 18px',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        {/* ── Row 1: title + time-pace status ─────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          {/* Left: brand */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, color: 'rgba(148,163,184,0.6)', fontWeight: 600, letterSpacing: '0.04em' }}>
              wRVU PACE
            </span>
            <span style={{ width: 1, height: 14, background: 'rgba(255,255,255,0.1)' }} />
            <span style={{ fontSize: 12, color: 'rgba(100,116,139,0.7)' }}>
              📌 Companion
            </span>
          </div>

          {/* Right: time-based status pill — the headline */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              background: `${accent}18`,
              border: `1px solid ${accent}35`,
              borderRadius: 100,
              padding: '5px 14px',
              transition: 'background 0.7s, border-color 0.7s',
            }}
          >
            <span
              style={{
                width: 7, height: 7, borderRadius: '50%',
                background: accent,
                boxShadow: `0 0 6px ${accent}`,
                animation: 'pulse 2s infinite',
              }}
            />
            <span style={{ fontSize: 15, fontWeight: 700, color: timeLabelColor, letterSpacing: '-0.01em' }}>
              {timePaceLabel}
            </span>
          </div>
        </div>

        {/* ── Row 2: big wRVU number + percent ────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span
              style={{
                fontSize: 52,
                fontWeight: 900,
                color: accent,
                lineHeight: 1,
                fontVariantNumeric: 'tabular-nums',
                textShadow: `0 0 28px ${accent}55`,
                transition: 'color 0.7s ease, text-shadow 0.7s ease',
                letterSpacing: '-0.02em',
              }}
            >
              {metrics.currentRvu.toFixed(1)}
            </span>
            <span style={{ fontSize: 22, color: 'rgba(148,163,184,0.55)', fontWeight: 500 }}>
              / {metrics.dailyGoal}
            </span>
            <span style={{ fontSize: 13, color: 'rgba(148,163,184,0.5)', fontWeight: 400, marginLeft: -2 }}>
              wRVU
            </span>
          </div>

          <span
            style={{
              fontSize: 34,
              fontWeight: 800,
              color: accent,
              lineHeight: 1,
              fontVariantNumeric: 'tabular-nums',
              opacity: 0.85,
              letterSpacing: '-0.02em',
            }}
          >
            {Math.min(999, Math.round(metrics.percentComplete))}%
          </span>
        </div>

        {/* ── Row 3: Instrument bar ────────────────────────────────────── */}
        <InstrumentBar
          actualPct={metrics.actualPercent}
          expectedPct={metrics.expectedPercent}
          accent={accent}
          flash={flash}
        />

        {/* Bar sub-labels */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: -8 }}>
          <span style={{ fontSize: 11, color: accent, fontWeight: 600 }}>
            Actual
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', fontWeight: 500 }}>
              ▲ Expected now · {metrics.status !== 'before_work' ? metrics.expectedRvu.toFixed(1) : '—'} wRVU
            </span>
            {rvuDiffLabel && (
              <span style={{ fontSize: 11, fontWeight: 700, color: timeLabelColor }}>
                {rvuDiffLabel}
              </span>
            )}
          </div>
          <span style={{ fontSize: 11, color: 'rgba(148,163,184,0.4)', fontWeight: 500 }}>
            Goal {metrics.dailyGoal}
          </span>
        </div>

        {/* ── Row 4: bottom stat pills ─────────────────────────────────── */}
        <div
          style={{
            display: 'flex',
            gap: 0,
            borderTop: '1px solid rgba(255,255,255,0.06)',
            paddingTop: 12,
          }}
        >
          <StatPill
            label="Projected"
            value={projLabel}
            valueColor={projColor}
          />
          <div style={{ width: 1, background: 'rgba(255,255,255,0.07)', margin: '0 4px' }} />
          <StatPill
            label="Required/hr"
            value={reqLabel}
            valueColor={reqColor}
          />
          <div style={{ width: 1, background: 'rgba(255,255,255,0.07)', margin: '0 4px' }} />
          <StatPill
            label="Updated"
            value={updatedLabel}
            valueColor="rgba(100,116,139,0.8)"
          />
        </div>
      </div>

      {/* Pulse keyframe */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
