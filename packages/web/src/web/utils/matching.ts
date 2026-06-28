import { db } from '../db/database';
import type { CptRvuRow, ExamAlias, MatchCandidate } from '../types';
import { combinedSimilarity, normalizeExamText } from './textMatching';

const CPT_CODE_PATTERN = /^[0-9]{4,5}[A-Z]?$/i;

/**
 * Attempts to match a raw exam name (or directly-entered CPT code) against:
 *   1. Direct CPT code entry (if input looks like a code)
 *   2. exam_aliases table (exact normalized match, then fuzzy)
 *   3. cpt_rvu_table descriptions (fuzzy match)
 *
 * Returns ranked candidates with confidence scores. Never auto-selects —
 * the caller decides what confidence threshold counts as "confirmed".
 */
export async function findMatchCandidates(
  rawInput: string,
  maxResults = 5,
): Promise<MatchCandidate[]> {
  const trimmed = rawInput.trim();
  if (!trimmed) return [];

  const candidates: MatchCandidate[] = [];

  // 1. Direct CPT code entry
  if (CPT_CODE_PATTERN.test(trimmed)) {
    const directMatches = await db.cptRvuTable
      .where('cptCode')
      .equals(trimmed.toUpperCase())
      .toArray();
    for (const row of directMatches) {
      candidates.push(rowToCandidate(row, 1.0, 'manual_cpt'));
    }
    if (candidates.length > 0) {
      return candidates.slice(0, maxResults);
    }
  }

  const normalizedInput = normalizeExamText(trimmed);

  // 2. Alias table — exact normalized match first
  const allAliases = await db.examAliases.toArray();
  const exactAlias = allAliases.find((a) => a.aliasText === normalizedInput);
  if (exactAlias) {
    const rows = await db.cptRvuTable.where('cptCode').equals(exactAlias.cptCode).toArray();
    const row = pickBestRowForModifier(rows, exactAlias.modifier);
    if (row) {
      candidates.push(rowToCandidate(row, Math.max(exactAlias.matchConfidence, 0.95), 'alias_match'));
    }
  }

  // 2b. Alias table — fuzzy match
  const fuzzyAliasScored = allAliases
    .map((alias) => ({ alias, score: combinedSimilarity(trimmed, alias.aliasTextRaw) }))
    .filter((x) => x.score >= 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);

  for (const { alias, score } of fuzzyAliasScored) {
    if (candidates.some((c) => c.cptCode === alias.cptCode)) continue;
    const rows = await db.cptRvuTable.where('cptCode').equals(alias.cptCode).toArray();
    const row = pickBestRowForModifier(rows, alias.modifier);
    if (row) {
      candidates.push(rowToCandidate(row, score * 0.9, 'alias_match'));
    }
  }

  // 3. CMS description fuzzy match (only if we still need more candidates)
  if (candidates.length < maxResults) {
    const allCpt = await db.cptRvuTable
      .where('statusCategory')
      .anyOf(['active', 'restricted'])
      .toArray();

    const descScored = allCpt
      .map((row) => ({ row, score: combinedSimilarity(trimmed, row.description) }))
      .filter((x) => x.score >= 0.35)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults);

    for (const { row, score } of descScored) {
      if (candidates.some((c) => c.cptCode === row.cptCode && c.modifier === row.modifier)) {
        continue;
      }
      candidates.push(rowToCandidate(row, score, 'manual_name_match'));
    }
  }

  candidates.sort((a, b) => b.confidence - a.confidence);
  return candidates.slice(0, maxResults);
}

function pickBestRowForModifier(rows: CptRvuRow[], modifier: string | null): CptRvuRow | undefined {
  if (rows.length === 0) return undefined;
  if (modifier) {
    const exact = rows.find((r) => r.modifier === modifier);
    if (exact) return exact;
  }
  // Prefer global (no modifier) row by default for personal productivity tracking
  return rows.find((r) => r.modifier === null) ?? rows[0];
}

function rowToCandidate(
  row: CptRvuRow,
  confidence: number,
  method: MatchCandidate['method'],
): MatchCandidate {
  return {
    cptCode: row.cptCode,
    modifier: row.modifier,
    description: row.description,
    workRvu: row.workRvu,
    modality: row.modality,
    confidence: Math.min(1, Math.max(0, confidence)),
    method,
  };
}

/** Records a confirmed match as a learned alias for future lookups. */
export async function learnAlias(
  rawText: string,
  cptCode: string,
  modifier: string | null,
  source: ExamAlias['source'],
): Promise<void> {
  const normalized = normalizeExamText(rawText);
  const existing = await db.examAliases.where('aliasText').equals(normalized).first();

  if (existing) {
    await db.examAliases.update(existing.id, {
      cptCode,
      modifier,
      timesUsed: existing.timesUsed + 1,
      lastUsedAt: new Date().toISOString(),
      matchConfidence: Math.min(1, existing.matchConfidence + 0.02),
    });
    return;
  }

  await db.examAliases.add({
    id: crypto.randomUUID(),
    aliasText: normalized,
    aliasTextRaw: rawText,
    cptCode,
    modifier,
    matchConfidence: 0.9,
    source,
    timesUsed: 1,
    lastUsedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  });
}
