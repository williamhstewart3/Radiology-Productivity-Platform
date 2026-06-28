import type { Modality, StudyLog, UserSettings } from '../types';
import { MODALITIES } from '../types';

/**
 * All productivity math lives here so formulas are auditable in one place.
 * Every function operates on already-loaded StudyLog[] / settings — no DB
 * access — for easy unit testing.
 *
 * IMPORTANT: All calculations use `workRvu`, never total/payment RVU, per
 * the personal-productivity requirement. This is a personal estimate only.
 */

export interface DailyStats {
  date: string;
  totalWorkRvu: number;
  studyCount: number;
  avgRvuPerStudy: number;
  hoursWorked: number | null;
  hourlyRate: number | null;
  byModality: Record<Modality, number>;
}

export interface YtdStats {
  ytdWorkRvu: number;
  ytdStudyCount: number;
  annualGoal: number;
  percentToGoal: number;
  remainingRvu: number;
  daysElapsedInYear: number;
  daysRemainingInYear: number;
  workdaysRemainingEstimate: number;
  requiredRvuPerWorkday: number;
  projectedYearEnd: number;
  dailyAverageYtd: number;
}

function getLocalDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayDateString(): string {
  return getLocalDateString(new Date());
}

function emptyModalityRecord(): Record<Modality, number> {
  const rec = {} as Record<Modality, number>;
  for (const m of MODALITIES) rec[m] = 0;
  return rec;
}

/** Sums work RVUs for a set of logs, ignoring logs that need review. */
export function sumWorkRvu(logs: StudyLog[], includeNeedsReview = false): number {
  return logs
    .filter((l) => includeNeedsReview || !l.needsReview)
    .reduce((sum, l) => sum + (l.workRvu ?? 0), 0);
}

export function computeByModality(
  logs: StudyLog[],
  includeNeedsReview = false,
): Record<Modality, number> {
  const result = emptyModalityRecord();
  for (const log of logs) {
    if (!includeNeedsReview && log.needsReview) continue;
    const modality = log.modality ?? 'OTHER';
    result[modality] = (result[modality] ?? 0) + (log.workRvu ?? 0);
  }
  return result;
}

export function computeDailyStats(
  logsForDay: StudyLog[],
  hoursWorked: number | null,
): DailyStats {
  const countedLogs = logsForDay.filter((l) => !l.needsReview);
  const totalWorkRvu = sumWorkRvu(countedLogs, true); // already filtered above
  const studyCount = countedLogs.length;
  const avgRvuPerStudy = studyCount > 0 ? totalWorkRvu / studyCount : 0;
  const hourlyRate =
    hoursWorked && hoursWorked > 0 ? totalWorkRvu / hoursWorked : null;

  return {
    date: logsForDay[0]?.logDate ?? todayDateString(),
    totalWorkRvu,
    studyCount,
    avgRvuPerStudy,
    hoursWorked,
    hourlyRate,
    byModality: computeByModality(countedLogs, true),
  };
}

/** Computes hours worked for a session from start/end time, or manual override. */
export function computeHoursWorked(
  manualHours: number | null,
  startTime: string | null,
  endTime: string | null,
): number | null {
  if (manualHours !== null && manualHours > 0) return manualHours;
  if (startTime && endTime) {
    const start = new Date(startTime).getTime();
    const end = new Date(endTime).getTime();
    if (end > start) {
      return (end - start) / (1000 * 60 * 60);
    }
  }
  return null;
}

/**
 * Computes year-to-date stats and the projected year-end pace.
 *
 * Projection method: YTD wRVU / fraction of year elapsed * full year.
 * This is a simple run-rate projection, not a workday-weighted model —
 * it's intentionally easy to reason about and audit. A more
 * workday-aware variant (using workdaysPerWeek + vacationDaysPlanned)
 * is used separately for the "required pace" figure below.
 */
export function computeYtdStats(
  allLogsThisYear: StudyLog[],
  settings: UserSettings,
  asOfDate: Date = new Date(),
): YtdStats {
  const countedLogs = allLogsThisYear.filter((l) => !l.needsReview);
  const ytdWorkRvu = sumWorkRvu(countedLogs, true);
  const ytdStudyCount = countedLogs.length;

  const fiscalYearStart = new Date(asOfDate.getFullYear(), settings.fiscalYearStartMonth - 1, 1);
  const yearEnd = new Date(fiscalYearStart);
  yearEnd.setFullYear(yearEnd.getFullYear() + 1);
  yearEnd.setDate(yearEnd.getDate() - 1);

  const msPerDay = 1000 * 60 * 60 * 24;
  const totalDaysInYear = Math.max(
    1,
    Math.round((yearEnd.getTime() - fiscalYearStart.getTime()) / msPerDay) + 1,
  );
  const daysElapsedInYear = Math.max(
    1,
    Math.min(
      totalDaysInYear,
      Math.round((asOfDate.getTime() - fiscalYearStart.getTime()) / msPerDay) + 1,
    ),
  );
  const daysRemainingInYear = Math.max(0, totalDaysInYear - daysElapsedInYear);

  const annualGoal = settings.annualRvuGoal;
  const percentToGoal = annualGoal > 0 ? (ytdWorkRvu / annualGoal) * 100 : 0;
  const remainingRvu = Math.max(0, annualGoal - ytdWorkRvu);

  // Estimate remaining workdays using workdaysPerWeek ratio, minus planned vacation.
  const workdayFraction = settings.workdaysPerWeek / 7;
  const workdaysRemainingEstimate = Math.max(
    0,
    Math.round(daysRemainingInYear * workdayFraction) - settings.vacationDaysPlanned,
  );

  const requiredRvuPerWorkday =
    workdaysRemainingEstimate > 0 ? remainingRvu / workdaysRemainingEstimate : 0;

  const yearFractionElapsed = daysElapsedInYear / totalDaysInYear;
  const projectedYearEnd =
    yearFractionElapsed > 0 ? ytdWorkRvu / yearFractionElapsed : 0;

  const dailyAverageYtd = daysElapsedInYear > 0 ? ytdWorkRvu / daysElapsedInYear : 0;

  return {
    ytdWorkRvu,
    ytdStudyCount,
    annualGoal,
    percentToGoal,
    remainingRvu,
    daysElapsedInYear,
    daysRemainingInYear,
    workdaysRemainingEstimate,
    requiredRvuPerWorkday,
    projectedYearEnd,
    dailyAverageYtd,
  };
}

/** Average work RVUs/day over an arbitrary date range (e.g. trailing 30 days). */
export function computeRangeDailyAverage(
  logsInRange: StudyLog[],
  numberOfDaysInRange: number,
): number {
  if (numberOfDaysInRange <= 0) return 0;
  const total = sumWorkRvu(logsInRange.filter((l) => !l.needsReview), true);
  return total / numberOfDaysInRange;
}

export interface PeriodTotals {
  totalWorkRvu: number;
  studyCount: number;
  avgRvuPerStudy: number;
  byModality: Record<Modality, number>;
}

export function computePeriodTotals(logs: StudyLog[]): PeriodTotals {
  const countedLogs = logs.filter((l) => !l.needsReview);
  const totalWorkRvu = sumWorkRvu(countedLogs, true);
  const studyCount = countedLogs.length;
  return {
    totalWorkRvu,
    studyCount,
    avgRvuPerStudy: studyCount > 0 ? totalWorkRvu / studyCount : 0,
    byModality: computeByModality(countedLogs, true),
  };
}

/** Groups logs by their logDate, useful for weekly/monthly trend charts. */
export function groupLogsByDate(logs: StudyLog[]): Map<string, StudyLog[]> {
  const map = new Map<string, StudyLog[]>();
  for (const log of logs) {
    const arr = map.get(log.logDate) ?? [];
    arr.push(log);
    map.set(log.logDate, arr);
  }
  return map;
}
