import { useMemo, type ComponentType, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Gauge,
  Layers3,
  ShieldCheck,
  Target,
  TrendingUp,
} from 'lucide-react';
import { db } from '../db/database';
import { useProfile } from '../hooks/useProfile';
import { computePeriodTotals, computeYtdStats, todayDateString } from '../utils/calculations';
import { MODALITIES, MODALITY_LABELS, type ActiveReviewSession, type Modality, type StudyLog, type UserSettings } from '../types';

const COLORS: Record<Modality, string> = {
  CT: '#60a5fa',
  MRI: '#a78bfa',
  US: '#22d3ee',
  XR: '#38bdf8',
  NM_PET: '#fbbf24',
  MAMMO: '#f472b6',
  FLUORO: '#34d399',
  PROCEDURE: '#fb7185',
  OTHER: '#94a3b8',
};

const compactNumber = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });

function fmt(value: number, digits = 1): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function dayLabel(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function hourLabel(hour: number): string {
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const display = hour % 12 || 12;
  return `${display}${suffix}`;
}

function isDeleted(log: StudyLog): boolean {
  return Boolean((log as any).deletedAt);
}

function useProductivityData() {
  const today = todayDateString();
  const { activeProfile } = useProfile();
  const profileId = activeProfile?.id ?? null;
  const settings = useLiveQuery<UserSettings | undefined>(() => db.userSettings.get('default'), []);
  const logs = useLiveQuery<StudyLog[]>(
    async () => {
      if (!profileId) return [];
      const all = await db.studyLogs.orderBy('logDate').toArray();
      return all.filter((log) => !isDeleted(log) && (log.profileId === profileId || log.profileId == null));
    },
    [profileId],
    [],
  ) ?? [];
  const sessions = useLiveQuery<ActiveReviewSession[]>(
    async () => {
      if (!profileId) return [];
      const all = await db.activeReviewSessions.orderBy('updatedAt').reverse().toArray();
      return all.filter((session) => session.profileId === profileId || session.profileId == null);
    },
    [profileId],
    [],
  ) ?? [];

  return { today, activeProfile, settings, logs, sessions };
}

function PageHeader({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="premium-page-header">
      <p className="premium-eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p>{subtitle}</p>
    </div>
  );
}

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  tone = 'default',
}: {
  label: string;
  value: string;
  detail?: string;
  icon: ComponentType<{ className?: string }>;
  tone?: 'default' | 'success' | 'warning' | 'danger';
}) {
  return (
    <div className={`premium-card premium-card-hover metric-tile metric-tile-${tone}`}>
      <div className="metric-tile-icon"><Icon className="size-4" /></div>
      <p className="premium-label">{label}</p>
      <p className="premium-value">{value}</p>
      {detail && <p className="premium-detail">{detail}</p>}
    </div>
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="premium-card p-5">
      <div className="mb-4">
        <h2 className="text-sm font-semibold tracking-tight text-[var(--theme-text-primary)]">{title}</h2>
        {subtitle && <p className="mt-1 text-xs text-[var(--theme-text-muted)]">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function buildDailySeries(logs: StudyLog[], days = 14) {
  const out: Array<{ date: string; label: string; rvu: number; exams: number }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const date = d.toISOString().slice(0, 10);
    const dayLogs = logs.filter((log) => log.logDate === date && !log.needsReview);
    out.push({
      date,
      label: dayLabel(date),
      rvu: dayLogs.reduce((sum, log) => sum + (log.workRvu ?? 0), 0),
      exams: dayLogs.length,
    });
  }
  return out;
}

function modalityRows(logs: StudyLog[]) {
  const totals = computePeriodTotals(logs);
  return MODALITIES.map((modality) => {
    const modalityLogs = logs.filter((log) => (log.modality ?? 'OTHER') === modality && !log.needsReview);
    return {
      modality,
      label: MODALITY_LABELS[modality],
      count: modalityLogs.length,
      rvu: totals.byModality[modality] ?? 0,
      color: COLORS[modality],
    };
  }).filter((row) => row.count > 0 || row.rvu > 0).sort((a, b) => b.rvu - a.rvu);
}

function hourlyRows(logs: StudyLog[]) {
  const rows = Array.from({ length: 24 }, (_, hour) => ({ hour, label: hourLabel(hour), rvu: 0, exams: 0 }));
  for (const log of logs) {
    if (log.needsReview) continue;
    const source = log.modifiedDateTime ?? log.studyDateTime ?? log.createdAt;
    const date = new Date(source);
    if (Number.isNaN(date.getTime())) continue;
    const row = rows[date.getHours()];
    row.rvu += log.workRvu ?? 0;
    row.exams += 1;
  }
  return rows.filter((row) => row.rvu > 0 || row.exams > 0);
}

export function ActivityTimelinePage() {
  const { today, logs, sessions } = useProductivityData();
  const todayLogs = logs.filter((log) => log.logDate === today);
  const grouped = useMemo(() => {
    const events = [
      ...sessions.slice(0, 12).map((session) => ({
        id: session.id,
        time: session.updatedAt,
        title: session.status === 'active' ? 'Review session active' : 'Import session finalized',
        detail: `${session.totalExams} captured, ${session.duplicateCount} duplicates, ${session.needsReviewCount} review`,
        rvu: session.estimatedPendingWrvu,
        tone: session.needsReviewCount > 0 ? 'warning' : 'success',
      })),
      ...todayLogs.slice(-12).reverse().map((log) => ({
        id: log.id,
        time: log.createdAt,
        title: log.examTitleDisplay ?? log.examNameRaw,
        detail: `${log.cptCode ?? 'Unmatched'}${log.modifier ? `-${log.modifier}` : ''} - ${log.modality ?? 'Unknown'}`,
        rvu: log.workRvu ?? 0,
        tone: log.needsReview ? 'warning' : 'success',
      })),
    ];
    return events.sort((a, b) => b.time.localeCompare(a.time)).slice(0, 24);
  }, [sessions, todayLogs]);

  return (
    <div className="premium-page">
      <PageHeader eyebrow="Activity" title="Activity Timeline" subtitle="Import, review, duplicate, and productivity events." />
      <Panel title="Today Activity" subtitle="Most recent events first">
        <div className="premium-timeline">
          {grouped.length === 0 ? (
            <div className="premium-empty">No activity yet today.</div>
          ) : grouped.map((event) => (
            <div key={event.id} className="premium-timeline-row">
              <div className={`premium-timeline-dot premium-timeline-dot-${event.tone}`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-3">
                  <p className="truncate text-sm font-medium text-[var(--theme-text-primary)]">{event.title}</p>
                  <span className="font-mono text-xs text-[var(--theme-text-muted)]">
                    {new Date(event.time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                  </span>
                </div>
                <p className="mt-1 text-xs text-[var(--theme-text-muted)]">{event.detail}</p>
              </div>
              <div className="text-right text-sm font-semibold text-[var(--theme-text-primary)]">+{fmt(event.rvu)} wRVU</div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

export function AnalyticsPage() {
  const { today, logs, sessions } = useProductivityData();
  const series = buildDailySeries(logs, 21);
  const lastSeven = series.slice(-7);
  const totals = computePeriodTotals(logs);
  const hourly = hourlyRows(logs);
  const hoursWithWork = hourly.length || 1;
  const rvuPerHour = totals.totalWorkRvu / hoursWithWork;
  const examsPerHour = totals.studyCount / hoursWithWork;
  const mixRows = modalityRows(logs);
  const totalMixRvu = mixRows.reduce((sum, row) => sum + row.rvu, 0);
  const totalMixCount = mixRows.reduce((sum, row) => sum + row.count, 0);
  const todayLogs = logs.filter((log) => log.logDate === today);
  const reviewed = todayLogs.filter((log) => !log.needsReview);
  const manual = todayLogs.filter((log) => log.needsReview);
  const duplicateSkipped = sessions.reduce((sum, session) => sum + session.duplicateCount, 0);
  const failed = todayLogs.filter((log) => !log.cptCode).length;
  const autoApproved = todayLogs.filter((log) => log.matchMethod === 'alias_match' && (log.matchConfidence ?? 0) >= 0.95).length;
  const avgConfidence = todayLogs.length
    ? todayLogs.reduce((sum, log) => sum + (log.matchConfidence ?? 0), 0) / todayLogs.length * 100
    : 0;

  return (
    <div className="premium-page">
      <PageHeader eyebrow="Analytics" title="Analytics" subtitle="Productivity trends, workload breakdown, study mix, and tracking confidence." />
      <div className="premium-metric-grid">
        <MetricCard icon={Gauge} label="RVUs / active hour" value={fmt(rvuPerHour)} detail={`${hoursWithWork} productive hours sampled`} />
        <MetricCard icon={Activity} label="Exams / active hour" value={fmt(examsPerHour)} detail={`${totals.studyCount} completed exams`} />
        <MetricCard icon={TrendingUp} label="7-day average" value={fmt(lastSeven.reduce((s, d) => s + d.rvu, 0) / Math.max(1, lastSeven.length))} detail="wRVU per day" />
        <MetricCard icon={Layers3} label="Avg study value" value={fmt(totals.avgRvuPerStudy)} detail="wRVU per completed exam" />
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <Panel title="Trend over days" subtitle="Completed, reviewed studies only">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series}>
                <defs>
                  <linearGradient id="rvuArea" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#60a5fa" stopOpacity={0.42} />
                    <stop offset="100%" stopColor="#60a5fa" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis dataKey="label" stroke="rgba(148,163,184,0.7)" tickLine={false} axisLine={false} />
                <YAxis stroke="rgba(148,163,184,0.7)" tickLine={false} axisLine={false} width={36} />
                <Tooltip contentStyle={{ background: '#0b1220', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10 }} />
                <Area type="monotone" dataKey="rvu" stroke="#60a5fa" fill="url(#rvuArea)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Productivity by hour" subtitle="When RVUs are generated">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hourly}>
                <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis dataKey="label" stroke="rgba(148,163,184,0.7)" tickLine={false} axisLine={false} />
                <YAxis stroke="rgba(148,163,184,0.7)" tickLine={false} axisLine={false} width={34} />
                <Tooltip contentStyle={{ background: '#0b1220', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10 }} />
                <Bar dataKey="rvu" fill="#22d3ee" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>
      <div className="grid gap-4 xl:grid-cols-[0.95fr_1.25fr]">
        <Panel title="Study mix" subtitle={`${totalMixCount} exams - ${fmt(totalMixRvu)} wRVU`}>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={mixRows} dataKey="rvu" nameKey="label" innerRadius={66} outerRadius={106} paddingAngle={3}>
                  {mixRows.map((row) => <Cell key={row.modality} fill={row.color} />)}
                </Pie>
                <Tooltip formatter={(value) => `${compactNumber.format(Number(value))} wRVU`} contentStyle={{ background: '#0b1220', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Modality contribution" subtitle="Count and wRVU share">
          <div className="space-y-3">
            {mixRows.map((row) => (
              <div key={row.modality} className="premium-mix-row">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: row.color }} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[var(--theme-text-primary)]">{row.label}</p>
                    <p className="text-xs text-[var(--theme-text-muted)]">{row.count} exams</p>
                  </div>
                </div>
                <div className="w-44 max-w-[35vw]">
                  <div className="h-2 overflow-hidden rounded-full bg-white/6">
                    <div className="h-full rounded-full" style={{ width: `${totalMixRvu ? (row.rvu / totalMixRvu) * 100 : 0}%`, background: row.color }} />
                  </div>
                </div>
                <p className="w-20 text-right font-mono text-sm text-[var(--theme-text-primary)]">{fmt(row.rvu)}</p>
              </div>
            ))}
            {mixRows.length === 0 && <div className="premium-empty">No completed studies in the selected data yet.</div>}
          </div>
        </Panel>
      </div>
      <Panel title="Tracking Confidence" subtitle="OCR and CPT matching reliability">
        <div className="premium-metric-grid">
          <MetricCard icon={ShieldCheck} label="Average match confidence" value={`${fmt(avgConfidence, 0)}%`} detail="Today's imported studies" />
          <MetricCard icon={CheckCircle2} label="Auto-approved" value={String(autoApproved)} detail="High-confidence learned matches" tone="success" />
          <MetricCard icon={AlertTriangle} label="Manual reviews" value={String(manual.length)} detail={`${reviewed.length} confirmed today`} tone={manual.length ? 'warning' : 'success'} />
          <MetricCard icon={Clock3} label="Duplicates skipped" value={String(duplicateSkipped)} detail={`${failed} failed matches today`} />
        </div>
      </Panel>
    </div>
  );
}

export function StudyMixPage() {
  const { logs } = useProductivityData();
  const rows = modalityRows(logs);
  const totalRvu = rows.reduce((sum, row) => sum + row.rvu, 0);
  const totalCount = rows.reduce((sum, row) => sum + row.count, 0);

  return (
    <div className="premium-page">
      <PageHeader eyebrow="Study Mix" title="Study Mix" subtitle="Count and wRVU contribution by modality." />
      <div className="grid gap-4 xl:grid-cols-[0.95fr_1.25fr]">
        <Panel title="wRVU contribution" subtitle="Share of completed productivity">
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={rows} dataKey="rvu" nameKey="label" innerRadius={74} outerRadius={118} paddingAngle={3}>
                  {rows.map((row) => <Cell key={row.modality} fill={row.color} />)}
                </Pie>
                <Tooltip formatter={(value) => `${compactNumber.format(Number(value))} wRVU`} contentStyle={{ background: '#0b1220', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Modality table" subtitle={`${totalCount} exams - ${fmt(totalRvu)} wRVU`}>
          <div className="space-y-3">
            {rows.map((row) => (
              <div key={row.modality} className="premium-mix-row">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: row.color }} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[var(--theme-text-primary)]">{row.label}</p>
                    <p className="text-xs text-[var(--theme-text-muted)]">{row.count} exams</p>
                  </div>
                </div>
                <div className="w-44 max-w-[35vw]">
                  <div className="h-2 overflow-hidden rounded-full bg-white/6">
                    <div className="h-full rounded-full" style={{ width: `${totalRvu ? (row.rvu / totalRvu) * 100 : 0}%`, background: row.color }} />
                  </div>
                </div>
                <p className="w-20 text-right font-mono text-sm text-[var(--theme-text-primary)]">{fmt(row.rvu)}</p>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

export function AccuracyPage() {
  const { today, logs, sessions } = useProductivityData();
  const todayLogs = logs.filter((log) => log.logDate === today);
  const reviewed = todayLogs.filter((log) => !log.needsReview);
  const manual = todayLogs.filter((log) => log.needsReview);
  const duplicateSkipped = sessions.reduce((sum, session) => sum + session.duplicateCount, 0);
  const failed = todayLogs.filter((log) => !log.cptCode).length;
  const autoApproved = todayLogs.filter((log) => log.matchMethod === 'alias_match' && (log.matchConfidence ?? 0) >= 0.95).length;
  const avgConfidence = todayLogs.length
    ? todayLogs.reduce((sum, log) => sum + (log.matchConfidence ?? 0), 0) / todayLogs.length * 100
    : 0;

  return (
    <div className="premium-page">
      <PageHeader eyebrow="Accuracy" title="Tracking Accuracy" subtitle="OCR and CPT matching quality metrics." />
      <div className="premium-metric-grid">
        <MetricCard icon={ShieldCheck} label="Average match confidence" value={`${fmt(avgConfidence, 0)}%`} detail="Today's imported studies" />
        <MetricCard icon={CheckCircle2} label="Auto-approved" value={String(autoApproved)} detail="High-confidence learned matches" tone="success" />
        <MetricCard icon={AlertTriangle} label="Manual reviews" value={String(manual.length)} detail={`${reviewed.length} confirmed today`} tone={manual.length ? 'warning' : 'success'} />
        <MetricCard icon={Clock3} label="Duplicates skipped" value={String(duplicateSkipped)} detail={`${failed} failed matches today`} />
      </div>
      <Panel title="Recent OCR performance" subtitle="Latest imported rows and review status">
        <div className="space-y-2">
          {todayLogs.slice(-12).reverse().map((log) => (
            <div key={log.id} className="premium-list-row">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-[var(--theme-text-primary)]">{log.examTitleDisplay ?? log.examNameRaw}</p>
                <p className="mt-1 text-xs text-[var(--theme-text-muted)]">{log.cptCode ?? 'Unmatched'} - {log.matchMethod ?? 'unknown method'}</p>
              </div>
              <span className={`premium-pill ${log.needsReview ? 'premium-pill-warning' : 'premium-pill-success'}`}>
                {log.needsReview ? 'Review' : `${Math.round((log.matchConfidence ?? 0) * 100)}%`}
              </span>
            </div>
          ))}
          {todayLogs.length === 0 && <div className="premium-empty">No OCR rows imported today.</div>}
        </div>
      </Panel>
    </div>
  );
}

export function GoalsPage() {
  const { activeProfile, settings, logs } = useProductivityData();
  const effective = settings
    ? {
        ...settings,
        annualRvuGoal: activeProfile?.annualRvuGoal ?? settings.annualRvuGoal,
        fiscalYearStartMonth: activeProfile?.fiscalYearStartMonth ?? settings.fiscalYearStartMonth,
      }
    : null;
  const ytd = effective ? computeYtdStats(logs, effective) : null;
  const dailyGoal = activeProfile?.dailyRvuGoal ?? settings?.dailyRvuGoal ?? 90;
  const today = todayDateString();
  const todayRvu = logs.filter((log) => log.logDate === today && !log.needsReview).reduce((sum, log) => sum + (log.workRvu ?? 0), 0);
  const weeklyRvu = buildDailySeries(logs, 7).reduce((sum, row) => sum + row.rvu, 0);
  const monthlyRvu = buildDailySeries(logs, 30).reduce((sum, row) => sum + row.rvu, 0);
  const goalCards = [
    { label: 'Daily', value: todayRvu, goal: dailyGoal, detail: "Today's shift" },
    { label: 'Weekly', value: weeklyRvu, goal: dailyGoal * 5, detail: 'Rolling 7 days' },
    { label: 'Monthly', value: monthlyRvu, goal: dailyGoal * 21, detail: 'Rolling 30 days' },
    { label: 'Yearly', value: ytd?.ytdWorkRvu ?? 0, goal: ytd?.annualGoal ?? 1, detail: `${fmt(ytd?.projectedYearEnd ?? 0)} projected` },
  ];

  return (
    <div className="premium-page">
      <PageHeader eyebrow="Goals" title="Progress and projections" subtitle="Daily, weekly, monthly, and annual targets without visual noise." />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {goalCards.map((card) => {
          const percent = Math.min(100, card.goal > 0 ? (card.value / card.goal) * 100 : 0);
          return (
            <div key={card.label} className="premium-card premium-card-hover p-5">
              <div className="flex items-center justify-between">
                <p className="premium-label">{card.label}</p>
                <Target className="size-4 text-[var(--theme-accent)]" />
              </div>
              <p className="mt-5 text-3xl font-semibold tracking-tight text-[var(--theme-text-primary)]">{fmt(card.value)}</p>
              <p className="mt-1 text-xs text-[var(--theme-text-muted)]">of {fmt(card.goal)} wRVU - {card.detail}</p>
              <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/7">
                <div className="h-full rounded-full bg-[var(--theme-accent)] transition-all duration-300" style={{ width: `${percent}%` }} />
              </div>
              <p className="mt-2 text-xs font-medium text-[var(--theme-text-secondary)]">{fmt(percent, 0)}% complete</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
