interface StatusBadgeProps {
  status: 'ahead' | 'on_track' | 'behind' | 'neutral';
  label?: string;
  size?: 'sm' | 'md';
}

const CONFIG = {
  ahead: {
    bg: 'bg-emerald-500/15',
    border: 'border-emerald-500/30',
    text: 'text-emerald-400',
    dot: 'bg-emerald-400',
    glow: 'shadow-[0_0_8px_rgba(52,211,153,0.3)]',
    defaultLabel: 'Ahead of pace',
  },
  on_track: {
    bg: 'bg-blue-500/15',
    border: 'border-blue-500/30',
    text: 'text-blue-400',
    dot: 'bg-blue-400',
    glow: 'shadow-[0_0_8px_rgba(96,165,250,0.3)]',
    defaultLabel: 'On track',
  },
  behind: {
    bg: 'bg-red-500/15',
    border: 'border-red-500/30',
    text: 'text-red-400',
    dot: 'bg-red-400',
    glow: 'shadow-[0_0_8px_rgba(248,113,113,0.3)]',
    defaultLabel: 'Behind pace',
  },
  neutral: {
    bg: 'bg-slate-500/15',
    border: 'border-slate-500/30',
    text: 'text-slate-400',
    dot: 'bg-slate-400',
    glow: '',
    defaultLabel: 'No data',
  },
};

export function StatusBadge({ status, label, size = 'md' }: StatusBadgeProps) {
  const c = CONFIG[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border ${c.bg} ${c.border} ${c.text} ${c.glow} ${
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm'
      } font-medium`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot} animate-pulse`} />
      {label ?? c.defaultLabel}
    </span>
  );
}
