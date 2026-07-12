import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface CardProps {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}

export function Card({ children, className, onClick }: CardProps) {
  const cardClassName = cn('rounded-[16px] bg-rd-surface p-4 text-left', className);
  const style = { boxShadow: 'var(--rd-shadow-card)' };

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(cardClassName, 'min-h-11 w-full cursor-pointer transition-transform active:scale-[0.99]')}
        style={style}
      >
        {children}
      </button>
    );
  }

  return (
    <div className={cardClassName} style={style}>
      {children}
    </div>
  );
}
