/**
 * dailyPaceCalculations.ts
 *
 * All math for the Daily Pace Dashboard lives here — no DB access, no React.
 * Inputs are already-loaded StudyLog[] and DailyPaceSettings.
 *
 * FUTURE INTEGRATION NOTE:
 * PowerScribe, OCR, and any other ingestion pipeline should write completed
 * studies to the `studyLogs` table. This utility only consumes StudyLog[],
 * so it requires zero changes when new data sources are added.
 */

import type { StudyLog } from '../types';

// ─── Settings ──────────────────────────────────────────────────────────────

export interface DailyPaceSettings {
  /** Target wRVUs for the full workday (default 90) */
  dailyRvuGoal: number;
  /** Workday start as "HH:MM" 24-hr (default "08:00") */
  workdayStart: string;
  /** Workday end as "HH:MM" 24-hr (default "17:00") */
  workdayEnd: string;
  /** Scheduled break minutes to subtract from available work time (default 0) */
  breakMinutes: number;
}

export const DEFAULT_DAILY_PACE_SETTINGS: DailyPaceSettings = {
  dailyRvuGoal: 90,
  workdayStart: '08:00',
  workdayEnd: '17:00',
  breakMinutes: 0,
};

// ─── Output ────────────────────────────────────────────────────────────────

export type PaceStatus =
  | 'before_work'
  | 'goal_achieved'
  | 'ahead'
  | 'on_track'
  | 'slightly_behind'
  | 'behind'
  | 'after_work';

export interface DailyPaceMetrics {
  /** wRVUs logged so far today */
  currentRvu: number;
  /** Configured daily goal */
  dailyGoal: number;
  /** Percentage of goal completed (0–100+) */
  percentComplete: number;
  /** Minutes elapsed since workday start (clamped 0–shiftMinutes) */
  elapsedWorkMinutes: number;
  /** Minutes remaining until workday end (clamped ≥ 0) */
  remainingWorkMinutes: number;
  /** Total available work minutes (shift minus breaks) */
  shiftMinutes: number;
  /** Expected wRVUs at the current clock time based on linear pace */
  expectedRvu: number;
  /** Progress toward expected (0–100+) — for dual progress bars */
  expectedPercent: number;
  /** actualPercent of daily goal (0-100+) */
  actualPercent: number;
  /** Positive = ahead, negative = behind */
  paceDifference: number;
  /** Linear extrapolation to end of shift */
  projectedEndOfDay: number;
  /** How many wRVUs still needed to hit goal */
  remainingToGoal: number;
  /** Required wRVU/hour for remainder of shift to finish at goal */
  requiredRvuPerHour: number;
  /** Current overall status */
  status: PaceStatus;
  /** Whether confetti should fire (crossed goal this tick) */
  goalJustAchieved: boolean;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Parse "HH:MM" into total minutes since midnight */
function hhmm(s: string): number {
  const [h, m] = s.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return 0;
  return h * 60 + m;
}

/** Current local time as minutes since midnight */
function nowMinutes(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

/** Sum work RVUs from today's logs, excluding flagged-for-review */
export function sumTodayRvu(logs: StudyLog[]): number {
  return logs
    .filter((l) => !l.needsReview && l.workRvu != null)
    .reduce((sum, l) => sum + (l.workRvu ?? 0), 0);
}

// ─── Core calculation ───────────────────────────────────────────────────────

/**
 * Compute all daily pace metrics.
 *
 * @param logs   StudyLog records for today only (caller filters by logDate)
 * @param settings  DailyPaceSettings
 * @param previouslyAchieved  pass true if goal was already achieved last tick
 *                            to suppress repeat confetti
 */
export function computeDailyPace(
  logs: StudyLog[],
  settings: DailyPaceSettings,
  previouslyAchieved: boolean,
): DailyPaceMetrics {
  const {
    dailyRvuGoal,
    workdayStart,
    workdayEnd,
    breakMinutes,
  } = settings;

  const goal = Math.max(1, dailyRvuGoal);
  const startMin = hhmm(workdayStart);
  const endMin = hhmm(workdayEnd);
  const breakMin = Math.max(0, breakMinutes);

  // Available work time
  const rawShift = Math.max(0, endMin - startMin);
  const shiftMinutes = Math.max(1, rawShift - breakMin);

  const now = nowMinutes();
  const currentRvu = sumTodayRvu(logs);
  const remainingToGoal = Math.max(0, goal - currentRvu);
  const percentComplete = (currentRvu / goal) * 100;

  // ── Before shift ───────────────────────────────────────────────────────
  if (now < startMin) {
    return {
      currentRvu,
      dailyGoal: goal,
      percentComplete,
      elapsedWorkMinutes: 0,
      remainingWorkMinutes: shiftMinutes,
      shiftMinutes,
      expectedRvu: 0,
      expectedPercent: 0,
      actualPercent: percentComplete,
      paceDifference: 0,
      projectedEndOfDay: 0,
      remainingToGoal,
      requiredRvuPerHour: goal / (shiftMinutes / 60),
      status: 'before_work',
      goalJustAchieved: false,
    };
  }

  // ── After shift ────────────────────────────────────────────────────────
  if (now >= endMin) {
    const projectedEndOfDay = currentRvu; // shift is done; what you have is what you get
    return {
      currentRvu,
      dailyGoal: goal,
      percentComplete,
      elapsedWorkMinutes: shiftMinutes,
      remainingWorkMinutes: 0,
      shiftMinutes,
      expectedRvu: goal,
      expectedPercent: 100,
      actualPercent: percentComplete,
      paceDifference: currentRvu - goal,
      projectedEndOfDay,
      remainingToGoal,
      requiredRvuPerHour: 0,
      status: currentRvu >= goal ? 'goal_achieved' : 'after_work',
      goalJustAchieved: false,
    };
  }

  // ── During shift ───────────────────────────────────────────────────────
  const elapsedWorkMinutes = Math.min(shiftMinutes, now - startMin);
  const remainingWorkMinutes = Math.max(0, shiftMinutes - elapsedWorkMinutes);

  // Linear expected pace
  const expectedRvu = (elapsedWorkMinutes / shiftMinutes) * goal;
  const expectedPercent = Math.min(100, (expectedRvu / goal) * 100);
  const actualPercent = Math.min(100, percentComplete);

  const paceDifference = currentRvu - expectedRvu;

  // Project linearly to end of shift (avoid division by zero if no elapsed time)
  const projectedEndOfDay =
    elapsedWorkMinutes > 0
      ? (currentRvu / elapsedWorkMinutes) * shiftMinutes
      : 0;

  // Required rate for remainder
  const requiredRvuPerHour =
    remainingWorkMinutes > 0
      ? (remainingToGoal / remainingWorkMinutes) * 60
      : 0;

  // ── Status ─────────────────────────────────────────────────────────────
  let status: PaceStatus;
  if (currentRvu >= goal) {
    status = 'goal_achieved';
  } else {
    const pct = (paceDifference / goal) * 100; // how far ahead/behind as % of goal
    if (pct >= 5) {
      status = 'ahead';
    } else if (pct >= -5) {
      status = 'on_track';
    } else if (pct >= -15) {
      status = 'slightly_behind';
    } else {
      status = 'behind';
    }
  }

  const goalJustAchieved = currentRvu >= goal && !previouslyAchieved;

  return {
    currentRvu,
    dailyGoal: goal,
    percentComplete,
    elapsedWorkMinutes,
    remainingWorkMinutes,
    shiftMinutes,
    expectedRvu,
    expectedPercent,
    actualPercent,
    paceDifference,
    projectedEndOfDay,
    remainingToGoal,
    requiredRvuPerHour,
    status,
    goalJustAchieved,
  };
}

// ─── Display helpers ────────────────────────────────────────────────────────

export interface StatusDisplay {
  emoji: string;
  label: string;
  color: string;         // Tailwind text color
  glowColor: string;     // CSS box-shadow color for gauge ring
  progressStatus: 'ahead' | 'on_track' | 'behind' | 'neutral';
}

export function getStatusDisplay(status: PaceStatus): StatusDisplay {
  switch (status) {
    case 'before_work':
      return {
        emoji: '⏰',
        label: 'Shift Not Started',
        color: 'text-slate-400',
        glowColor: 'rgba(148,163,184,0.4)',
        progressStatus: 'neutral',
      };
    case 'goal_achieved':
      return {
        emoji: '🏆',
        label: 'Goal Achieved',
        color: 'text-amber-400',
        glowColor: 'rgba(251,191,36,0.5)',
        progressStatus: 'ahead',
      };
    case 'ahead':
      return {
        emoji: '🟢',
        label: 'Ahead of Pace',
        color: 'text-emerald-400',
        glowColor: 'rgba(52,211,153,0.45)',
        progressStatus: 'ahead',
      };
    case 'on_track':
      return {
        emoji: '🔵',
        label: 'On Track',
        color: 'text-blue-400',
        glowColor: 'rgba(96,165,250,0.45)',
        progressStatus: 'on_track',
      };
    case 'slightly_behind':
      return {
        emoji: '🟠',
        label: 'Slightly Behind',
        color: 'text-orange-400',
        glowColor: 'rgba(251,146,60,0.45)',
        progressStatus: 'behind',
      };
    case 'behind':
      return {
        emoji: '🔴',
        label: 'Behind Pace',
        color: 'text-red-400',
        glowColor: 'rgba(248,113,113,0.45)',
        progressStatus: 'behind',
      };
    case 'after_work':
      return {
        emoji: '🌙',
        label: 'Shift Complete',
        color: 'text-violet-400',
        glowColor: 'rgba(167,139,250,0.4)',
        progressStatus: 'neutral',
      };
  }
}

export function formatMinutes(minutes: number): string {
  if (minutes <= 0) return '0m';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
