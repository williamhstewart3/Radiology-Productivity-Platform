import { cn } from '@/lib/utils';

export type ReadoutTone = 'neutral' | 'positive' | 'caution' | 'negative' | 'reached';

export interface ReadoutPart {
  text: string;
  tone?: ReadoutTone;
}

const toneClass: Record<ReadoutTone, string> = {
  neutral: 'text-rd-label-primary',
  positive: 'text-rd-positive',
  caution: 'text-rd-caution',
  negative: 'text-rd-negative',
  reached: 'text-rd-reached',
};

export function Readout({ parts, className }: { parts: ReadoutPart[]; className?: string }) {
  return (
    <p
      className={cn(
        'flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[22px] font-semibold leading-tight text-rd-label-primary sm:text-[34px]',
        className,
      )}
      aria-label={parts.map((part) => part.text).join(', ')}
    >
      {parts.map((part, index) => (
        <span key={`${part.text}-${index}`} className="contents">
          {index > 0 && <span aria-hidden="true" className="text-rd-label-secondary">·</span>}
          <span className={cn(toneClass[part.tone ?? 'neutral'], '[font-variant-numeric:tabular-nums]')}>
            {part.text}
          </span>
        </span>
      ))}
    </p>
  );
}
