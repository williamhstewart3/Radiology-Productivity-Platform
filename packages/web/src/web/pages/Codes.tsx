/**
 * Codes.tsx
 *
 * Search-first CPT Explorer per the UI modernization spec. Reuses
 * CptExplorer's search-scoring logic (tokenScore/pickProfessionalRow) rather
 * than duplicating it — this file is presentation, not new matching logic.
 * The old CptExplorer (filters, body-region browse, multi-select log queue)
 * stays reachable as a secondary "Browse" link, not replaced.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import { useOrg } from '../hooks/useOrg';
import { todayDateString } from '../utils/calculations';
import { logConfirmedStudy } from '../utils/manualLog';
import { tokenScore, pickProfessionalRow } from './CptExplorer';
import { GroupedList, Row } from '../components/ui/GroupedList';
import { Sheet } from '../components/ui/Sheet';
import type { CptRvuRow, ExamAlias } from '../types';
import { MODALITY_LABELS } from '../types';

interface CodesProps {
  onNavigate: (path: string) => void;
}

export function Codes({ onNavigate }: CodesProps) {
  const { activeProfile } = useOrg();
  const profileId = activeProfile?.id ?? null;
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<CptRvuRow | null>(null);
  const [added, setAdded] = useState(false);
  const [adding, setAdding] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const rawRows = useLiveQuery(
    () =>
      db.cptRvuTable
        .where('statusCategory')
        .equals('active')
        .filter((row) => row.pcTcIndicator !== 'technical' && (row.workRvu ?? 0) > 0)
        .toArray(),
    [],
    [],
  );

  const professionalRows = useMemo(() => {
    const byCode = new Map<string, CptRvuRow[]>();
    for (const row of rawRows) {
      byCode.set(row.cptCode, [...(byCode.get(row.cptCode) ?? []), row]);
    }
    return [...byCode.values()].map(pickProfessionalRow).filter((r): r is CptRvuRow => Boolean(r));
  }, [rawRows]);

  const recentAliases = useLiveQuery(
    () => db.examAliases.orderBy('lastUsedAt').reverse().limit(8).toArray(),
    [],
    [],
  );

  const recentRows = useMemo(() => {
    const seen = new Set<string>();
    const rows: CptRvuRow[] = [];
    for (const alias of recentAliases) {
      if (seen.has(alias.cptCode)) continue;
      const row = professionalRows.find((r) => r.cptCode === alias.cptCode);
      if (row) {
        rows.push(row);
        seen.add(alias.cptCode);
      }
    }
    return rows;
  }, [recentAliases, professionalRows]);

  const results = useMemo(() => {
    const q = query.trim();
    if (!q) return [];
    return professionalRows
      .map((row) => ({ row, score: tokenScore(row, q) }))
      // tokenScore gives partial credit for a single fuzzy token hit (as low
      // as 24) — fine when a modality/anatomy filter has already narrowed the
      // set (CptExplorer's browse view), but this search has no filters, so
      // a low bar surfaces mostly-irrelevant rows. Require a much stronger
      // signal: an exact/prefix code match, a real substring hit, or most
      // of the query's tokens present.
      .filter(({ score }) => score >= 60)
      .sort((a, b) => b.score - a.score)
      .slice(0, 30)
      .map(({ row }) => row);
  }, [professionalRows, query]);

  const aliasesForSelected = useLiveQuery(
    async () => {
      if (!selected) return [] as ExamAlias[];
      return db.examAliases.where('cptCode').equals(selected.cptCode).toArray();
    },
    [selected?.cptCode],
    [],
  );

  const versionsForSelected = useLiveQuery(
    async () => {
      if (!selected) return [] as CptRvuRow[];
      const all = await db.cptRvuTable.where('cptCode').equals(selected.cptCode).toArray();
      return all.filter((row) => row.modifier === selected.modifier);
    },
    [selected?.cptCode, selected?.modifier],
    [],
  );

  async function handleAddToToday(row: CptRvuRow) {
    setAdding(true);
    try {
      await logConfirmedStudy({
        examTitle: row.description,
        candidate: {
          cptCode: row.cptCode,
          modifier: row.modifier,
          description: row.description,
          workRvu: row.workRvu,
          modality: row.modality,
          confidence: 1,
          method: 'manual_cpt',
        },
        logDate: todayDateString(),
        profileId,
      });
      setAdded(true);
      setTimeout(() => {
        setSelected(null);
        setAdded(false);
        onNavigate('/today');
      }, 700);
    } finally {
      setAdding(false);
    }
  }

  const listRows = query.trim() ? results : recentRows;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-[34px] font-bold leading-tight text-rd-label-primary">Codes</h1>

      <input
        ref={searchRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search by name or CPT code"
        placeholder="Search by name or CPT code"
        className="h-12 w-full rounded-[12px] bg-rd-surface px-4 text-[17px] text-rd-label-primary outline-none"
        style={{ boxShadow: 'var(--rd-shadow-card)' }}
      />

      <GroupedList header={query.trim() ? undefined : (recentRows.length > 0 ? 'Recent' : undefined)}>
        {listRows.length === 0 && (
          <Row footnote={query.trim() ? 'Try a CPT code or a different term' : 'Search to get started'}>
            No results
          </Row>
        )}
        {listRows.map((row) => (
          <Row
            key={`${row.cptCode}-${row.modifier ?? 'none'}`}
            onClick={() => setSelected(row)}
            footnote={`${row.cptCode}${row.modifier ? `-${row.modifier}` : ''} · ${MODALITY_LABELS[row.modality]}`}
            trailing={<span className="[font-variant-numeric:tabular-nums]">{row.workRvu?.toFixed(2)}</span>}
          >
            {row.description}
          </Row>
        ))}
      </GroupedList>

      <button
        type="button"
        onClick={() => onNavigate('/codes/browse')}
        className="text-[15px] font-medium text-rd-accent"
      >
        Browse by body part →
      </button>

      <Sheet open={Boolean(selected)} onClose={() => setSelected(null)} title={selected?.description}>
        {selected && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[15px] font-semibold text-rd-label-primary">
                {selected.cptCode}{selected.modifier ? `-${selected.modifier}` : ''}
              </span>
              <span className="text-[17px] font-semibold text-rd-label-primary [font-variant-numeric:tabular-nums]">
                {selected.workRvu?.toFixed(2)} wRVU
              </span>
            </div>

            {versionsForSelected.length > 1 && new Set(versionsForSelected.map((v) => v.workRvu)).size > 1 && (
              <div>
                <p className="mb-1 text-[13px] text-rd-label-secondary">wRVU by CMS year</p>
                <div className="space-y-1">
                  {versionsForSelected.map((v) => (
                    <div key={v.id} className="flex justify-between text-[13px] text-rd-label-primary">
                      <span>{v.rvuFileVersion}</span>
                      <span className="[font-variant-numeric:tabular-nums]">{v.workRvu?.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {aliasesForSelected.length > 0 && (
              <div>
                <p className="mb-1 text-[13px] text-rd-label-secondary">Aliases</p>
                <div className="flex flex-wrap gap-1.5">
                  {aliasesForSelected.map((alias) => (
                    <span key={alias.id} className="rounded-[6px] bg-rd-bg px-1.5 py-0.5 text-[12px] text-rd-label-secondary">
                      {alias.aliasTextRaw}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={() => handleAddToToday(selected)}
              disabled={adding || added}
              className="min-h-11 w-full rounded-[10px] text-[15px] font-semibold text-white disabled:opacity-60"
              style={{ background: added ? 'var(--rd-positive)' : 'var(--rd-accent)' }}
            >
              {adding ? 'Adding…' : added ? 'Added' : 'Add to today'}
            </button>
          </div>
        )}
      </Sheet>
    </div>
  );
}
