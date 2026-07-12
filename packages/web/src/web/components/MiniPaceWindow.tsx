/**
 * MiniPaceWindow.tsx
 *
 * The app's face when docked next to PACS — a first-class HUD surface, not a
 * leftover. Per the UI modernization spec: ring thumbnail + today's number +
 * pace delta, nothing else. Always dark (reading-room HUD), independent of
 * the main window's light/dark setting since this renders in its own popup
 * document.
 *
 * DATA SOURCE: studyLogs table only. Pace math is untouched — computeDailyPace.
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
import { Ring, useCountUp } from './ui/Ring';

const HUD_BG = '#000000';
const HUD_ACCENT = '#0A6CFF';
const HUD_POSITIVE = '#30D158';
const HUD_CAUTION = '#FF9F0A';
const HUD_LABEL_SECONDARY = '#98989D';

function paceColor(status: DailyPaceMetrics['status']): string {
  switch (status) {
    case 'ahead':
    case 'goal_achieved':
    case 'on_track':
      return HUD_POSITIVE;
    case 'slightly_behind':
    case 'behind':
      return HUD_CAUTION;
    case 'after_work':
      return HUD_ACCENT;
    default:
      return HUD_LABEL_SECONDARY;
  }
}

function paceDeltaText(metrics: DailyPaceMetrics): string {
  if (metrics.status === 'before_work') return 'Not started';
  if (metrics.status === 'goal_achieved') return 'Goal achieved';
  const diff = metrics.paceDifference;
  if (Math.abs(diff) < 1) return 'On pace';
  return diff > 0 ? `Ahead by ${diff.toFixed(1)}` : `${Math.abs(diff).toFixed(1)} behind pace`;
}

interface MiniPaceWindowProps {
  embedded?: boolean;
}

export function MiniPaceWindow({ embedded = false }: MiniPaceWindowProps) {
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
  const inboxCount = useLiveQuery(async () => {
    const sessions = await db.activeReviewSessions.where('status').equals('active').toArray();
    return sessions.filter((session) => session.profileId === profileId || session.profileId == null).reduce((sum, session) => sum + session.needsReviewCount, 0);
  }, [profileId], 0);

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
  const [metrics, setMetrics] = useState<DailyPaceMetrics | null>(null);

  const recalculate = useCallback(() => {
    if (!todayLogs) return;
    const m = computeDailyPace(todayLogs, paceSettings, prevAchievedRef.current);
    setMetrics(m);
    if (m.goalJustAchieved) prevAchievedRef.current = true;
    if (m.currentRvu < m.dailyGoal) prevAchievedRef.current = false;
  }, [todayLogs, paceSettings]);

  useEffect(() => {
    recalculate();
    const iv = setInterval(recalculate, 60_000);
    return () => clearInterval(iv);
  }, [recalculate]);

  useEffect(() => {
    document.title = metrics ? `${metrics.currentRvu.toFixed(1)} / ${metrics.dailyGoal} wRVU` : 'wRVU Pace';
  }, [metrics]);

  const animatedRvu = useCountUp(metrics?.currentRvu ?? 0, 350);

  if (!metrics || todayLogs === undefined) {
    return (
      <div
        style={{
          minHeight: embedded ? '200px' : '100vh',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: HUD_BG,
        }}
      >
        <div
          style={{
            width: 28, height: 28, borderRadius: '50%',
            border: `2px solid ${HUD_ACCENT}`,
            borderTopColor: 'transparent',
            animation: 'rd-mini-spin 0.8s linear',
          }}
        />
        <style>{`@keyframes rd-mini-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  const color = paceColor(metrics.status);

  return (
    <div
      style={{
        minHeight: embedded ? 'auto' : '100vh',
        background: HUD_BG,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: embedded ? '0' : 'clamp(16px, 4vw, 32px)',
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(16px, 3vw, 28px)' }}>
        <Ring
          percent={metrics.actualPercent}
          size={140}
          strokeWidth={12}
          label={`${metrics.currentRvu.toFixed(1)} of ${metrics.dailyGoal} wRVU`}
        >
          <span
            style={{
              fontSize: 'clamp(24px, 4vw, 32px)',
              fontWeight: 700,
              color: '#F5F5F7',
              lineHeight: 1,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {animatedRvu.toFixed(1)}
          </span>
        </Ring>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span
            style={{
              fontSize: 'clamp(11px, 1.6vw, 13px)',
              color: HUD_LABEL_SECONDARY,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            of {metrics.dailyGoal} goal
          </span>
          <span
            style={{
              fontSize: 'clamp(15px, 2.2vw, 18px)',
              fontWeight: 600,
              color,
            }}
          >
            {paceDeltaText(metrics)}
          </span>
          <button type="button" onClick={() => { window.opener?.location.assign('/inbox'); window.focus(); }} style={{ border: 0, padding: 0, background: 'transparent', color: inboxCount > 0 ? HUD_CAUTION : HUD_LABEL_SECONDARY, textAlign: 'left', fontSize: 13, cursor: 'pointer' }}>
            {inboxCount > 0 ? `${inboxCount} inbox` : 'All counted'}
          </button>
        </div>
      </div>
    </div>
  );
}
