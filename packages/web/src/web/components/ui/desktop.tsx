import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('flex flex-col gap-3 pb-1 lg:flex-row lg:items-end lg:justify-between', className)}>
      <div className="min-w-0">
        {eyebrow && <p className="section-label mb-1.5">{eyebrow}</p>}
        <h1 className="text-[1.7rem] font-semibold leading-tight tracking-[-0.025em] text-[var(--text-primary)]">
          {title}
        </h1>
        {description && (
          <p className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

export function GlassCard({
  children,
  className,
  interactive = false,
}: {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
}) {
  return (
    <section className={cn('surface', interactive && 'interactive-surface', className)}>
      {children}
    </section>
  );
}

export function KpiCard({
  label,
  value,
  helper,
  tone = 'default',
  icon,
}: {
  label: string;
  value: ReactNode;
  helper?: ReactNode;
  tone?: 'default' | 'accent' | 'success' | 'warning' | 'danger';
  icon?: ReactNode;
}) {
  return (
    <GlassCard className={cn('p-4', tone !== 'default' && `kpi-${tone}`)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="metric-label">{label}</p>
          <div className="mt-2 text-2xl font-semibold tabular-nums text-[var(--theme-text-primary)]">
            {value}
          </div>
          {helper && <p className="mt-1 text-xs text-[var(--theme-text-muted)]">{helper}</p>}
        </div>
        {icon && <div className="desk-icon">{icon}</div>}
      </div>
    </GlassCard>
  );
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <label className="mb-1.5 block text-xs font-medium text-[var(--theme-text-secondary)]">
      {children}
    </label>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="surface flex min-h-52 flex-col items-center justify-center gap-3 rounded-[14px] p-8 text-center">
      {icon && <div className="desk-empty-icon">{icon}</div>}
      <div>
        <p className="text-sm font-medium text-[var(--theme-text-primary)]">{title}</p>
        {description && (
          <p className="mt-1 text-xs leading-5 text-[var(--theme-text-muted)]">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}
