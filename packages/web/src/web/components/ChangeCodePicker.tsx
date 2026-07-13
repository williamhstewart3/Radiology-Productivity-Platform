/**
 * ChangeCodePicker.tsx
 *
 * The Inbox's Change code (E) action: a search-first, multi-select CPT
 * picker. Matcher candidates render up top labeled "Suggested"; a focused
 * search field underneath searches the same open CPT library the command
 * palette and Codes.tsx quick-log use (identical tokenScore/
 * pickProfessionalRow functions -- not a reimplementation, so results can't
 * drift from those surfaces). Chosen codes render as removable chips with a
 * live wRVU sum; committing feeds the existing selection path, which is
 * already multi-CPT-aware (commitPipelineResults and learnAlias both
 * iterate the full candidate set, not a single index).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import { Sheet } from './ui/Sheet';
import { candidateKey, cptRowToCandidate, professionalCptRows, searchCptRows } from '../utils/cptPicker';
import type { PipelineReviewRow } from '../pipeline/importPipeline';
import type { CptRvuRow, MatchCandidate } from '../types';
import { MODALITY_LABELS } from '../types';

interface PickerRow {
  candidate: MatchCandidate;
  /** Confidence percent shown for Suggested rows; search/recent rows don't carry the matcher's confidence. */
  confidencePercent?: number;
}

export function ChangeCodePicker({ open, row, onClose, onCommit }: {
  open: boolean;
  row: PipelineReviewRow | null;
  onClose: () => void;
  onCommit: (candidates: MatchCandidate[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<MatchCandidate[]>([]);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || !row) return;
    setQuery('');
    setSelected(row.candidates.filter((_, index) =>
      (row.selectedCandidateIndices?.length ? row.selectedCandidateIndices : row.selectedCandidateIndex == null ? [] : [row.selectedCandidateIndex]).includes(index),
    ));
    setHighlightIndex(0);
    requestAnimationFrame(() => searchRef.current?.focus());
  }, [open, row]);

  const rawRows = useLiveQuery(() => db.cptRvuTable.where('statusCategory').equals('active').toArray(), [], [] as CptRvuRow[]);
  const professionalRows = useMemo(() => professionalCptRows(rawRows), [rawRows]);

  const recentAliases = useLiveQuery(() => db.examAliases.orderBy('lastUsedAt').reverse().limit(8).toArray(), [], []);
  const recentRows = useMemo(() => {
    const seen = new Set<string>();
    const rows: CptRvuRow[] = [];
    for (const alias of recentAliases) {
      if (seen.has(alias.cptCode)) continue;
      const found = professionalRows.find((r) => r.cptCode === alias.cptCode);
      if (found) { rows.push(found); seen.add(alias.cptCode); }
    }
    return rows;
  }, [recentAliases, professionalRows]);

  const searchResults = useMemo(() => searchCptRows(professionalRows, query), [professionalRows, query]);

  const suggested: PickerRow[] = useMemo(
    () => (row?.candidates ?? []).map((candidate) => ({ candidate, confidencePercent: Math.round(candidate.confidence * 100) })),
    [row],
  );
  const browseRows: PickerRow[] = useMemo(
    () => (query.trim() ? searchResults : recentRows).map((cptRow) => ({ candidate: cptRowToCandidate(cptRow) })),
    [query, searchResults, recentRows],
  );
  const flat = useMemo(() => [...suggested, ...browseRows], [suggested, browseRows]);

  const selectedKeys = useMemo(() => new Set(selected.map(candidateKey)), [selected]);
  const totalWrvu = useMemo(() => selected.reduce((sum, candidate) => sum + (candidate.workRvu ?? 0), 0), [selected]);

  function toggle(candidate: MatchCandidate) {
    const key = candidateKey(candidate);
    setSelected((prev) => (prev.some((c) => candidateKey(c) === key) ? prev.filter((c) => candidateKey(c) !== key) : [...prev, candidate]));
  }

  function removeLastChip() {
    setSelected((prev) => prev.slice(0, -1));
  }

  function commit() {
    if (selected.length === 0) return;
    onCommit(selected);
    onClose();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightIndex((index) => Math.min(flat.length - 1, index + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightIndex((index) => Math.max(0, index - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (event.metaKey || event.ctrlKey) {
        const highlightedCandidate = flat[highlightIndex]?.candidate;
        const finalSelection = highlightedCandidate && !selectedKeys.has(candidateKey(highlightedCandidate))
          ? [...selected, highlightedCandidate]
          : selected;
        if (finalSelection.length > 0) {
          onCommit(finalSelection);
          onClose();
        }
        return;
      }
      if (flat[highlightIndex]) toggle(flat[highlightIndex].candidate);
    } else if (event.key === 'Backspace' && query === '') {
      removeLastChip();
    }
  }

  if (!row) return null;

  return (
    <Sheet open={open} onClose={onClose} title="Change code" className="max-w-lg">
      <div className="space-y-3">
        {selected.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 rounded-[10px] bg-rd-surface-2 p-2">
            {selected.map((candidate) => (
              <span key={candidateKey(candidate)} className="flex items-center gap-1 rounded-full bg-rd-surface px-2.5 py-1 font-mono text-[12px] text-rd-label-primary">
                {candidate.cptCode} · {candidate.workRvu?.toFixed(2) ?? '—'}
                <button type="button" onClick={() => toggle(candidate)} aria-label={`Remove ${candidate.cptCode}`} className="ml-0.5 text-rd-label-secondary hover:text-rd-label-primary">×</button>
              </span>
            ))}
            <span className="ml-auto text-[12px] font-semibold text-rd-label-primary [font-variant-numeric:tabular-nums]">{totalWrvu.toFixed(2)} wRVU</span>
          </div>
        )}

        <input
          ref={searchRef}
          value={query}
          onChange={(event) => { setQuery(event.target.value); setHighlightIndex(0); }}
          onKeyDown={handleKeyDown}
          aria-label="Search CPT codes by name or code"
          placeholder="Search by name or CPT code"
          className="h-11 w-full rounded-[10px] bg-rd-surface-2 px-3 text-[15px] text-rd-label-primary outline-none"
        />

        <div className="max-h-[50vh] space-y-3 overflow-y-auto">
          {suggested.length > 0 && (
            <div>
              <p className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-rd-label-secondary">Suggested</p>
              <div className="space-y-1">
                {suggested.map((item, index) => (
                  <PickerRowButton
                    key={candidateKey(item.candidate)}
                    item={item}
                    highlighted={index === highlightIndex}
                    checked={selectedKeys.has(candidateKey(item.candidate))}
                    onClick={() => toggle(item.candidate)}
                  />
                ))}
              </div>
            </div>
          )}

          <div>
            {!query.trim() && recentRows.length > 0 && (
              <p className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-rd-label-secondary">Recent</p>
            )}
            <div className="space-y-1">
              {browseRows.length === 0 && query.trim() && (
                <p className="px-1 py-2 text-[13px] text-rd-label-secondary">No matches — try a CPT code or a different term</p>
              )}
              {browseRows.map((item, index) => (
                <PickerRowButton
                  key={candidateKey(item.candidate)}
                  item={item}
                  highlighted={suggested.length + index === highlightIndex}
                  checked={selectedKeys.has(candidateKey(item.candidate))}
                  onClick={() => toggle(item.candidate)}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-rd-separator pt-3">
          <p className="text-[12px] text-rd-label-secondary">↵ toggle · ⌘↵ done · Esc cancel</p>
          <button
            type="button"
            onClick={commit}
            disabled={selected.length === 0}
            className="min-h-11 rounded-[10px] bg-rd-label-primary px-4 text-[14px] font-semibold text-rd-bg disabled:opacity-40"
          >
            Done{selected.length > 0 ? ` (${selected.length})` : ''}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

function PickerRowButton({ item, highlighted, checked, onClick }: { item: PickerRow; highlighted: boolean; checked: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-[10px] px-3 text-left text-[13px] ${highlighted ? 'bg-rd-surface-2 ring-1 ring-rd-label-primary' : 'hover:bg-rd-surface-2'} ${checked ? 'text-rd-label-primary' : 'text-rd-label-primary'}`}
    >
      <span className="flex min-w-0 items-center gap-2">
        {checked && <span aria-hidden="true" className="shrink-0 text-rd-positive">✓</span>}
        <span className="min-w-0">
          <span className="block truncate">{item.candidate.description}</span>
          <span className="font-mono text-[11px] text-rd-label-secondary">{item.candidate.cptCode}{item.candidate.modifier ? `-${item.candidate.modifier}` : ''} · {MODALITY_LABELS[item.candidate.modality]}</span>
        </span>
      </span>
      <span className="shrink-0 text-[12px] text-rd-label-secondary [font-variant-numeric:tabular-nums]">
        {item.confidencePercent != null ? `${item.confidencePercent}% · ` : ''}{item.candidate.workRvu?.toFixed(2) ?? '—'}
      </span>
    </button>
  );
}
