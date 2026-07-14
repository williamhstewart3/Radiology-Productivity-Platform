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
import type { CptRvuRow, ExamDictionaryEntry, MatchCandidate, MatchMethod } from '../types';

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

export function searchKnownTitleCandidates(
  entries: ExamDictionaryEntry[],
  professionalRows: CptRvuRow[],
  query: string,
  limit = 12,
): MatchCandidate[] {
  const q = query.trim();
  if (!q) return [];
  const searchTemplate = professionalRows[0];
  if (!searchTemplate) return [];
  const rowsByCode = new Map(professionalRows.map((row) => [row.cptCode, row]));
  const ranked = entries
    .map((entry) => {
      const names = [entry.canonicalDisplayName, ...entry.commonSynonyms, ...entry.hospitalAliases, ...entry.powerScribeNames];
      const score = Math.max(...names.map((name) => tokenScore({ ...searchTemplate, cptCode: '', description: name }, q)));
      return { entry, score, tier: entry.source === 'institution' ? 2 : 1 };
    })
    .filter(({ score }) => score >= CPT_SEARCH_SCORE_FLOOR)
    .sort((a, b) => b.tier - a.tier || b.score - a.score);

  const candidates: MatchCandidate[] = [];
  const seen = new Set<string>();
  for (const { entry } of ranked) {
    for (const serialized of entry.cptCodes) {
      const cptCode = serialized.split('-')[0]?.trim();
      const row = cptCode ? rowsByCode.get(cptCode) : undefined;
      if (!row || seen.has(row.cptCode)) continue;
      seen.add(row.cptCode);
      candidates.push({
        ...cptRowToCandidate(row, 'manual_name_match'),
        description: entry.canonicalDisplayName,
      });
      if (candidates.length >= limit) return candidates;
    }
  }
  return candidates;
}

export function candidateKey(candidate: Pick<MatchCandidate, 'cptCode' | 'modifier'>): string {
  return `${candidate.cptCode}:${candidate.modifier ?? 'none'}`;
}
