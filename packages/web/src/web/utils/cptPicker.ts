/**
 * cptPicker.ts
 *
 * Search plumbing shared by the Inbox "Change code" picker and every other
 * CPT search surface (CommandPalette, Codes.tsx quick-log). Deliberately
 * thin: dedupes the CPT table to one professional (billable, non-technical)
 * row per code via pickProfessionalRow, then scores/filters/sorts with
 * tokenScore -- the exact same functions, not a reimplementation, so
 * results are identical by construction rather than by convention.
 */

import { pickProfessionalRow, tokenScore } from '../pages/CptExplorer';
import type { CptRvuRow, MatchCandidate, MatchMethod } from '../types';

/** Same bar Codes.tsx uses: tokenScore's low end (a single fuzzy token hit) is fine when a filter has already narrowed the set, but an open search with no filter needs a much stronger signal. */
export const CPT_SEARCH_SCORE_FLOOR = 60;
export const CPT_SEARCH_RESULT_LIMIT = 30;

export function professionalCptRows(rawRows: CptRvuRow[]): CptRvuRow[] {
  const byCode = new Map<string, CptRvuRow[]>();
  for (const row of rawRows) {
    if (row.pcTcIndicator === 'technical' || (row.workRvu ?? 0) <= 0) continue;
    byCode.set(row.cptCode, [...(byCode.get(row.cptCode) ?? []), row]);
  }
  return [...byCode.values()].map(pickProfessionalRow).filter((row): row is CptRvuRow => Boolean(row));
}

export function searchCptRows(professionalRows: CptRvuRow[], query: string, limit = CPT_SEARCH_RESULT_LIMIT): CptRvuRow[] {
  const q = query.trim();
  if (!q) return [];
  return professionalRows
    .map((row) => ({ row, score: tokenScore(row, q) }))
    .filter(({ score }) => score >= CPT_SEARCH_SCORE_FLOOR)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ row }) => row);
}

export function cptRowToCandidate(row: CptRvuRow, method: MatchMethod = 'manual_cpt'): MatchCandidate {
  return {
    cptCode: row.cptCode,
    modifier: row.modifier,
    description: row.description,
    workRvu: row.workRvu,
    modality: row.modality,
    confidence: 1,
    method,
  };
}

export function candidateKey(candidate: Pick<MatchCandidate, 'cptCode' | 'modifier'>): string {
  return `${candidate.cptCode}:${candidate.modifier ?? 'none'}`;
}
