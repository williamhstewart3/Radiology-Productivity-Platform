import { describe, expect, test } from 'bun:test';
import {
  computeDailyPace,
  currentRatePerHour,
  DEFAULT_DAILY_PACE_SETTINGS,
  projectedFinishClockTime,
  type DailyPaceMetrics,
} from '../src/web/utils/dailyPaceCalculations';
import type { StudyLog } from '../src/web/types';

function metrics(overrides: Partial<DailyPaceMetrics>): DailyPaceMetrics {
  return {
    currentRvu: 0,
    dailyGoal: 90,
    percentComplete: 0,
    elapsedWorkMinutes: 0,
    remainingWorkMinutes: 0,
    shiftMinutes: 480,
    expectedRvu: 0,
    expectedPercent: 0,
    actualPercent: 0,
    paceDifference: 0,
    timeAheadBehindMinutes: 0,
    projectedEndOfDay: 0,
    remainingToGoal: 90,
    requiredRvuPerHour: 0,
    status: 'on_track',
    goalJustAchieved: false,
    ...overrides,
  };
}

function log(id: string, rvu: number, needsReview = false): StudyLog {
  return { id, logDate: '2026-07-13', workRvu: rvu, needsReview } as StudyLog;
}

describe('currentRatePerHour', () => {
  test('is null before any work minutes have elapsed', () => {
    expect(currentRatePerHour(metrics({ elapsedWorkMinutes: 0, currentRvu: 5 }))).toBeNull();
  });

  test('is the rolling rate from currentRvu / elapsedWorkMinutes, in wRVU/hour', () => {
    // 30 wRVU in 240 minutes (4 hours) => 7.5/hr
    expect(currentRatePerHour(metrics({ elapsedWorkMinutes: 240, currentRvu: 30 }))).toBe(7.5);
  });
});

describe('projectedFinishClockTime', () => {
  test('is null before the shift starts', () => {
    expect(projectedFinishClockTime(metrics({ status: 'before_work' }))).toBeNull();
  });

  test('is null after the shift ends', () => {
    expect(projectedFinishClockTime(metrics({ status: 'after_work' }))).toBeNull();
  });

  test('reports "Goal hit" once the goal is achieved', () => {
    expect(projectedFinishClockTime(metrics({ status: 'goal_achieved' }))).toBe('Goal hit');
  });

  test('is null when there is no elapsed time to derive a rate from', () => {
    expect(projectedFinishClockTime(metrics({ status: 'on_track', elapsedWorkMinutes: 0 }))).toBeNull();
  });

  test('projects a clock time from the current rolling rate', () => {
    // 30 wRVU in 120 minutes => 15/hr rolling rate. 30 remaining wRVU => 120 more minutes.
    const now = new Date('2026-07-13T14:00:00');
    const result = projectedFinishClockTime(
      metrics({ status: 'on_track', currentRvu: 30, elapsedWorkMinutes: 120, remainingToGoal: 30 }),
      now,
    );
    // 120 minutes after 2:00pm is 4:00pm.
    expect(result).toBe('4:00p');
  });
});

describe('computeDailyPace — the six restored cluster figures reconcile with its own outputs', () => {
  const settings = { ...DEFAULT_DAILY_PACE_SETTINGS, workdayStart: '08:00', workdayEnd: '17:00', dailyRvuGoal: 90 };

  test('before the shift starts, every cluster figure is a safe zero/default, not garbage', () => {
    // A workday far in the future relative to "now" is unreachable to simulate
    // deterministically without mocking Date, so instead assert the shape of
    // the before_work branch directly via a goal larger than any logs.
    const m = computeDailyPace([], { ...settings, workdayStart: '23:58', workdayEnd: '23:59' }, false);
    expect(m.status).toBe('before_work');
    expect(m.expectedRvu).toBe(0);
    expect(m.paceDifference).toBe(0);
    expect(m.requiredRvuPerHour).toBeGreaterThan(0);
  });

  test('after the shift ends, remaining/required reflect what is actually left', () => {
    const m = computeDailyPace([log('a', 40)], { ...settings, workdayStart: '00:00', workdayEnd: '00:01' }, false);
    expect(m.status).toBe('after_work');
    expect(m.remainingToGoal).toBe(50);
    expect(m.requiredRvuPerHour).toBe(0);
    expect(m.projectedEndOfDay).toBe(40);
  });

  test('goal achieved zeroes remaining and required rate', () => {
    const m = computeDailyPace([log('a', 95)], { ...settings, workdayStart: '00:00', workdayEnd: '23:59' }, false);
    expect(m.status).toBe('goal_achieved');
    expect(m.remainingToGoal).toBe(0);
  });

  test('needsReview logs are excluded from currentRvu, so the cluster never counts unreviewed rows', () => {
    const m = computeDailyPace(
      [log('a', 10), log('b', 999, true)],
      { ...settings, workdayStart: '00:00', workdayEnd: '00:01' },
      false,
    );
    expect(m.currentRvu).toBe(10);
  });
});
