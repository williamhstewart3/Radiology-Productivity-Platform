import { useEffect, useState } from 'react';
import { selectedCandidatesForRow, type PipelineReviewRow } from '../pipeline/importPipeline';
import { confidencePhrase } from '../services/inboxService';
import type { ImportSource } from '../types/importProvider';
import { KeyHint } from './ui/KeyHint';

const SOURCE_LABELS: Record<ImportSource, string> = {
  ocr: 'Screenshot',
  csv: 'CSV',
  manual: 'Manual',
  powerscribe: 'PowerScribe',
};

function shortTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function AttentionCard({ row, active, onAccept, onSkip, onOpenPicker, expandRequest }: {
  row: PipelineReviewRow;
  active: boolean;
  onAccept: () => void;
  onSkip: () => void;
  onOpenPicker: () => void;
  expandRequest?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const selectedIndex = row.selectedCandidateIndex ?? row.selectedCandidateIndices?.[0] ?? null;
  const candidate = selectedIndex == null ? row.candidates[0] : row.candidates[selectedIndex];
  const selectedCandidates = selectedCandidatesForRow(row);
  const chips = selectedCandidates.length > 0 ? selectedCandidates : candidate ? [candidate] : [];
  const phrase = confidencePhrase(candidate?.method, Boolean(candidate));
  const examTime = shortTime(row.source.studyTime ?? row.source.examDateTime);
  const readTime = shortTime(row.source.modifiedDateTime);
  const sourceLabel = SOURCE_LABELS[row.source.source];
  useEffect(() => { if (expandRequest) onOpenPicker(); }, [expandRequest, onOpenPicker]);
  const chipsWrvu = chips.reduce((sum, option) => sum + (option.workRvu ?? 0), 0);

  return (
    <article className={`rounded-[16px] border bg-rd-surface p-5 ${active ? 'border-rd-caution' : 'border-rd-separator'}`} aria-current={active ? 'true' : undefined}>
      {row.duplicateStatus === 'possible' ? (
        <div className="space-y-4">
          <p className="text-[13px] font-semibold text-rd-caution">Possible duplicate</p>
          <p className="text-[22px] font-semibold text-rd-label-primary">{row.source.procedureName ?? row.source.examTitle}</p>
          <div className="grid grid-cols-2 overflow-hidden rounded-[10px] border border-rd-separator text-[13px]">
            <div className="border-r border-rd-separator p-3"><span className="block text-rd-label-secondary">already counted</span>{row.duplicateReason ?? 'Matching study'}</div>
            <div className="p-3"><span className="block text-rd-label-secondary">this capture</span>{row.source.modifiedDateTime ?? row.source.studyTime ?? 'Time unavailable'}</div>
          </div>
          <p className="text-[12px] text-rd-label-secondary">{sourceLabel}{examTime ? ` · Exam ${examTime}` : ''}{readTime ? ` · Read ${readTime}` : ''}</p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="font-mono text-[15px] text-rd-label-secondary">“{row.source.procedureName ?? row.source.examTitle}”</p>
          <div>
            <p className="text-[22px] font-semibold text-rd-label-primary">{candidate?.description ?? 'Choose a code'}</p>
            {chips.length > 0 ? (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {chips.map((option, index) => (
                  <span key={`${option.cptCode}-${index}`} className="rounded-full bg-rd-surface-2 px-2.5 py-1 font-mono text-[13px] text-rd-label-primary">
                    {option.cptCode} · {option.workRvu?.toFixed(2) ?? '—'}
                  </span>
                ))}
                {chips.length > 1 && (
                  <span className="font-mono text-[13px] font-semibold text-rd-label-primary [font-variant-numeric:tabular-nums]">= {chipsWrvu.toFixed(2)} wRVU</span>
                )}
              </div>
            ) : (
              <p className="font-mono text-[15px] text-rd-label-secondary">No CPT selected</p>
            )}
          </div>
          <p className="text-[12px] text-rd-label-secondary">
            {sourceLabel}{examTime ? ` · Exam ${examTime}` : ''}{readTime ? ` · Read ${readTime}` : ''}
          </p>
          {row.reviewReason && <p className="text-[12px] text-rd-label-secondary">{row.reviewReason}</p>}
          <button type="button" onClick={() => setExpanded((value) => !value)} className="min-h-11 text-left text-[13px] font-medium text-rd-caution" aria-expanded={expanded}>
            {phrase} {expanded ? '⌃' : '⌄'}
          </button>
        </div>
      )}

      {expanded && (
        <div className="mt-3 space-y-2 border-t border-rd-separator pt-3">
          <p className="text-[12px] text-rd-label-secondary">Raw: {row.source.parserRawLine ?? row.source.cleanedText ?? row.source.examTitle}</p>
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button type="button" onClick={row.duplicateStatus === 'possible' ? onSkip : onAccept} disabled={!candidate && row.duplicateStatus !== 'possible'} className="min-h-11 rounded-[10px] bg-rd-label-primary px-5 text-[15px] font-semibold text-rd-bg disabled:opacity-40">
          {row.duplicateStatus === 'possible' ? 'Same study — skip' : '✓ Accept'} <KeyHint>↵</KeyHint>
        </button>
        {row.duplicateStatus === 'possible'
          ? <button type="button" onClick={onAccept} className="min-h-11 px-2 text-[15px] text-rd-label-primary">Count both</button>
          : <button type="button" onClick={onOpenPicker} className="min-h-11 px-2 text-[15px] text-rd-label-primary">Change code <KeyHint>E</KeyHint></button>}
        <button type="button" onClick={onSkip} className="min-h-11 px-2 text-[15px] text-rd-label-secondary">Skip <KeyHint>S</KeyHint></button>
      </div>
    </article>
  );
}
