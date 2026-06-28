interface ProgressBarProps {
  value: number; // 0–100
  status?: 'ahead' | 'on_track' | 'behind' | 'neutral';
  showLabel?: boolean;
  height?: 'sm' | 'md' | 'lg';
  animated?: boolean;
}

const STATUS_COLORS = {
  ahead: 'from-emerald-500 to-teal-400',
  on_track: 'from-indigo-500 to-blue-400',
  behind: 'from-red-500 to-orange-400',
  neutral: 'from-slate-600 to-slate-500',
};

const HEIGHTS = {
  sm: 'h-1',
  md: 'h-2',
  lg: 'h-3',
};

export function ProgressBar({
  value,
  status = 'neutral',
  showLabel = false,
  height = 'md',
  animated = true,
}: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, value));
  const gradient = STATUS_COLORS[status];

  return (
    <div className="space-y-1">
      {showLabel && (
        <div className="flex justify-between text-xs text-slate-400">
          <span>Progress</span>
          <span className="font-medium text-white">{clamped.toFixed(1)}%</span>
        </div>
      )}
      <div className={`w-full ${HEIGHTS[height]} bg-white/5 rounded-full overflow-hidden`}>
        <div
          className={`${HEIGHTS[height]} bg-gradient-to-r ${gradient} rounded-full ${
            animated ? 'transition-all duration-700 ease-out' : ''
          }`}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}
