import { cn } from '@/lib/utils';
import { Card } from './Card';

interface StatCardProps {
  label: string;
  value: string;
  onClick?: () => void;
  className?: string;
}

/** One number, one label. Never use more than 3 in a row (design rule). */
export function StatCard({ label, value, onClick, className }: StatCardProps) {
  return (
    <Card onClick={onClick} className={cn('flex flex-col gap-1', className)}>
      <span className="text-[28px] font-bold leading-none text-rd-label-primary [font-variant-numeric:tabular-nums]">
        {value}
      </span>
      <span className="text-[13px] text-rd-label-secondary">{label}</span>
    </Card>
  );
}
