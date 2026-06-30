import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import { useOrg } from '../hooks/useOrg';
import { todayDateString } from '../utils/calculations';
import {
  computeCaseMixSummary,
  computeGroupAverages,
  filterLogsByDateRange,
  groupLogsByProfile,
  type CaseMixDistributionRow,
} from '../utils/caseMixAnalytics';
import { MODALITY_LABELS } from '../types';
import type { StudyLog, UserSettings } from '../types';

function fmt(value: number, digits = 1): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function dateDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/4 px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-bold text-white">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

function DistributionTable({
  title,
  rows,
}: {
  title: string;
  rows: CaseMixDistributionRow[];
}) {
  return (
    <div className="card space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-white">{title}</h2>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500">No data in this range</p>
      ) : (
        <div className="space-y-2">
          {rows.slice(0, 8).map((row) => (
            <div key={row.key} className="rounded-xl border border-white/8 bg-white/3 px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-sm font-medium text-slate-200">{row.label}</span>
                <span className="shrink-0 text-xs text-slate-400">{row.studies} studies</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/8">
                <div
                  className="h-full rounded-full bg-sky-400/80"
                  style={{ width: `${Math.min(100, row.percent)}%` }}
                />
              </div>
              <div className="mt-1 flex justify-between text-[11px] text-slate-500">
                <span>{fmt(row.percent, 1)}%</span>
                <span>{fmt(row.workRvu, 1)} wRVU</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function CaseMixAnalytics() {
  const { activeProfile, radiologists } = useOrg();
  const [startDate, setStartDate] = useState(dateDaysAgo(29));
  const [endDate, setEndDate] = useState(todayDateString());
  const [selectedProfileId, setSelectedProfileId] = useState<string>('all');

  const settings = useLiveQuery<UserSettings | undefined>(
    () => db.userSettings.get('default'),
    [],
  );
  const studyLogs = useLiveQuery<StudyLog[]>(
    () => db.studyLogs.orderBy('logDate').toArray(),
    [],
  ) ?? [];

  const isAdmin = activeProfile?.isAdmin === true;
  const lowComplexityThreshold = settings?.lowComplexityThreshold ?? 0.75;

  const summaries = useMemo(() => {
    const inRange = filterLogsByDateRange(studyLogs, startDate, endDate);
    const logsByProfile = groupLogsByProfile(inRange);
    return radiologists.map((profile) =>
      computeCaseMixSummary(logsByProfile.get(profile.id) ?? [], profile, lowComplexityThreshold),
    );
  }, [studyLogs, startDate, endDate, radiologists, lowComplexityThreshold]);

  const groupAverages = useMemo(() => computeGroupAverages(summaries), [summaries]);
  const selectedSummary = selectedProfileId === 'all'
    ? computeCaseMixSummary(filterLogsByDateRange(studyLogs, startDate, endDate), null, lowComplexityThreshold)
    : summaries.find((summary) => summary.profileId === selectedProfileId) ?? null;

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        <div className="card space-y-3">
          <h1 className="text-xl font-bold text-white">Case Mix Analytics</h1>
          <p className="text-sm text-slate-400">
            This module is available to authorized admin profiles.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-in fade-in duration-300">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Case Mix Analytics</h1>
          <p className="mt-0.5 text-sm text-slate-400">
            Neutral case mix measures for transparent group comparison.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs text-slate-500">Radiologist</label>
            <select
              value={selectedProfileId}
              onChange={(event) => setSelectedProfileId(event.target.value)}
              className="input w-full"
            >
              <option value="all">All radiologists</option>
              {radiologists.map((profile) => (
                <option key={profile.id} value={profile.id}>{profile.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500">Start</label>
            <input
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              className="input w-full"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500">End</label>
            <input
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              className="input w-full"
            />
          </div>
        </div>
      </div>

      {selectedSummary && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            <MetricCard label="Total studies" value={selectedSummary.totalStudies.toLocaleString()} />
            <MetricCard label="Total wRVU" value={fmt(selectedSummary.totalWorkRvu, 1)} />
            <MetricCard label="Avg wRVU/study" value={fmt(selectedSummary.averageWorkRvuPerStudy, 2)} />
            <MetricCard label="Median wRVU/study" value={fmt(selectedSummary.medianWorkRvuPerStudy, 2)} />
            <MetricCard
              label="Low-complexity percentage"
              value={`${fmt(selectedSummary.lowComplexityPercentage, 1)}%`}
              sub={`Threshold <= ${fmt(lowComplexityThreshold, 2)} wRVU`}
            />
            <MetricCard label="Case mix index" value={fmt(selectedSummary.caseMixIndex, 2)} />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="card space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-white">Group Averages</h2>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between gap-3">
                  <span className="text-slate-400">Avg wRVU/study</span>
                  <span className="font-semibold text-white">{fmt(groupAverages.averageWorkRvuPerStudy, 2)}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-slate-400">Median wRVU/study</span>
                  <span className="font-semibold text-white">{fmt(groupAverages.medianWorkRvuPerStudy, 2)}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-slate-400">Low-complexity percentage</span>
                  <span className="font-semibold text-white">{fmt(groupAverages.lowComplexityPercentage, 1)}%</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-slate-400">Case mix index</span>
                  <span className="font-semibold text-white">{fmt(groupAverages.caseMixIndex, 2)}</span>
                </div>
              </div>
            </div>
            <DistributionTable
              title="Modality Distribution"
              rows={selectedSummary.modalityDistribution.map((row) => ({
                ...row,
                label: MODALITY_LABELS[row.label as keyof typeof MODALITY_LABELS] ?? row.label,
              }))}
            />
            <DistributionTable title="CPT Distribution" rows={selectedSummary.cptDistribution} />
          </div>

          <div className="card overflow-hidden p-0">
            <div className="border-b border-white/8 px-4 py-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-white">Radiologist Comparison</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[780px] text-sm">
                <thead className="bg-white/4 text-xs uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-3 text-left">Radiologist</th>
                    <th className="px-4 py-3 text-right">Studies</th>
                    <th className="px-4 py-3 text-right">wRVU</th>
                    <th className="px-4 py-3 text-right">Avg</th>
                    <th className="px-4 py-3 text-right">Median</th>
                    <th className="px-4 py-3 text-right">Low-complexity %</th>
                    <th className="px-4 py-3 text-right">Case mix index</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/6">
                  {summaries.map((summary) => (
                    <tr key={summary.profileId ?? 'unassigned'} className="text-slate-300">
                      <td className="px-4 py-3 font-medium text-white">{summary.radiologistName}</td>
                      <td className="px-4 py-3 text-right">{summary.totalStudies.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right">{fmt(summary.totalWorkRvu, 1)}</td>
                      <td className="px-4 py-3 text-right">{fmt(summary.averageWorkRvuPerStudy, 2)}</td>
                      <td className="px-4 py-3 text-right">{fmt(summary.medianWorkRvuPerStudy, 2)}</td>
                      <td className="px-4 py-3 text-right">{fmt(summary.lowComplexityPercentage, 1)}%</td>
                      <td className="px-4 py-3 text-right">{fmt(summary.caseMixIndex, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
