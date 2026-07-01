import { useLiveQuery } from 'dexie-react-hooks';
import { useState, useEffect, useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { db } from '../db/database';
import { useOrg } from '../hooks/useOrg';
import { computeYtdStats, computeDailyStats, todayDateString } from '../utils/calculations';
import { ProgressBar } from '../components/ProgressBar';
import { StatusBadge } from '../components/StatusBadge';
import { ConfettiCanvas } from '../components/ConfettiCanvas';
import { ProfileAvatar } from '../components/OrgSwitcher';
import { theme } from '../lib/theme';
import type { UserSettings, StudyLog, Modality, RadiologistProfile, ActiveReviewSession } from '../types';
import { MODALITY_LABELS } from '../types';

// ─── Constants ─────────────────────────────────────────────────────────────────

const MODALITY_COLORS: Record<Modality, string> = {
  CT: '#6366f1', MRI: '#8b5cf6', US: '#06b6d4', XR: '#3b82f6',
  NM_PET: '#f59e0b', MAMMO: '#ec4899', FLUORO: '#10b981',
  PROCEDURE: '#ef4444', OTHER: '#64748b',
};

type DashMode = 'my' | 'practice' | 'org';

function fmt(n: number, decimals = 1) {
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function fmtInt(n: number) {
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

// ─── Mode pill toggle ──────────────────────────────────────────────────────────

interface ModePillsProps {
  mode: DashMode;
  onChange: (m: DashMode) => void;
  practiceLabel: string;
  orgLabel: string;
}

function ModePills({ mode, onChange, practiceLabel, orgLabel }: ModePillsProps) {
  const pills: { id: DashMode; label: string; icon: string }[] = [
    { id: 'my',       label: 'My Production',   icon: '👤' },
    { id: 'practice', label: practiceLabel,      icon: '🏥' },
    { id: 'org',      label: orgLabel,           icon: '📍' },
  ];
  return (
    <div className="flex items-center gap-1 p-1 rounded-xl bg-white/5 border border-white/8">
      {pills.map((p) => (
        <button
          key={p.id}
          onClick={() => onChange(p.id)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 ${
            mode === p.id
              ? 'border'
              : 'text-slate-400 hover:text-white hover:bg-white/5 border border-transparent'
          }`}
          style={mode === p.id ? {
            background: 'rgba(91,184,212,0.18)',
            borderColor: 'rgba(91,184,212,0.35)',
            color: theme.colors.accent,
          } : {}}
        >
          <span>{p.icon}</span>
          <span className="hidden sm:inline">{p.label}</span>
        </button>
      ))}
    </div>
  );
}

// ─── Radiologist mini-card (for practice/org view) ────────────────────────────

interface RadCardProps {
  profile: RadiologistProfile;
  logs: StudyLog[];
  settings: UserSettings;
  isActive: boolean;
}

function RadCard({ profile, logs, settings, isActive }: RadCardProps) {
  const effectiveSettings = {
    ...settings,
    annualRvuGoal: profile.annualRvuGoal,
    fiscalYearStartMonth: profile.fiscalYearStartMonth,
  };
  const year = new Date().getFullYear();
  const fiscalStart = new Date(year, profile.fiscalYearStartMonth - 1, 1);
  const ytdLogs = logs.filter((l) => l.logDate >= fiscalStart.toISOString().slice(0, 10));
  const stats = computeYtdStats(ytdLogs, effectiveSettings);

  return (
    <div
      className="flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all"
      style={isActive ? {
        background: 'rgba(37,99,168,0.12)',
        borderColor: 'rgba(37,99,168,0.28)',
      } : {
        background: 'rgba(255,255,255,0.03)',
        borderColor: 'rgba(255,255,255,0.08)',
      }}
    >
      <ProfileAvatar initials={profile.initials} color={profile.color} size="sm" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium text-white truncate">{profile.name}</p>
          {isActive && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium shrink-0" style={{ background: 'rgba(91,184,212,0.2)', color: theme.colors.accent }}>YOU</span>
          )}
        </div>
        <div className="mt-0.5">
          <ProgressBar value={stats.percentToGoal} status="neutral" height="sm" />
        </div>
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-bold text-white">{fmtInt(stats.ytdWorkRvu)}</p>
        <p className="text-[10px] text-slate-500">{fmt(stats.percentToGoal, 0)}%</p>
      </div>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

interface DashboardProps {
  onNavigate: (tab: 'log' | 'import' | 'history' | 'settings' | 'camera' | 'explorer') => void;
}

export function Dashboard({ onNavigate }: DashboardProps) {
  const [mode, setMode] = useState<DashMode>('my');
  const [showConfetti, setShowConfetti] = useState(false);
  const [prevPercent, setPrevPercent] = useState<number | null>(null);
  const [showImportMethods, setShowImportMethods] = useState(false);

  const today = todayDateString();
  const {
    activeProfile,
    activePractice,
    practiceRadiologists,
    orgRadiologists,
    practices,
  } = useOrg();

  const profileId = activeProfile?.id ?? null;

  const settings = useLiveQuery<UserSettings | undefined>(
    () => db.userSettings.get('default'),
    [],
  );

  // All study logs — we filter in JS because we need to aggregate across
  // multiple profileIds for practice/org views
  const allStudyLogs = useLiveQuery<StudyLog[]>(
    () => db.studyLogs.orderBy('logDate').toArray(),
    [],
  ) ?? [];

  // ── Filtered log sets per mode ────────────────────────────────────────────

  const myProfileIds = useMemo(() => new Set<string | null>([profileId, null]), [profileId]);

  const practiceProfileIds = useMemo(() => {
    const ids = new Set<string | null>(practiceRadiologists.map((r) => r.id));
    ids.add(null); // legacy rows
    return ids;
  }, [practiceRadiologists]);

  const orgProfileIds = useMemo(() => {
    const ids = new Set<string | null>(orgRadiologists.map((r) => r.id));
    ids.add(null);
    return ids;
  }, [orgRadiologists]);

  const activeLogs = useMemo(() => {
    if (mode === 'my') return allStudyLogs.filter((l) => myProfileIds.has(l.profileId));
    if (mode === 'practice') return allStudyLogs.filter((l) => practiceProfileIds.has(l.profileId));
    return allStudyLogs.filter((l) => orgProfileIds.has(l.profileId));
  }, [allStudyLogs, mode, myProfileIds, practiceProfileIds, orgProfileIds]);

  const todayActiveLogs = useMemo(
    () => activeLogs.filter((l) => l.logDate === today),
    [activeLogs, today],
  );

  const reviewCount = useLiveQuery<number>(
    async () => {
      if (!profileId) return 0;
      const all = await db.studyLogs.where('needsReview').equals(1 as any).toArray();
      return all.filter((l) => l.profileId === profileId || l.profileId == null).length;
    },
    [profileId],
  );

  const activeSession = useLiveQuery<ActiveReviewSession | undefined>(
    async () => {
      const sessions = await db.activeReviewSessions
        .where('status')
        .equals('active')
        .reverse()
        .sortBy('updatedAt');
      return sessions.find((session) => session.profileId === profileId || session.profileId == null);
    },
    [profileId],
  );

  const learnedTodayCount = useLiveQuery<number>(
    async () => {
      const todayPrefix = today;
      const aliases = await db.examAliases.toArray();
      return aliases.filter((alias) => alias.createdAt?.slice(0, 10) === todayPrefix).length;
    },
    [today],
  ) ?? 0;

  // ── Effective goal for current mode ──────────────────────────────────────

  const effectiveAnnualGoal = useMemo(() => {
    if (mode === 'my') return activeProfile?.annualRvuGoal ?? settings?.annualRvuGoal ?? 15000;
    if (mode === 'practice') return practiceRadiologists.reduce((s, r) => s + r.annualRvuGoal, 0);
    return orgRadiologists.reduce((s, r) => s + r.annualRvuGoal, 0);
  }, [mode, activeProfile, settings, practiceRadiologists, orgRadiologists]);

  const effectiveFiscalMonth = activeProfile?.fiscalYearStartMonth ?? settings?.fiscalYearStartMonth ?? 1;

  const ytdStats = useMemo(() => {
    if (!settings) return null;
    const effectiveSettings = {
      ...settings,
      annualRvuGoal: effectiveAnnualGoal,
      fiscalYearStartMonth: effectiveFiscalMonth,
    };
    const year = new Date().getFullYear();
    const fiscalStart = new Date(year, effectiveFiscalMonth - 1, 1);
    const ytdLogs = activeLogs.filter((l) => l.logDate >= fiscalStart.toISOString().slice(0, 10));
    return computeYtdStats(ytdLogs, effectiveSettings);
  }, [activeLogs, settings, effectiveAnnualGoal, effectiveFiscalMonth]);

  const todayStats = useMemo(() => {
    return computeDailyStats(todayActiveLogs, null);
  }, [todayActiveLogs]);

  const autoApprovedToday = todayActiveLogs.filter((log) => log.matchMethod === 'alias_match' && log.matchConfidence >= 0.95).length;
  const ocrAccuracy = todayActiveLogs.length
    ? ((todayActiveLogs.length - todayActiveLogs.filter((log) => log.needsReview).length) / todayActiveLogs.length) * 100
    : 0;

  // Confetti on milestone (my mode only)
  useEffect(() => {
    if (!ytdStats || mode !== 'my') return;
    const pct = ytdStats.percentToGoal;
    for (const m of [25, 50, 75, 100]) {
      if (prevPercent !== null && prevPercent < m && pct >= m) {
        setShowConfetti(true);
        setTimeout(() => setShowConfetti(false), 4000);
        break;
      }
    }
    setPrevPercent(pct);
  }, [ytdStats?.percentToGoal, mode]);

  const paceStatus = (() => {
    if (!ytdStats) return 'neutral' as const;
    if (ytdStats.percentToGoal >= 100) return 'ahead' as const;
    const expectedPct = (ytdStats.daysElapsedInYear / (ytdStats.daysElapsedInYear + ytdStats.daysRemainingInYear)) * 100;
    if (ytdStats.percentToGoal >= expectedPct * 0.97) return 'on_track' as const;
    return 'behind' as const;
  })();

  const modalityData = useMemo(() => {
    if (!todayStats) return [];
    return Object.entries(todayStats.byModality)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => ({ modality: k as Modality, rvu: v }))
      .sort((a, b) => b.rvu - a.rvu);
  }, [todayStats]);

  const weeklyData = useMemo(() => {
    const days: { date: string; rvu: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const rvu = activeLogs
        .filter((l) => l.logDate === dateStr && !l.needsReview)
        .reduce((s, l) => s + (l.workRvu ?? 0), 0);
      days.push({ date: dateStr, rvu });
    }
    return days;
  }, [activeLogs]);

  // ── Mode labels ───────────────────────────────────────────────────────────

  const practiceLabel = activePractice
    ? activePractice.name
    : 'Practice';

  const orgLabel = 'All Locations';

  // Radiologists to show in the breakdown panel (practice/org mode)
  const radBreakdown = mode === 'practice'
    ? practiceRadiologists
    : mode === 'org'
    ? orgRadiologists
    : [];

  // Group org radiologists by practice for org view
  const practiceGroups = useMemo(() => {
    if (mode !== 'org') return [];
    const grouped = new Map<string, { practiceName: string; rads: RadiologistProfile[] }>();
    for (const rad of orgRadiologists) {
      const p = rad.practiceId ? practices.find((pr) => pr.id === rad.practiceId) : null;
      const key = p?.id ?? 'unassigned';
      if (!grouped.has(key)) {
        grouped.set(key, { practiceName: p?.name ?? 'Unassigned', rads: [] });
      }
      grouped.get(key)!.rads.push(rad);
    }
    return Array.from(grouped.values());
  }, [mode, orgRadiologists, practices]);

  // Logs per radiologist for breakdown cards
  const logsByProfile = useMemo(() => {
    const map = new Map<string, StudyLog[]>();
    for (const log of allStudyLogs) {
      const key = log.profileId ?? 'null';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(log);
    }
    return map;
  }, [allStudyLogs]);

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <ConfettiCanvas active={showConfetti} />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--theme-text-primary)' }}>
            Annual Dashboard
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--theme-text-muted)' }}>
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <ModePills
            mode={mode}
            onChange={setMode}
            practiceLabel={practiceLabel}
            orgLabel={orgLabel}
          />
          {(reviewCount ?? 0) > 0 && (
            <button
              onClick={() => onNavigate('history')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-400 text-sm font-medium hover:bg-amber-500/25 transition-colors"
            >
              ⚠️ {reviewCount}
            </button>
          )}
          <button
            onClick={() => onNavigate('log')}
            className="px-4 py-2 rounded-xl text-white text-sm font-semibold hover:opacity-90 transition-opacity shadow-lg"
            style={{ background: `linear-gradient(135deg, ${theme.colors.primary}, ${theme.colors.accent})`, boxShadow: `0 4px 14px rgba(37,99,168,0.35)` }}
          >
            + Log Study
          </button>
        </div>
      </div>

      {/* Mode context label */}
      {mode !== 'my' && (
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <span className="text-lg">{mode === 'practice' ? '🏥' : '📍'}</span>
          <span>
            Showing production for{' '}
            <span className="text-white font-medium">
              {mode === 'practice' ? practiceLabel : orgLabel}
            </span>
            {' '}·{' '}
            <span className="text-slate-500">
              {(mode === 'practice' ? practiceRadiologists : orgRadiologists).length} radiologist
              {(mode === 'practice' ? practiceRadiologists : orgRadiologists).length !== 1 ? 's' : ''}
              {' '}· combined goal {fmtInt(effectiveAnnualGoal)} wRVU
            </span>
          </span>
        </div>
      )}

      {/* Top metric cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Today */}
        <div
          className="rounded-2xl p-5 flex flex-col gap-1.5 transition-all duration-200"
          style={{
            background: 'linear-gradient(145deg, rgba(37,99,168,0.14), rgba(22,32,50,0.95))',
            border: '1px solid rgba(91,184,212,0.18)',
            boxShadow: '0 4px 20px rgba(0,0,0,0.28), 0 0 40px rgba(37,99,168,0.06)',
          }}
        >
          <p className="metric-label">{mode === 'my' ? 'Today' : 'Today (All)'}</p>
          <p className="metric-value">{fmt(todayStats?.totalWorkRvu ?? 0)}</p>
          <p style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
            {todayStats?.studyCount ?? 0} {todayStats?.studyCount === 1 ? 'study' : 'studies'}
          </p>
        </div>

        {/* YTD wRVU */}
        <div
          className="rounded-2xl p-5 flex flex-col gap-1.5 transition-all duration-200"
          style={{
            background: 'linear-gradient(145deg, rgba(22,32,50,0.95), rgba(15,22,34,0.98))',
            border: '1px solid rgba(91,184,212,0.1)',
            boxShadow: '0 2px 12px rgba(0,0,0,0.25)',
          }}
        >
          <p className="metric-label">YTD wRVU</p>
          <p className="metric-value">{fmtInt(ytdStats?.ytdWorkRvu ?? 0)}</p>
          <p style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
            of {fmtInt(ytdStats?.annualGoal ?? 0)} goal
          </p>
        </div>

        {/* % to Goal */}
        <div
          className="rounded-2xl p-5 flex flex-col gap-1.5 transition-all duration-200"
          style={{
            background: 'linear-gradient(145deg, rgba(22,32,50,0.95), rgba(15,22,34,0.98))',
            border: '1px solid rgba(91,184,212,0.1)',
            boxShadow: '0 2px 12px rgba(0,0,0,0.25)',
          }}
        >
          <p className="metric-label">% to Goal</p>
          <p
            className="metric-value"
            style={{
              color: (ytdStats?.percentToGoal ?? 0) >= 100
                ? 'var(--theme-ahead)'
                : (ytdStats?.percentToGoal ?? 0) >= 85
                ? 'var(--theme-on-track)'
                : undefined,
            }}
          >
            {fmt(ytdStats?.percentToGoal ?? 0, 1)}%
          </p>
          <p style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
            {fmtInt(ytdStats?.remainingRvu ?? 0)} remaining
          </p>
        </div>

        {/* Req. Pace */}
        <div
          className="rounded-2xl p-5 flex flex-col gap-1.5 transition-all duration-200"
          style={{
            background: 'linear-gradient(145deg, rgba(22,32,50,0.95), rgba(15,22,34,0.98))',
            border: '1px solid rgba(91,184,212,0.1)',
            boxShadow: '0 2px 12px rgba(0,0,0,0.25)',
          }}
        >
          <p className="metric-label">{mode === 'my' ? 'Req. Pace' : 'Avg / Day'}</p>
          <p className="metric-value">{fmt(ytdStats?.requiredRvuPerWorkday ?? 0)}</p>
          <p style={{ fontSize: '0.75rem', color: 'var(--theme-text-muted)' }}>
            wRVU/workday needed
          </p>
        </div>
      </div>

      <div className="card space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-white">Productivity Automation</p>
            <p className="text-xs text-slate-500">
              Confirmed totals are finalized logs. Projected totals include the active temporary review session.
            </p>
          </div>
          {activeSession && (
            <button
              onClick={() => onNavigate('import')}
              className="px-3 py-1.5 rounded-lg border border-sky-500/30 text-xs text-sky-300 hover:bg-sky-500/10"
            >
              Review Unknowns
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <div className="rounded-xl border border-white/8 bg-white/3 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">Today's exams</p>
            <p className="text-lg font-bold text-white">{todayStats?.studyCount ?? 0}</p>
          </div>
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/8 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wider text-emerald-500/80">Confirmed</p>
            <p className="text-lg font-bold text-emerald-300">{fmt(todayStats?.totalWorkRvu ?? 0)}</p>
          </div>
          <div className="rounded-xl border border-sky-500/20 bg-sky-500/8 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wider text-sky-500/80">Projected</p>
            <p className="text-lg font-bold text-sky-300">
              {fmt((todayStats?.totalWorkRvu ?? 0) + (activeSession?.projectedWrvu ?? 0))}
            </p>
          </div>
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/8 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wider text-amber-500/80">Auto-approved</p>
            <p className="text-lg font-bold text-amber-300">
              {todayActiveLogs.length ? Math.round((autoApprovedToday / todayActiveLogs.length) * 100) : 0}%
            </p>
          </div>
          <div className="rounded-xl border border-red-500/20 bg-red-500/8 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wider text-red-400/80">Needs review</p>
            <p className="text-lg font-bold text-red-300">{activeSession?.needsReviewCount ?? (reviewCount ?? 0)}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <div className="rounded-xl border border-white/8 bg-white/3 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">OCR accuracy</p>
            <p className="text-base font-bold text-white">{ocrAccuracy.toFixed(0)}%</p>
          </div>
          <div className="rounded-xl border border-white/8 bg-white/3 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">Avg wRVU/exam</p>
            <p className="text-base font-bold text-white">
              {todayStats?.studyCount ? fmt((todayStats.totalWorkRvu ?? 0) / todayStats.studyCount) : '0.0'}
            </p>
          </div>
          <div className="rounded-xl border border-white/8 bg-white/3 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">Time saved est.</p>
            <p className="text-base font-bold text-white">{Math.round(autoApprovedToday * 0.35)} min</p>
          </div>
          <div className="rounded-xl border border-white/8 bg-white/3 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">New mappings today</p>
            <p className="text-base font-bold text-white">{learnedTodayCount}</p>
          </div>
        </div>
      </div>

      {/* YTD Progress bar */}
      <div className="card space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold" style={{ color: 'var(--theme-text-primary)' }}>
              {mode === 'my' ? 'Annual Goal Progress' : mode === 'practice' ? `${practiceLabel} Progress` : `${orgLabel} Progress`}
            </p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--theme-text-muted)' }}>
              {fmtInt(ytdStats?.daysElapsedInYear ?? 0)} days elapsed · {fmtInt(ytdStats?.daysRemainingInYear ?? 0)} remaining
            </p>
          </div>
          <StatusBadge status={paceStatus} />
        </div>
        <ProgressBar value={ytdStats?.percentToGoal ?? 0} status={paceStatus} height="lg" animated />
        <div className="flex justify-between text-xs" style={{ color: 'var(--theme-text-disabled)' }}>
          <span>0</span>
          <span style={{ color: 'var(--theme-text-primary)', fontWeight: 600 }}>
            {fmt(ytdStats?.ytdWorkRvu ?? 0, 0)} / {fmtInt(ytdStats?.annualGoal ?? 0)} wRVU
          </span>
          <span>Goal</span>
        </div>
        <div className="divider" />
        <div className="flex gap-6 flex-wrap">
          <div>
            <p className="metric-label">Projected Year-End</p>
            <p
              className="text-lg font-bold mt-0.5"
              style={{
                color: (ytdStats?.projectedYearEnd ?? 0) >= (ytdStats?.annualGoal ?? 0)
                  ? 'var(--theme-ahead)' : 'var(--theme-behind)',
              }}
            >
              {fmtInt(ytdStats?.projectedYearEnd ?? 0)}
            </p>
          </div>
          <div>
            <p className="metric-label">Daily Avg (YTD)</p>
            <p className="text-lg font-bold mt-0.5" style={{ color: 'var(--theme-text-primary)' }}>
              {fmt(ytdStats?.dailyAverageYtd ?? 0)}
            </p>
          </div>
          <div>
            <p className="metric-label">Workdays Left</p>
            <p className="text-lg font-bold mt-0.5" style={{ color: 'var(--theme-text-primary)' }}>
              {fmtInt(ytdStats?.workdaysRemainingEstimate ?? 0)}
            </p>
          </div>
        </div>
      </div>

      {/* Practice / Org breakdown */}
      {mode !== 'my' && settings && radBreakdown.length > 0 && (
        <div className="card space-y-3">
          <p className="text-sm font-semibold text-white">
            {mode === 'practice' ? 'Radiologist Breakdown' : 'By Location'}
          </p>

          {mode === 'practice' ? (
            <div className="space-y-2">
              {radBreakdown.map((r) => (
                <RadCard
                  key={r.id}
                  profile={r}
                  logs={logsByProfile.get(r.id) ?? []}
                  settings={settings}
                  isActive={r.id === activeProfile?.id}
                />
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              {practiceGroups.map((group) => (
                <div key={group.practiceName} className="space-y-2">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                    <span>📍</span> {group.practiceName}
                  </p>
                  {group.rads.map((r) => (
                    <RadCard
                      key={r.id}
                      profile={r}
                      logs={logsByProfile.get(r.id) ?? []}
                      settings={settings}
                      isActive={r.id === activeProfile?.id}
                    />
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Lower section: today breakdown + weekly trend */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Today's modality breakdown */}
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold" style={{ color: 'var(--theme-text-primary)' }}>
              Today by Modality
            </p>
            <button
              onClick={() => onNavigate('log')}
              className="text-xs font-medium transition-colors"
              style={{ color: theme.colors.accent }}
            >
              + Add
            </button>
          </div>
          {modalityData.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm" style={{ color: 'var(--theme-text-muted)' }}>No studies logged today</p>
              <button
                onClick={() => onNavigate('log')}
                className="mt-3 px-4 py-2 rounded-xl text-sm font-medium transition-all"
                style={{
                  background: 'rgba(37,99,168,0.12)',
                  border: '1px solid rgba(37,99,168,0.25)',
                  color: theme.colors.accent,
                }}
              >
                Log your first study
              </button>
            </div>
          ) : (
            <div className="space-y-2.5">
              {modalityData.map(({ modality, rvu }) => {
                const pct = (rvu / (todayStats?.totalWorkRvu ?? 1)) * 100;
                const color = MODALITY_COLORS[modality];
                return (
                  <div key={modality} className="space-y-1">
                    <div className="flex justify-between items-baseline">
                      <span style={{ fontSize: '12px', color: 'var(--theme-text-secondary)', fontWeight: 500 }}>
                        {MODALITY_LABELS[modality]}
                      </span>
                      <span style={{ fontSize: '12px', color: 'var(--theme-text-primary)', fontWeight: 600 }}>
                        {fmt(rvu)} <span style={{ color: 'var(--theme-text-disabled)', fontWeight: 400 }}>wRVU</span>
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${pct}%`,
                          background: `linear-gradient(90deg, ${color}99, ${color})`,
                          boxShadow: `0 0 6px ${color}44`,
                        }}
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
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold" style={{ color: 'var(--theme-text-primary)' }}>7-Day Trend</p>
            <span className="text-xs tabular-nums" style={{ color: 'var(--theme-text-muted)' }}>
              {fmt(weeklyData.reduce((s, d) => s + d.rvu, 0), 0)} wRVU
            </span>
          </div>
          <div className="h-[160px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={weeklyData.map((d) => ({
                  ...d,
                  day: new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' }),
                }))}
                margin={{ top: 8, right: 4, left: -24, bottom: 0 }}
              >
                <CartesianGrid stroke="rgba(129,211,235,0.08)" vertical={false} />
                <XAxis
                  dataKey="day"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: 'var(--theme-text-muted)', fontSize: 11 }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: 'var(--theme-text-disabled)', fontSize: 10 }}
                  width={38}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(91,184,212,0.06)' }}
                  contentStyle={{
                    background: 'rgba(10,20,34,0.96)',
                    border: '1px solid rgba(129,211,235,0.18)',
                    borderRadius: 10,
                    color: 'var(--theme-text-primary)',
                  }}
                  formatter={(value) => [`${fmt(Number(value), 1)} wRVU`, 'Production']}
                  labelStyle={{ color: 'var(--theme-text-secondary)' }}
                />
                <Bar dataKey="rvu" radius={[6, 6, 2, 2]} fill="var(--theme-accent)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Log Study', icon: '✏️', tab: 'log' as const },
          { label: 'Import', icon: '📥', tab: 'import' as const },
          { label: 'History', icon: '📋', tab: 'history' as const },
          { label: 'Settings', icon: '⚙️', tab: 'settings' as const },
        ].map(({ label, icon, tab }) => (
          <button
            key={tab}
            onClick={() => (tab === 'import' ? setShowImportMethods((v) => !v) : onNavigate(tab))}
            className="card flex items-center gap-3 cursor-pointer group transition-all duration-200"
            style={{ padding: '1rem 1.125rem' }}
          >
            <span className="text-xl">{icon}</span>
            <span
              className="text-sm font-medium transition-colors duration-150"
              style={{ color: 'var(--theme-text-secondary)' }}
            >
              {label}
            </span>
          </button>
        ))}
      </div>

      {showImportMethods && (
        <div className="card grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2" style={{ padding: '0.875rem' }}>
          {[
            { label: 'Capture with Camera', icon: '📷', tab: 'camera' as const },
            { label: 'Upload Screenshot/Image', icon: '🖼', tab: 'import' as const },
            { label: 'Drag & Drop Image', icon: '📄', tab: 'import' as const },
            { label: 'CPT Lookup', icon: '🔎', tab: 'explorer' as const },
            { label: 'Manual Text Entry', icon: '⌨️', tab: 'log' as const },
          ].map(({ label, icon, tab }) => (
            <button
              key={label}
              onClick={() => onNavigate(tab)}
              className="flex items-center gap-2 rounded-xl border border-white/8 bg-white/3 px-3 py-2.5 text-left text-sm transition-all hover:border-white/20 hover:bg-white/6"
              style={{ color: 'var(--theme-text-secondary)' }}
            >
              <span className="text-lg">{icon}</span>
              <span className="font-medium leading-snug">{label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
