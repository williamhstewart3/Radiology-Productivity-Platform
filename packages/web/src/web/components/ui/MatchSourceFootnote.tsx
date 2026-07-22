import type { MatchMethod } from '../../types';
import { cn } from '@/lib/utils';

const LABEL: Record<MatchMethod, string> = {
  alias_match: 'Learned alias',
  manual_name_match: 'Learned alias',
  manual_cpt: 'Direct CPT',
  radiology_match: 'Protocol match',
  ocr_match: 'Close description match',
  unmatched: 'Unmatched',
};

interface MatchSourceFootnoteProps {
  method: MatchMethod;
  /** Present only for alias-backed matches; tapping opens that alias for view/edit. */
  onOpenAlias?: () => void;
  className?: string;
}

/** Explainable-matching footnote — names where a matched row's confidence came from. */
export function MatchSourceFootnote({ method, onOpenAlias, className }: MatchSourceFootnoteProps) {
  const label = LABEL[method];
  const isAlias = method === 'alias_match' || method === 'manual_name_match';

  if (isAlias && onOpenAlias) {
    return (
      <button
        type="button"
        onClick={onOpenAlias}
        className={cn('text-[13px] text-rd-accent underline-offset-2 hover:underline', className)}
      >
        {label}
      </button>
    );
  }

  return <span className={cn('text-[13px] text-rd-label-secondary', className)}>{label}</span>;
}
