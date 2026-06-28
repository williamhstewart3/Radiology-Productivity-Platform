import { theme } from '../lib/theme';

interface ProgressBarProps {
  value: number; // 0–100
  status?: 'ahead' | 'on_track' | 'behind' | 'neutral';
  showLabel?: boolean;
  height?: 'sm' | 'md' | 'lg';
  animated?: boolean;
}

function barColor(status: ProgressBarProps['status']): string {
  switch (status) {
    case 'ahead':    return theme.colors.ahead;
    case 'on_track': return theme.colors.onTrack;
    case 'behind':   return theme.colors.behind;
    default:         return theme.colors.textDisabled;
  }
}

const HEIGHTS = { sm: 4, md: 6, lg: 10 };

export function ProgressBar({
  value,
  status = 'neutral',
  showLabel = false,
  height = 'md',
  animated = true,
}: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, value));
  const h = HEIGHTS[height];
  const fill = barColor(status);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {showLabel && (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: theme.colors.textMuted }}>
          <span>Progress</span>
          <span style={{ fontWeight: 600, color: theme.colors.textPrimary }}>{clamped.toFixed(1)}%</span>
        </div>
      )}
      <div style={{
        width: '100%', height: h,
        background: 'rgba(91,184,212,0.08)',
        borderRadius: h / 2,
        overflow: 'hidden',
      }}>
        <div style={{
          height: h,
          width: `${clamped}%`,
          background: fill,
          borderRadius: h / 2,
          transition: animated ? 'width 0.7s cubic-bezier(0.4,0,0.2,1)' : 'none',
        }} />
      </div>
    </div>
  );
}

// ─── StatusBadge ─────────────────────────────────────────────────────────────

interface StatusBadgeProps {
  status: 'ahead' | 'on_track' | 'behind' | 'neutral';
  label?: string;
  size?: 'sm' | 'md';
}

const BADGE_CONFIG = {
  ahead: {
    bg: 'rgba(34,197,94,0.12)', border: 'rgba(34,197,94,0.3)',
    text: '#4ade80', dot: '#22c55e', defaultLabel: 'Ahead of pace',
  },
  on_track: {
    bg: 'rgba(59,130,246,0.12)', border: 'rgba(59,130,246,0.3)',
    text: '#60a5fa', dot: '#3b82f6', defaultLabel: 'On track',
  },
  behind: {
    bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.3)',
    text: '#f87171', dot: '#ef4444', defaultLabel: 'Behind pace',
  },
  neutral: {
    bg: 'rgba(91,184,212,0.06)', border: 'rgba(91,184,212,0.15)',
    text: theme.colors.textMuted, dot: theme.colors.textDisabled, defaultLabel: 'No data',
  },
};

export function StatusBadge({ status, label, size = 'md' }: StatusBadgeProps) {
  const c = BADGE_CONFIG[status];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      borderRadius: 9999,
      background: c.bg,
      border: `1px solid ${c.border}`,
      color: c.text,
      padding: size === 'sm' ? '2px 8px' : '4px 12px',
      fontSize: size === 'sm' ? 11 : 13,
      fontWeight: 500,
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: '50%', background: c.dot,
        animation: 'pulse 2s ease-in-out infinite',
        display: 'inline-block',
      }} />
      {label ?? c.defaultLabel}
    </span>
  );
}
