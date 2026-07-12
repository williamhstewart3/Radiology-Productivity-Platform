import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface StatusPillProps {
  children: ReactNode;
  tone?: 'neutral' | 'positive' | 'caution' | 'accent';
  onClick?: () => void;
  className?: string;
}

const TONE_CLASS: Record<NonNullable<StatusPillProps['tone']>, string> = {
  neutral: 'bg-rd-bg text-rd-label-secondary',
  positive: 'bg-rd-positive/12 text-rd-positive',
  caution: 'bg-rd-caution/14 text-rd-caution',
  accent: 'bg-rd-accent/12 text-rd-accent',
};

export function StatusPill({ children, tone = 'neutral', onClick, className }: StatusPillProps) {
  const interactive = Boolean(onClick);
  const Comp = interactive ? 'button' : 'span';
  return (
    <Comp
      type={interactive ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'inline-flex min-h-7 items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-medium',
        TONE_CLASS[tone],
        interactive && 'cursor-pointer transition-opacity hover:opacity-80',
        className,
      )}
    >
      {children}
    </Comp>
  );
}
