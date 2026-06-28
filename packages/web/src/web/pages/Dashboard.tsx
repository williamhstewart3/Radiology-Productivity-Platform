import { useLiveQuery } from 'dexie-react-hooks';
import { useState, useEffect } from 'react';
import { db } from '../db/database';
import { useProfile } from '../hooks/useProfile';
import { computeYtdStats, computeDailyStats, todayDateString, groupLogsByDate } from '../utils/calculations';
import { ProgressBar } from '../components/ProgressBar';
import { StatusBadge } from '../components/StatusBadge';
import { ConfettiCanvas } from '../components/ConfettiCanvas';
import type { UserSettings, StudyLog, Modality } from '../types';
import { MODALITY_LABELS } from '../types';

const MODALITY_COLORS: Record<Modality, string> = {
  CT: '#6366f1',
  MRI: '#8b5cf6',
  US: '#06b6d4',
  XR: '#3b82f6',
  NM_PET: '#f59e0b',
  MAMMO: '#ec4899',
  FLUORO: '#10b981',
  PROCEDURE: '#ef4444',
  OTHER: '#64748b',
};

function fmt(n: number, decimals = 1) {
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtInt(n: number) {
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

interface DashboardProps {
  onNavigate: (tab: 'log' | 'import' | 'history' | 'settings') => void;
}

export function Dashboard({ onNavigate }: DashboardProps) {
  const [showConfetti, setShowConfetti] = useState(false);
  const [prevPercent, setPrevPercent] = useState<number | null>(null);

  const today = todayDateString();
  const { activeProfile } = useProfile();
  const profileId = activeProfile?.id ?? null;

  const settings = useLiveQuery<UserSettings | undefined>(
    () => db.userSettings.get('default'),
    []
  );

  const allLogs = useLiveQuery<StudyLog[]>(
    async () => {
      if (!profileId) return [];
      const all = await db.studyLogs.orderBy('logDate').toArray();
      return all.filter((l) => l.profileId === profileId || l.profileId == null);
    },
    [profileId]
  );

  const todayLogs = useLiveQuery<StudyLog[]>(
    async () => {
      if (!profileId) return [];
      const all = await db.studyLogs.where('logDate').equals(today).toArray();
      return all.filter((l) => l.profileId === profileId || l.profileId == null);
    },
    [today, profileId]
  );

  const reviewCount = useLiveQuery<number>(
    async () => {
      if (!profileId) return 0;
      const all = await db.studyLogs.where('needsReview').equals(1 as any).toArray();
      return all.filter((l) => l.profileId === profileId || l.profileId == null).length;
    },
    [profileId]
  );

  const ytdStats = (() => {
    if (!allLogs || !settings) return null;
    // Merge: profile goal/fiscal settings override global userSettings
    const effectiveSettings = {
      ...settings,
      annualRvuGoal: activeProfile?.annualRvuGoal ?? settings.annualRvuGoal,
      fiscalYearStartMonth: activeProfile?.fiscalYearStartMonth ?? settings.fiscalYearStartMonth,
    };
    const year = new Date().getFullYear();
    const fiscalStart = new Date(year, (effectiveSettings.fiscalYearStartMonth ?? 1) - 1, 1);
    const logsThisYear = allLogs.filter(
      (l) => l.logDate >= fiscalStart.toISOString().slice(0, 10)
    );
    return computeYtdStats(logsThisYear, effectiveSettings);
  })();

  const todayStats = (() => {
    if (!todayLogs) return null;
    return computeDailyStats(todayLogs, null);
  })();

  // Confetti on milestone crossings
  useEffect(() => {
    if (!ytdStats) return;
    const pct = ytdStats.percentToGoal;
    const milestones = [25, 50, 75, 100];
    for (const m of milestones) {
      if (prevPercent !== null && prevPercent < m && pct >= m) {
        setShowConfetti(true);
        setTimeout(() => setShowConfetti(false), 4000);
        break;
      }
    }
    setPrevPercent(pct);
  }, [ytdStats?.percentToGoal]);

  const paceStatus = (() => {
    if (!ytdStats) return 'neutral' as const;
    const ratio = ytdStats.ytdWorkRvu / Math.max(1, ytdStats.dailyAverageYtd * ytdStats.daysElapsedInYear);
    if (ytdStats.percentToGoal >= 100) return 'ahead' as const;
    const expectedPct = (ytdStats.daysElapsedInYear / (ytdStats.daysElapsedInYear + ytdStats.daysRemainingInYear)) * 100;
    if (ytdStats.percentToGoal >= expectedPct * 0.97) return 'on_track' as const;
    if (ytdStats.percentToGoal >= expectedPct * 0.9) return 'on_track' as const;
    return 'behind' as const;
  })();

  // Modality breakdown for today
  const modalityData = (() => {
    if (!todayStats) return [];
    return Object.entries(todayStats.byModality)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => ({ modality: k as Modality, rvu: v }))
      .sort((a, b) => b.rvu - a.rvu);
  })();

  // Weekly trend (last 7 days)
  const weeklyData = (() => {
    if (!allLogs) return [];
    const days: { date: string; rvu: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const logsForDay = allLogs.filter((l) => l.logDate === dateStr && !l.needsReview);
      const rvu = logsForDay.reduce((s, l) => s + (l.workRvu ?? 0), 0);
      days.push({ date: dateStr, rvu });
    }
    return days;
  })();

  const weekMax = Math.max(...weeklyData.map((d) => d.rvu), 1);

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <ConfettiCanvas active={showConfetti} />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Dashboard</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {(reviewCount ?? 0) > 0 && (
            <button
              onClick={() => onNavigate('history')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-400 text-sm font-medium hover:bg-amber-500/25 transition-colors"
            >
              ⚠️ {reviewCount} need review
            </button>
          )}
          <button
            onClick={() => onNavigate('log')}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 text-white text-sm font-semibold hover:opacity-90 transition-opacity shadow-lg shadow-indigo-500/25"
          >
            + Log Study
          </button>
        </div>
      </div>

      {/* Top metric cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Today */}
        <div className="card col-span-1">
          <p className="text-xs text-slate-400 font-medium uppercase tracking-wider">Today</p>
          <p className="text-3xl font-bold text-white mt-1">
            {fmt(todayStats?.totalWorkRvu ?? 0)}
          </p>
          <p className="text-slate-400 text-xs mt-1">
            {todayStats?.studyCount ?? 0} studies · avg {fmt(todayStats?.avgRvuPerStudy ?? 0)} wRVU
          </p>
        </div>

        {/* YTD wRVU */}
        <div className="card col-span-1">
          <p className="text-xs text-slate-400 font-medium uppercase tracking-wider">YTD wRVU</p>
          <p className="text-3xl font-bold text-white mt-1">
            {fmtInt(ytdStats?.ytdWorkRvu ?? 0)}
          </p>
          <p className="text-slate-400 text-xs mt-1">
            of {fmtInt(ytdStats?.annualGoal ?? 0)} goal
          </p>
        </div>

        {/* % to Goal */}
        <div className="card col-span-1">
          <p className="text-xs text-slate-400 font-medium uppercase tracking-wider">% to Goal</p>
          <p className="text-3xl font-bold text-white mt-1">
            {fmt(ytdStats?.percentToGoal ?? 0, 1)}%
          </p>
          <p className="text-slate-400 text-xs mt-1">
            {fmtInt(ytdStats?.remainingRvu ?? 0)} remaining
          </p>
        </div>

        {/* Req pace */}
        <div className="card col-span-1">
          <p className="text-xs text-slate-400 font-medium uppercase tracking-wider">Req. Pace</p>
          <p className="text-3xl font-bold text-white mt-1">
            {fmt(ytdStats?.requiredRvuPerWorkday ?? 0)}
          </p>
          <p className="text-slate-400 text-xs mt-1">wRVU/workday needed</p>
        </div>
      </div>

      {/* YTD Progress bar */}
      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-white">Annual Goal Progress</p>
            <p className="text-xs text-slate-400 mt-0.5">
              {fmtInt(ytdStats?.daysElapsedInYear ?? 0)} days elapsed · 
              {fmtInt(ytdStats?.daysRemainingInYear ?? 0)} remaining
            </p>
          </div>
          <StatusBadge status={paceStatus} />
        </div>

        <div className="space-y-2">
          {/* Actual progress */}
          <ProgressBar
            value={ytdStats?.percentToGoal ?? 0}
            status={paceStatus}
            height="lg"
            animated
          />
          {/* Expected progress line marker */}
          <div className="flex justify-between text-xs text-slate-500">
            <span>0</span>
            <span className="text-white font-medium">
              {fmt(ytdStats?.ytdWorkRvu ?? 0, 0)} / {fmtInt(ytdStats?.annualGoal ?? 0)} wRVU
            </span>
            <span>Goal</span>
          </div>
        </div>

        {/* Projection */}
        <div className="pt-2 border-t border-white/5 flex gap-6">
          <div>
            <p className="text-xs text-slate-400">Projected Year-End</p>
            <p className={`text-lg font-bold mt-0.5 ${
              (ytdStats?.projectedYearEnd ?? 0) >= (ytdStats?.annualGoal ?? 0)
                ? 'text-emerald-400'
                : 'text-red-400'
            }`}>
              {fmtInt(ytdStats?.projectedYearEnd ?? 0)}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Daily Avg (YTD)</p>
            <p className="text-lg font-bold text-white mt-0.5">
              {fmt(ytdStats?.dailyAverageYtd ?? 0)}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Workdays Left</p>
            <p className="text-lg font-bold text-white mt-0.5">
              {fmtInt(ytdStats?.workdaysRemainingEstimate ?? 0)}
            </p>
          </div>
        </div>
      </div>

      {/* Lower section: today breakdown + weekly trend */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Today's modality breakdown */}
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-white">Today by Modality</p>
            <button
              onClick={() => onNavigate('log')}
              className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
            >
              + Add
            </button>
          </div>

          {modalityData.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-slate-500 text-sm">No studies logged today</p>
              <button
                onClick={() => onNavigate('log')}
                className="mt-3 px-4 py-2 rounded-lg bg-indigo-500/15 border border-indigo-500/30 text-indigo-400 text-sm hover:bg-indigo-500/25 transition-colors"
              >
                Log your first study
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {modalityData.map(({ modality, rvu }) => {
                const pct = (rvu / (todayStats?.totalWorkRvu ?? 1)) * 100;
                return (
                  <div key={modality} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-300">{MODALITY_LABELS[modality]}</span>
                      <span className="text-white font-medium">{fmt(rvu)} wRVU</span>
                    </div>
                    <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${pct}%`, backgroundColor: MODALITY_COLORS[modality] }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Weekly trend */}
        <div className="card space-y-3">
          <p className="text-sm font-semibold text-white">7-Day Trend</p>
          <div className="flex items-end gap-2 h-24">
            {weeklyData.map(({ date, rvu }) => {
              const pct = (rvu / weekMax) * 100;
              const isToday = date === today;
              return (
                <div key={date} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full flex items-end justify-center" style={{ height: '80px' }}>
                    <div
                      className={`w-full rounded-t transition-all duration-500 ${
                        isToday
                          ? 'bg-gradient-to-t from-indigo-500 to-violet-400'
                          : rvu > 0
                          ? 'bg-white/20'
                          : 'bg-white/5'
                      }`}
                      style={{ height: `${Math.max(pct, rvu > 0 ? 8 : 0)}%` }}
                    />
                  </div>
                  <span className={`text-[9px] ${isToday ? 'text-indigo-400 font-bold' : 'text-slate-500'}`}>
                    {new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' })}
                  </span>
                  {rvu > 0 && (
                    <span className="text-[9px] text-slate-400">{fmt(rvu, 0)}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Log Study', icon: '✏️', tab: 'log' as const, color: 'indigo' },
          { label: 'Bulk Import', icon: '📥', tab: 'import' as const, color: 'violet' },
          { label: 'History', icon: '📋', tab: 'history' as const, color: 'blue' },
          { label: 'Settings', icon: '⚙️', tab: 'settings' as const, color: 'slate' },
        ].map(({ label, icon, tab }) => (
          <button
            key={tab}
            onClick={() => onNavigate(tab)}
            className="card flex items-center gap-3 hover:bg-white/8 transition-colors group cursor-pointer"
          >
            <span className="text-xl">{icon}</span>
            <span className="text-sm text-slate-300 group-hover:text-white transition-colors font-medium">
              {label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
