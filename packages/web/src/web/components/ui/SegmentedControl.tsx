import { cn } from '@/lib/utils';

interface SegmentedControlProps<T extends string> {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

export function SegmentedControl<T extends string>({ options, value, onChange, className }: SegmentedControlProps<T>) {
  return (
    <div
      role="tablist"
      className={cn('inline-flex w-full gap-0.5 rounded-[10px] bg-rd-bg p-0.5', className)}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'min-h-8 flex-1 rounded-[8px] px-3 py-1.5 text-[13px] font-medium transition-colors',
              active ? 'bg-rd-surface text-rd-label-primary shadow-sm' : 'text-rd-label-secondary',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
