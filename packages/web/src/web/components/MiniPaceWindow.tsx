/**
 * MiniPaceWindow.tsx
 *
 * Ultra-minimal pace monitor. One glance = full picture.
 * DATA SOURCE: studyLogs table only.
 * FUTURE: Any ingestion pipeline (PowerScribe, OCR, CSV) writes to studyLogs — no changes needed here.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import {
  computeDailyPace,
  DEFAULT_DAILY_PACE_SETTINGS,
  type DailyPaceSettings,
  type DailyPaceMetrics,
} from '../utils/dailyPaceCalculations';
import { todayDateString } from '../utils/calculations';
import { ConfettiCanvas } from './ConfettiCanvas';

function accentCss(status: DailyPaceMetrics['status']): string {
  switch (status) {
    case 'goal_achieved':    return '#fbbf24';
    case 'ahead':            return '#34d399';
    case 'on_track':         return '#60a5fa';
    case 'slightly_behind':  return '#fb923c';
    case 'behind':           return '#f87171';
    case 'after_work':       return '#a78bfa';
    default:                 return '#64748b';
  }
}

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
    workdayEnd:   settings?.workdayEnd   ?? DEFAULT_DAILY_PACE_SETTINGS.workdayEnd,
    breakMinutes: settings?.breakMinutes ?? DEFAULT_DAILY_PACE_SETTINGS.breakMinutes,
  };

  const prevAchievedRef = useRef(false);
  const prevRvuRef      = useRef<number | null>(null);
  const flashTimer      = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [metrics, setMetrics]         = useState<DailyPaceMetrics | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [showConfetti, setShowConfetti] = useState(false);
  const [flash, setFlash]             = useState(false);

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
    if (m.currentRvu < m.dailyGoal) prevAchievedRef.current = false;

    // Brief bar flash when wRVU increases
    if (prevRvuRef.current !== null && m.currentRvu > prevRvuRef.current + 0.01) {
      if (flashTimer.current) clearTimeout(flashTimer.current);
      setFlash(true);
      flashTimer.current = setTimeout(() => setFlash(false), 400);
    }
    prevRvuRef.current = m.currentRvu;
  }, [todayLogs, paceSettings.dailyRvuGoal, paceSettings.workdayStart, paceSettings.workdayEnd, paceSettings.breakMinutes]);

  useEffect(() => {
    recalculate();
    const iv = setInterval(recalculate, 60_000);
    return () => { clearInterval(iv); if (flashTimer.current) clearTimeout(flashTimer.current); };
  }, [recalculate]);

  useEffect(() => {
    document.title = metrics
      ? `${metrics.currentRvu.toFixed(1)} / ${metrics.dailyGoal} wRVU`
      : 'wRVU Pace';
  }, [metrics]);

  if (!metrics || todayLogs === undefined) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#07090f' }}>
        <div className="w-5 h-5 border-2 border-slate-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const accent = accentCss(metrics.status);

  const actualPct   = Math.min(100, Math.max(0, metrics.actualPercent));
  const expectedPct = Math.min(100, Math.max(0, metrics.expectedPercent));

  const diff        = metrics.paceDifference;
  const diffLabel   = diff >= 0 ? `+${diff.toFixed(1)}` : diff.toFixed(1);
  const diffColor   = diff >= 0.3 ? '#34d399' : diff <= -0.3 ? '#f87171' : '#60a5fa';

  const projLabel =
    metrics.status === 'before_work'
      ? '—'
      : metrics.status === 'goal_achieved' || metrics.status === 'after_work'
      ? metrics.currentRvu.toFixed(1)
      : metrics.projectedEndOfDay.toFixed(1);

  const d = lastUpdated;
  let h = d.getHours(), mi = d.getMinutes();
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  const updatedStr = `${h}:${String(mi).padStart(2, '0')} ${ap}`;

  return (
    <div style={{
      minHeight: '100vh',
      background: '#07090f',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px',
      fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
    }}>
      <ConfettiCanvas active={showConfetti} />

      <div style={{
        width: '100%',
        maxWidth: 620,
        borderRadius: 16,
        border: `1px solid ${accent}20`,
        background: '#0d1225',
        boxShadow: `0 0 48px ${accent}18, 0 0 100px ${accent}08`,
        transition: 'box-shadow 1s ease, border-color 1s ease',
        padding: '24px 28px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
      }}>

        {/* ── wRVU number ──────────────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{
            fontSize: 56,
            fontWeight: 900,
            color: accent,
            lineHeight: 1,
            fontVariantNumeric: 'tabular-nums',
            letterSpacing: '-0.03em',
            textShadow: `0 0 32px ${accent}44`,
            transition: 'color 0.8s ease, text-shadow 0.8s ease',
          }}>
            {metrics.currentRvu.toFixed(1)}
          </span>
          <span style={{ fontSize: 24, color: 'rgba(148,163,184,0.45)', fontWeight: 400, letterSpacing: '-0.01em' }}>
            / {metrics.dailyGoal} wRVU
          </span>
        </div>

        {/* ── Progress bar ──────────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{
            position: 'relative',
            width: '100%',
            height: 36,
            borderRadius: 8,
            background: 'rgba(255,255,255,0.05)',
            overflow: 'hidden',
          }}>
            {/* Ghost expected shading */}
            <div style={{
              position: 'absolute', inset: 0, left: 0,
              width: `${expectedPct}%`,
              background: 'rgba(255,255,255,0.055)',
              transition: 'width 0.8s cubic-bezier(0.4,0,0.2,1)',
              borderRadius: 8,
            }} />

            {/* Actual fill */}
            <div style={{
              position: 'absolute', inset: 0, left: 0,
              width: `${actualPct}%`,
              background: flash
                ? `linear-gradient(90deg, ${accent}cc, ${accent}ff)`
                : `linear-gradient(90deg, ${accent}99, ${accent}dd)`,
              boxShadow: flash ? `0 0 22px ${accent}99` : `0 0 10px ${accent}44`,
              borderRadius: 8,
              transition: 'width 0.8s cubic-bezier(0.4,0,0.2,1), background 0.2s ease, box-shadow 0.2s ease',
            }} />

            {/* Expected marker — thin white vertical line */}
            {expectedPct > 1 && expectedPct < 99 && (
              <div style={{
                position: 'absolute', top: 0, bottom: 0,
                left: `${expectedPct}%`,
                width: 2,
                transform: 'translateX(-50%)',
                background: 'rgba(255,255,255,0.65)',
                transition: 'left 0.8s cubic-bezier(0.4,0,0.2,1)',
              }} />
            )}
          </div>

          {/* Bar annotation row */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            {/* Left: diff */}
            <span style={{
              fontSize: 18,
              fontWeight: 700,
              color: diffColor,
              fontVariantNumeric: 'tabular-nums',
              letterSpacing: '-0.01em',
              transition: 'color 0.5s ease',
            }}>
              {metrics.status === 'before_work' ? '—' : `${diffLabel} wRVU`}
            </span>

            {/* Right: expected marker label */}
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)', fontWeight: 500 }}>
              {metrics.status !== 'before_work'
                ? `Expected: ${metrics.expectedRvu.toFixed(1)}`
                : 'Shift not started'}
            </span>
          </div>
        </div>

        {/* ── Bottom row ────────────────────────────────────────────────── */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          paddingTop: 14,
        }}>
          <span style={{ fontSize: 13, color: 'rgba(148,163,184,0.55)', fontWeight: 500 }}>
            Projected Finish:{' '}
            <span style={{
              color: parseFloat(projLabel) >= metrics.dailyGoal || metrics.status === 'goal_achieved'
                ? '#34d399' : 'rgba(255,255,255,0.75)',
              fontWeight: 700,
              fontVariantNumeric: 'tabular-nums',
            }}>
              {projLabel}
            </span>
          </span>

          <span style={{ fontSize: 11, color: 'rgba(100,116,139,0.6)', fontWeight: 400 }}>
            Updated {updatedStr}
          </span>
        </div>
      </div>
    </div>
  );
}
