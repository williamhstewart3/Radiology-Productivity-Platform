/**
 * MiniPaceWindow.tsx
 *
 * Minimal companion display — Bloomberg Terminal / Apple Watch aesthetic.
 * Baptist Medical Group branding: navy bg, sky blue + status colors.
 * One glance = full picture. Sub-second comprehension.
 *
 * DATA SOURCE: studyLogs table only.
 */

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import { useProfile } from '../hooks/useProfile';
import {
  computeDailyPace,
  DEFAULT_DAILY_PACE_SETTINGS,
  type DailyPaceSettings,
  type DailyPaceMetrics,
} from '../utils/dailyPaceCalculations';
import { todayDateString } from '../utils/calculations';
import { ConfettiCanvas } from './ConfettiCanvas';
import { baptistTheme as t } from '../lib/theme';

// ─── Status → visual tokens ─────────────────────────────────────────────────

interface StatusTokens {
  fill:        string;
  fillGlow:    string;
  windowGlow:  string;
  text:        string;
}

function statusTokens(status: DailyPaceMetrics['status']): StatusTokens {
  switch (status) {
    case 'ahead':
    case 'goal_achieved':
      return {
        fill:       t.colors.ahead,
        fillGlow:   `0 0 18px ${t.colors.ahead}bb`,
        windowGlow: `0 0 60px ${t.colors.ahead}1f, 0 0 120px ${t.colors.ahead}0d`,
        text:       '#4ade80',
      };
    case 'on_track':
      return {
        fill:       t.colors.onTrack,
        fillGlow:   `0 0 18px ${t.colors.onTrack}bb`,
        windowGlow: `0 0 60px ${t.colors.onTrack}1f, 0 0 120px ${t.colors.onTrack}0d`,
        text:       '#60a5fa',
      };
    case 'slightly_behind':
      return {
        fill:       t.colors.caution,
        fillGlow:   `0 0 18px ${t.colors.caution}bb`,
        windowGlow: `0 0 60px ${t.colors.caution}1f, 0 0 120px ${t.colors.caution}0d`,
        text:       '#fbbf24',
      };
    case 'behind':
      return {
        fill:       t.colors.behind,
        fillGlow:   `0 0 18px ${t.colors.behind}bb`,
        windowGlow: `0 0 60px ${t.colors.behind}1f, 0 0 120px ${t.colors.behind}0d`,
        text:       '#f87171',
      };
    case 'after_work':
      return {
        fill:       t.colors.accent,
        fillGlow:   `0 0 18px ${t.colors.accent}99`,
        windowGlow: `0 0 60px ${t.colors.accent}19, 0 0 120px ${t.colors.accent}0d`,
        text:       t.colors.accent,
      };
    default: // before_work
      return {
        fill:       '#374151',
        fillGlow:   'none',
        windowGlow: `0 0 40px rgba(15,24,36,0.5)`,
        text:       t.colors.textMuted,
      };
  }
}

// ─── Animated counter hook ───────────────────────────────────────────────────

function useCountUp(target: number, duration = 350): number {
  const [display, setDisplay] = useState(target);
  const rafRef   = useRef<number | null>(null);
  const startRef = useRef<{ from: number; to: number; t0: number } | null>(null);

  useEffect(() => {
    const prev = startRef.current?.to ?? target;
    if (Math.abs(target - prev) < 0.05) {
      setDisplay(target);
      return;
    }
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const from = display;
    startRef.current = { from, to: target, t0: performance.now() };

    const step = (now: number) => {
      const elapsed = now - startRef.current!.t0;
      const progress = Math.min(1, elapsed / duration);
      const ease = 1 - Math.pow(1 - progress, 3);
      setDisplay(from + (target - from) * ease);
      if (progress < 1) rafRef.current = requestAnimationFrame(step);
      else setDisplay(target);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [target]);

  return display;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function MiniPaceWindow() {
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
  const prevRvuRef      = useRef<number | null>(null);
  const pulseTimer      = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [metrics, setMetrics]           = useState<DailyPaceMetrics | null>(null);
  const [lastUpdated, setLastUpdated]   = useState<Date>(new Date());
  const [showConfetti, setShowConfetti] = useState(false);
  const [pulse, setPulse]               = useState(false);

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

    if (prevRvuRef.current !== null && m.currentRvu > prevRvuRef.current + 0.01) {
      if (pulseTimer.current) clearTimeout(pulseTimer.current);
      setPulse(true);
      pulseTimer.current = setTimeout(() => setPulse(false), 450);
    }
    prevRvuRef.current = m.currentRvu;
  }, [todayLogs, paceSettings]);

  useEffect(() => {
    recalculate();
    const iv = setInterval(recalculate, 60_000);
    return () => { clearInterval(iv); if (pulseTimer.current) clearTimeout(pulseTimer.current); };
  }, [recalculate]);

  useEffect(() => {
    document.title = metrics
      ? `${metrics.currentRvu.toFixed(1)} / ${metrics.dailyGoal} wRVU`
      : 'wRVU Pace';
  }, [metrics]);

  const animatedRvu = useCountUp(metrics?.currentRvu ?? 0, 350);

  if (!metrics || todayLogs === undefined) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: t.colors.bgDeep,
      }}>
        <div style={{
          width: 28, height: 28, borderRadius: '50%',
          border: `2px solid ${t.colors.accent}`,
          borderTopColor: 'transparent',
          animation: 'spin 0.8s linear infinite',
        }} />
      </div>
    );
  }

  const tokens      = statusTokens(metrics.status);
  const actualPct   = Math.min(100, Math.max(0, metrics.actualPercent));
  const expectedPct = Math.min(100, Math.max(0, metrics.expectedPercent));

  const diff      = metrics.paceDifference;
  const diffSign  = diff >= 0 ? '+' : '';
  const diffLabel = `${diffSign}${diff.toFixed(1)} wRVU`;

  const projLabel =
    metrics.status === 'before_work'   ? '—' :
    metrics.status === 'goal_achieved' ? `${metrics.currentRvu.toFixed(1)} wRVU` :
    metrics.status === 'after_work'    ? `${metrics.currentRvu.toFixed(1)} wRVU` :
    `${metrics.projectedEndOfDay.toFixed(1)} wRVU`;

  const d = lastUpdated;
  let h = d.getHours(), mi = d.getMinutes();
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  const updatedStr = `${h}:${String(mi).padStart(2, '0')} ${ap}`;

  const beforeWork = metrics.status === 'before_work';

  return (
    <div style={{
      minHeight: '100vh',
      background: t.colors.bgDeep,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 'clamp(12px, 3vw, 32px)',
      fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');

        .mini-card { width: 100%; max-width: clamp(420px, 80vw, 760px); }

        @keyframes spin { to { transform: rotate(360deg); } }

        @keyframes barPulse {
          0%   { filter: brightness(1); }
          40%  { filter: brightness(1.5); }
          100% { filter: brightness(1); }
        }
        .bar-pulse { animation: barPulse 0.45s ease-out forwards; }
      `}</style>

      <ConfettiCanvas active={showConfetti} />

      {/* ── Outer card ───────────────────────────────────────────────── */}
      <div
        className="mini-card"
        style={{
          borderRadius: 'clamp(10px, 2vw, 18px)',
          border: `1px solid ${tokens.fill}2a`,
          background: `linear-gradient(145deg, ${t.colors.bgCard} 0%, ${t.colors.bgDeep} 100%)`,
          boxShadow: `${tokens.windowGlow}, inset 0 1px 0 rgba(91,184,212,0.05)`,
          transition: 'box-shadow 1.2s ease, border-color 1.2s ease',
          padding: 'clamp(16px, 3vw, 30px) clamp(18px, 3.5vw, 34px) clamp(14px, 2.5vw, 24px)',
          display: 'flex', flexDirection: 'column',
          gap: 'clamp(14px, 2.5vw, 22px)',
          position: 'relative',
        }}
      >

        {/* ── wRVU number ── */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 'clamp(6px, 1.2vw, 12px)' }}>
          <span style={{
            fontSize: 'clamp(48px, 8vw, 80px)',
            fontWeight: 900,
            color: tokens.text,
            lineHeight: 1,
            fontVariantNumeric: 'tabular-nums',
            letterSpacing: '-0.04em',
            textShadow: `0 0 40px ${tokens.fill}55`,
            transition: 'color 0.8s ease, text-shadow 0.8s ease',
            minWidth: '3ch',
          }}>
            {animatedRvu.toFixed(1)}
          </span>
          <span style={{
            fontSize: 'clamp(14px, 2.2vw, 22px)',
            color: 'rgba(148,163,184,0.35)',
            fontWeight: 500,
            letterSpacing: '-0.01em',
            paddingBottom: 'clamp(4px, 0.8vw, 8px)',
          }}>
            / {metrics.dailyGoal} wRVU
          </span>
        </div>

        {/* ── Progress bar ── */}
        <div>
          <div style={{
            position: 'relative',
            width: '100%',
            height: 'clamp(22px, 3.5vw, 40px)',
            borderRadius: 'clamp(4px, 1vw, 8px)',
            background: 'rgba(91,184,212,0.06)',
            overflow: 'visible',
          }}>
            <div style={{
              position: 'absolute', inset: 0,
              borderRadius: 'inherit', overflow: 'hidden',
            }}>
              {/* Ghost expected shading */}
              <div style={{
                position: 'absolute', inset: 0,
                width: `${expectedPct}%`,
                background: 'rgba(91,184,212,0.07)',
                transition: 'width 0.9s cubic-bezier(0.4,0,0.2,1)',
              }} />
              {/* Actual fill */}
              <div
                className={pulse ? 'bar-pulse' : ''}
                style={{
                  position: 'absolute', inset: 0,
                  width: `${actualPct}%`,
                  background: tokens.fill,
                  boxShadow: tokens.fillGlow,
                  transition: 'width 0.85s cubic-bezier(0.4,0,0.2,1), background 1s ease, box-shadow 1s ease',
                }}
              />
            </div>

            {/* Expected marker */}
            {expectedPct > 1 && expectedPct < 99 && (
              <div style={{
                position: 'absolute',
                top: -2, bottom: -2,
                left: `${expectedPct}%`,
                width: 3,
                transform: 'translateX(-50%)',
                background: 'rgba(255,255,255,0.85)',
                boxShadow: '0 0 6px rgba(255,255,255,0.7), 0 0 12px rgba(255,255,255,0.35)',
                borderRadius: 2,
                transition: 'left 0.9s cubic-bezier(0.4,0,0.2,1)',
                zIndex: 2,
              }} />
            )}
          </div>
        </div>

        {/* ── Metrics row ── */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 'clamp(12px, 3vw, 28px)',
        }}>
          {/* Left: Expected + Difference */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(2px, 0.5vw, 5px)' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 'clamp(4px, 0.8vw, 8px)' }}>
              <span style={{
                fontSize: 'clamp(10px, 1.4vw, 13px)', color: 'rgba(148,163,184,0.5)',
                fontWeight: 500, letterSpacing: '0.04em', textTransform: 'uppercase',
              }}>Expected</span>
              <span style={{
                fontSize: 'clamp(13px, 2vw, 18px)', fontWeight: 700,
                color: 'rgba(224,234,244,0.9)', fontVariantNumeric: 'tabular-nums',
                letterSpacing: '-0.02em',
              }}>
                {beforeWork ? '—' : `${metrics.expectedRvu.toFixed(1)} wRVU`}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 'clamp(4px, 0.8vw, 8px)' }}>
              <span style={{
                fontSize: 'clamp(10px, 1.4vw, 13px)', color: 'rgba(148,163,184,0.5)',
                fontWeight: 500, letterSpacing: '0.04em', textTransform: 'uppercase',
              }}>Difference</span>
              <span style={{
                fontSize: 'clamp(13px, 2vw, 18px)', fontWeight: 700,
                color: tokens.text, fontVariantNumeric: 'tabular-nums',
                letterSpacing: '-0.02em', transition: 'color 0.6s ease',
              }}>
                {beforeWork ? '—' : diffLabel}
              </span>
            </div>
          </div>

          {/* Right: Projected Finish */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 'clamp(2px, 0.5vw, 5px)' }}>
            <span style={{
              fontSize: 'clamp(10px, 1.4vw, 13px)', color: 'rgba(148,163,184,0.5)',
              fontWeight: 500, letterSpacing: '0.04em', textTransform: 'uppercase',
            }}>Projected Finish</span>
            <span style={{
              fontSize: 'clamp(16px, 2.8vw, 26px)', fontWeight: 800,
              color: metrics.projectedEndOfDay >= metrics.dailyGoal || metrics.status === 'goal_achieved'
                ? t.colors.ahead : 'rgba(224,234,244,0.9)',
              fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.03em',
              transition: 'color 0.6s ease',
            }}>
              {projLabel}
            </span>
          </div>
        </div>

        {/* ── Updated timestamp ── */}
        <div style={{
          position: 'absolute',
          bottom: 'clamp(8px, 1.2vw, 14px)',
          right: 'clamp(14px, 2vw, 22px)',
          fontSize: 'clamp(9px, 1.1vw, 11px)',
          color: 'rgba(91,184,212,0.3)',
          fontWeight: 400, letterSpacing: '0.02em', fontVariantNumeric: 'tabular-nums',
        }}>
          Updated {updatedStr}
        </div>

      </div>
    </div>
  );
}
