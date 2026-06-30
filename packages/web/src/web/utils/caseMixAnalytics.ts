import type { Modality, RadiologistProfile, StudyLog } from '../types';

export interface CaseMixDistributionRow {
  key: string;
  label: string;
  studies: number;
  percent: number;
  workRvu: number;
}

export interface CaseMixSummary {
  profileId: string | null;
  radiologistName: string;
  totalStudies: number;
  totalWorkRvu: number;
  averageWorkRvuPerStudy: number;
  medianWorkRvuPerStudy: number;
  lowComplexityStudies: number;
  lowComplexityPercentage: number;
  caseMixIndex: number;
  modalityDistribution: CaseMixDistributionRow[];
  cptDistribution: CaseMixDistributionRow[];
}

export interface GroupCaseMixAverages {
  totalStudies: number;
  totalWorkRvu: number;
  averageWorkRvuPerStudy: number;
  medianWorkRvuPerStudy: number;
  lowComplexityPercentage: number;
  caseMixIndex: number;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function distribution(
  logs: StudyLog[],
  getKey: (log: StudyLog) => string,
  getLabel: (log: StudyLog) => string,
): CaseMixDistributionRow[] {
  const total = logs.length;
  const rows = new Map<string, { label: string; studies: number; workRvu: number }>();

  for (const log of logs) {
    const key = getKey(log);
    const current = rows.get(key) ?? { label: getLabel(log), studies: 0, workRvu: 0 };
    current.studies += 1;
    current.workRvu += log.workRvu ?? 0;
    rows.set(key, current);
  }

  return Array.from(rows, ([key, row]) => ({
    key,
    label: row.label,
    studies: row.studies,
    percent: total > 0 ? round((row.studies / total) * 100, 1) : 0,
    workRvu: round(row.workRvu, 2),
  })).sort((a, b) => b.studies - a.studies || b.workRvu - a.workRvu);
}

export function filterLogsByDateRange(logs: StudyLog[], startDate: string, endDate: string): StudyLog[] {
  return logs.filter((log) => log.logDate >= startDate && log.logDate <= endDate);
}

export function computeCaseMixSummary(
  logs: StudyLog[],
  profile: RadiologistProfile | null,
  lowComplexityThreshold: number,
): CaseMixSummary {
  const billable = logs.filter((log) => !log.needsReview && log.workRvu != null);
  const values = billable.map((log) => log.workRvu ?? 0);
  const totalWorkRvu = values.reduce((sum, value) => sum + value, 0);
  const totalStudies = billable.length;
  const average = totalStudies > 0 ? totalWorkRvu / totalStudies : 0;
  const med = median(values);
  const lowComplexityStudies = billable.filter((log) => (log.workRvu ?? 0) <= lowComplexityThreshold).length;

  return {
    profileId: profile?.id ?? null,
    radiologistName: profile?.name ?? 'Unassigned',
    totalStudies,
    totalWorkRvu: round(totalWorkRvu, 2),
    averageWorkRvuPerStudy: round(average, 2),
    medianWorkRvuPerStudy: round(med, 2),
    lowComplexityStudies,
    lowComplexityPercentage: totalStudies > 0 ? round((lowComplexityStudies / totalStudies) * 100, 1) : 0,
    caseMixIndex: round(average, 2),
    modalityDistribution: distribution(
      billable,
      (log) => log.modality ?? 'OTHER',
      (log) => log.modality ?? 'Other',
    ),
    cptDistribution: distribution(
      billable,
      (log) => `${log.cptCode ?? 'unmatched'}:${log.modifier ?? 'none'}`,
      (log) => `${log.cptCode ?? 'Unmatched'}${log.modifier ? `-${log.modifier}` : ''}`,
    ),
  };
}

export function computeGroupAverages(summaries: CaseMixSummary[]): GroupCaseMixAverages {
  if (summaries.length === 0) {
    return {
      totalStudies: 0,
      totalWorkRvu: 0,
      averageWorkRvuPerStudy: 0,
      medianWorkRvuPerStudy: 0,
      lowComplexityPercentage: 0,
      caseMixIndex: 0,
    };
  }

  const totalStudies = summaries.reduce((sum, row) => sum + row.totalStudies, 0);
  const totalWorkRvu = summaries.reduce((sum, row) => sum + row.totalWorkRvu, 0);
  return {
    totalStudies,
    totalWorkRvu: round(totalWorkRvu, 2),
    averageWorkRvuPerStudy: totalStudies > 0 ? round(totalWorkRvu / totalStudies, 2) : 0,
    medianWorkRvuPerStudy: round(
      summaries.reduce((sum, row) => sum + row.medianWorkRvuPerStudy, 0) / summaries.length,
      2,
    ),
    lowComplexityPercentage: round(
      summaries.reduce((sum, row) => sum + row.lowComplexityPercentage, 0) / summaries.length,
      1,
    ),
    caseMixIndex: totalStudies > 0 ? round(totalWorkRvu / totalStudies, 2) : 0,
  };
}

export function groupLogsByProfile(logs: StudyLog[]): Map<string | null, StudyLog[]> {
  const map = new Map<string | null, StudyLog[]>();
  for (const log of logs) {
    const key = log.profileId ?? null;
    const current = map.get(key) ?? [];
    current.push(log);
    map.set(key, current);
  }
  return map;
}
