import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

interface RingProps {
  /** 0–100+. Values above 100 render a full ring (goal exceeded). */
  percent: number;
  size?: number;
  strokeWidth?: number;
  children?: React.ReactNode;
  label: string;
  className?: string;
}

/** Apple Watch-style activity ring. SVG stroke-dasharray only, no chart library. */
export function Ring({ percent, size = 220, strokeWidth = 16, children, label, className }: RingProps) {
  const clamped = Math.max(0, Math.min(100, percent));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  const [sweep, setSweep] = useState(0);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setSweep(clamped));
    return () => cancelAnimationFrame(raf);
  }, [clamped]);

  const offset = circumference - (sweep / 100) * circumference;

  return (
    <div
      className={cn('relative inline-flex items-center justify-center', className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <title>{label}</title>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--rd-separator)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--rd-accent)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="rd-motion-safe"
          style={{ transition: 'stroke-dashoffset 600ms cubic-bezier(0.4,0,0.2,1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  );
}

/** Count-up number, 300ms, respects prefers-reduced-motion via CSS. */
export function useCountUp(target: number, durationMs = 300): number {
  const [value, setValue] = useState(target);
  useEffect(() => {
    const from = value;
    if (Math.abs(target - from) < 0.05) {
      setValue(target);
      return;
    }
    let raf: number;
    const start = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(from + (target - from) * eased);
      if (progress < 1) raf = requestAnimationFrame(step);
      else setValue(target);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, durationMs]);
  return value;
}
