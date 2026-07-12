import { useEffect, useState } from 'react';
import type { PipelineReviewRow } from '../pipeline/importPipeline';
import { confidencePhrase } from '../services/inboxService';
import { KeyHint } from './ui/KeyHint';

export function AttentionCard({ row, active, onAccept, onSkip, onChangeCode, expandRequest }: {
  row: PipelineReviewRow;
  active: boolean;
  onAccept: () => void;
  onSkip: () => void;
  onChangeCode: (index: number) => void;
  expandRequest?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const selectedIndex = row.selectedCandidateIndex ?? row.selectedCandidateIndices?.[0] ?? null;
  const candidate = selectedIndex == null ? row.candidates[0] : row.candidates[selectedIndex];
  const phrase = confidencePhrase(candidate?.method, Boolean(candidate));
  useEffect(() => { if (expandRequest) setExpanded(true); }, [expandRequest]);

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
        </div>
      ) : (
        <div className="space-y-3">
          <p className="font-mono text-[15px] text-rd-label-secondary">“{row.source.procedureName ?? row.source.examTitle}”</p>
          <div>
            <p className="text-[22px] font-semibold text-rd-label-primary">{candidate?.description ?? 'Choose a code'}</p>
            <p className="font-mono text-[15px] text-rd-label-secondary">{candidate ? `${candidate.cptCode} · ${candidate.workRvu?.toFixed(2) ?? '—'} wRVU` : 'No CPT selected'}</p>
          </div>
          <button type="button" onClick={() => setExpanded((value) => !value)} className="min-h-11 text-left text-[13px] font-medium text-rd-caution" aria-expanded={expanded}>
            {phrase} {expanded ? '⌃' : '⌄'}
          </button>
        </div>
      )}

      {expanded && (
        <div className="mt-3 space-y-2 border-t border-rd-separator pt-3">
          <p className="text-[12px] text-rd-label-secondary">Raw: {row.source.parserRawLine ?? row.source.cleanedText ?? row.source.examTitle}</p>
          {row.candidates.map((option, index) => (
            <button key={`${option.cptCode}-${index}`} type="button" onClick={() => onChangeCode(index)} className="flex min-h-11 w-full items-center justify-between rounded-[10px] bg-rd-surface-2 px-3 text-left text-[13px] text-rd-label-primary">
              <span>{option.cptCode} · {option.description}</span><span>{Math.round(option.confidence * 100)}%</span>
            </button>
          ))}
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button type="button" onClick={row.duplicateStatus === 'possible' ? onSkip : onAccept} disabled={!candidate && row.duplicateStatus !== 'possible'} className="min-h-11 rounded-[10px] bg-rd-label-primary px-5 text-[15px] font-semibold text-rd-bg disabled:opacity-40">
          {row.duplicateStatus === 'possible' ? 'Same study — skip' : '✓ Accept'} <KeyHint>↵</KeyHint>
        </button>
        {row.duplicateStatus === 'possible'
          ? <button type="button" onClick={onAccept} className="min-h-11 px-2 text-[15px] text-rd-label-primary">Count both</button>
          : <button type="button" onClick={() => setExpanded(true)} className="min-h-11 px-2 text-[15px] text-rd-label-primary">Change code <KeyHint>E</KeyHint></button>}
        <button type="button" onClick={onSkip} className="min-h-11 px-2 text-[15px] text-rd-label-secondary">Skip <KeyHint>S</KeyHint></button>
      </div>
    </article>
  );
}
