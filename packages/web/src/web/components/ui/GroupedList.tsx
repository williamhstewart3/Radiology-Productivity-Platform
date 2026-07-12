import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface GroupedListProps {
  children: ReactNode;
  header?: string;
  footer?: string;
  className?: string;
}

/** iOS Settings-style inset grouped list. Children should be <Row>s. */
export function GroupedList({ children, header, footer, className }: GroupedListProps) {
  return (
    <div className={cn('space-y-1.5', className)}>
      {header && (
        <p className="px-4 text-[13px] font-normal text-rd-label-secondary">{header}</p>
      )}
      <div
        className="overflow-hidden rounded-[16px] bg-rd-surface [&>*+*]:border-t [&>*+*]:border-rd-separator"
        style={{ boxShadow: 'var(--rd-shadow-card)' }}
      >
        {children}
      </div>
      {footer && (
        <p className="px-4 text-[13px] font-normal text-rd-label-secondary">{footer}</p>
      )}
    </div>
  );
}

interface RowProps {
  children: ReactNode;
  trailing?: ReactNode;
  footnote?: string;
  onClick?: () => void;
  className?: string;
}

/** A single row inside a GroupedList. 44px minimum tap target. */
export function Row({ children, trailing, footnote, onClick, className }: RowProps) {
  const rowClassName = cn('flex min-h-11 w-full items-center justify-between gap-3 px-4 py-2.5 text-left', className);
  const content = (
    <>
      <div className="min-w-0 flex-1">
        <div className="text-[17px] font-normal leading-tight text-rd-label-primary">{children}</div>
        {footnote && <p className="mt-0.5 truncate text-[13px] text-rd-label-secondary">{footnote}</p>}
      </div>
      {trailing && <div className="flex shrink-0 items-center gap-2">{trailing}</div>}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(rowClassName, 'cursor-pointer transition-colors hover:bg-rd-bg/40')}
      >
        {content}
      </button>
    );
  }

  return <div className={rowClassName}>{content}</div>;
}
