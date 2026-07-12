import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface BadgeProps {
  children: ReactNode;
  tone?: 'neutral' | 'positive' | 'caution' | 'accent';
  className?: string;
}

const TONE_CLASS: Record<NonNullable<BadgeProps['tone']>, string> = {
  neutral: 'bg-rd-separator text-rd-label-secondary',
  positive: 'bg-rd-positive/12 text-rd-positive',
  caution: 'bg-rd-caution/14 text-rd-caution',
  accent: 'bg-rd-accent/12 text-rd-accent',
};

/** Small inline status marker — for deviations from the happy path, not decoration. */
export function Badge({ children, tone = 'neutral', className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-[6px] px-1.5 py-0.5 text-[11px] font-medium',
        TONE_CLASS[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
