/**
 * matching.ts
 *
 * CPT matching for radiologist productivity tracking.
 *
 * PROFESSIONAL-COMPONENT ONLY
 * ─────────────────────────────
 * This application tracks physician work RVUs only. Technical-component
 * (TC) rows are NEVER returned as match candidates. The filter logic:
 *
 *   • pcTcIndicator === 'technical'  → always excluded
 *   • pcTcIndicator === 'global'     → included (code has no TC split;
 *                                      the radiologist bills the full value,
 *                                      e.g. most MRI brain, CT head codes at
 *                                      hospital-based practices)
 *   • pcTcIndicator === 'professional' → included (explicit 26-modifier row)
 *   • pcTcIndicator === 'na'         → included (supervision, management, etc.)
 *
 * When a CPT has BOTH a global row AND a 26-modifier row, `pickBestRow()`
 * prefers the explicit '26' modifier row — the radiologist is billing
 * professional component only in a split-billing arrangement.
 *
 * ALIAS-FIRST LEARNING
 * ─────────────────────
 * Every user-confirmed mapping is saved to the examAliases table. On the next
 * import, exact normalized matches auto-assign at confidence 0.97 — no review
 * prompt. Fuzzy alias hits surface first in the candidate list. Only when no
 * alias exists does the matcher fall through to CMS description fuzzy search.
 *
 * FUTURE SOURCES: PowerScribe API, PACS, CSV — all funnel through
 * findMatchCandidates() and benefit from previously learned aliases.
 */

import { db } from '../db/database';
import type { CptRvuRow, ExamAlias, MatchCandidate } from '../types';
import { combinedSimilarity, normalizeExamText } from './textMatching';

const CPT_CODE_PATTERN = /^[0-9]{4,5}[A-Z]?$/i;

// ─── Professional-only row filter ────────────────────────────────────────────

/**
 * Returns true for rows a radiologist can legitimately bill as work RVU.
 * Excludes technical-component (TC) rows entirely.
 */
function isProfessionalRow(row: CptRvuRow): boolean {
  return row.pcTcIndicator !== 'technical';
}

// ─── Core matcher ────────────────────────────────────────────────────────────

/**
 * Match a raw exam name (or direct CPT code) against:
 *   1. Direct CPT code entry
 *   2. examAliases — exact normalized match (auto-accept quality)
 *   3. examAliases — fuzzy match
 *   4. CPT RVU table descriptions — fuzzy, professional rows only
 *
 * Returns ranked candidates. Never auto-selects — caller decides threshold.
 */
export async function findMatchCandidates(
  rawInput: string,
  maxResults = 5,
): Promise<MatchCandidate[]> {
  const trimmed = rawInput.trim();
  if (!trimmed) return [];

  const candidates: MatchCandidate[] = [];

  // ── 1. Direct CPT code entry ──────────────────────────────────────────────
  if (CPT_CODE_PATTERN.test(trimmed)) {
    const directMatches = await db.cptRvuTable
      .where('cptCode')
      .equals(trimmed.toUpperCase())
      .toArray();

    const professionalMatches = directMatches.filter(isProfessionalRow);
    for (const row of professionalMatches) {
      candidates.push(rowToCandidate(row, 1.0, 'manual_cpt'));
    }
    if (candidates.length > 0) {
      // For a direct CPT entry, prefer the 26-modifier row if both exist
      const sorted = sortByProfessionalPreference(candidates);
      return sorted.slice(0, maxResults);
    }
  }

  const normalizedInput = normalizeExamText(trimmed);

  // ── 2. Alias table — exact normalized match ───────────────────────────────
  // High-confidence auto-match: user confirmed this exact mapping before.
  const allAliases = await db.examAliases.toArray();
  const exactAlias = allAliases.find((a) => a.aliasText === normalizedInput);
  if (exactAlias) {
    const rows = await db.cptRvuTable
      .where('cptCode')
      .equals(exactAlias.cptCode)
      .toArray();
    const row = pickBestRow(rows.filter(isProfessionalRow), exactAlias.modifier);
    if (row) {
      // Exact alias match = highest confidence; no review needed
      candidates.push(rowToCandidate(row, 0.97, 'alias_match'));
    }
  }

  // ── 3. Alias table — fuzzy match ─────────────────────────────────────────
  const fuzzyAliasScored = allAliases
    .map((alias) => ({ alias, score: combinedSimilarity(trimmed, alias.aliasTextRaw) }))
    .filter((x) => x.score >= 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);

  for (const { alias, score } of fuzzyAliasScored) {
    if (candidates.some((c) => c.cptCode === alias.cptCode)) continue;
    const rows = await db.cptRvuTable
      .where('cptCode')
      .equals(alias.cptCode)
      .toArray();
    const row = pickBestRow(rows.filter(isProfessionalRow), alias.modifier);
    if (row) {
      candidates.push(rowToCandidate(row, score * 0.9, 'alias_match'));
    }
  }

  // ── 4. CMS description fuzzy — professional rows only ────────────────────
  if (candidates.length < maxResults) {
    const allCpt = await db.cptRvuTable
      .where('statusCategory')
      .anyOf(['active', 'restricted'])
      .toArray();

    // Professional-only filter
    const professionalCpt = allCpt.filter(isProfessionalRow);

    const descScored = professionalCpt
      .map((row) => ({ row, score: combinedSimilarity(trimmed, row.description) }))
      .filter((x) => x.score >= 0.35)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults * 2); // extra headroom before dedup

    for (const { row, score } of descScored) {
      if (candidates.some((c) => c.cptCode === row.cptCode && c.modifier === row.modifier)) {
        continue;
      }
      candidates.push(rowToCandidate(row, score, 'manual_name_match'));
      if (candidates.length >= maxResults) break;
    }
  }

  candidates.sort((a, b) => b.confidence - a.confidence);
  return candidates.slice(0, maxResults);
}

// ─── Row selection ───────────────────────────────────────────────────────────

/**
 * From a set of professional rows for a given CPT code, pick the best one:
 *   1. Explicit '26' modifier row (radiologist in split-billing arrangement)
 *   2. Row matching the alias's saved modifier
 *   3. Global (no modifier) row — code has no TC split, radiologist takes full value
 *   4. Any remaining professional row
 *
 * Technical ('TC') rows are never in the input here — filtered before calling.
 */
function pickBestRow(rows: CptRvuRow[], preferredModifier: string | null): CptRvuRow | undefined {
  if (rows.length === 0) return undefined;

  // Prefer explicit professional-component modifier
  const mod26 = rows.find((r) => r.modifier === '26');
  if (mod26) return mod26;

  // Honor alias's saved modifier if present
  if (preferredModifier) {
    const exact = rows.find((r) => r.modifier === preferredModifier);
    if (exact) return exact;
  }

  // Global row (no modifier) — code doesn't have a TC split
  const global = rows.find((r) => r.modifier === null);
  if (global) return global;

  return rows[0];
}

/**
 * Sort candidates so explicit professional-component (modifier '26') rows
 * rank above global rows, which rank above anything else — preserving the
 * confidence ordering within each tier.
 */
function sortByProfessionalPreference(candidates: MatchCandidate[]): MatchCandidate[] {
  return [...candidates].sort((a, b) => {
    const tier = (c: MatchCandidate) =>
      c.modifier === '26' ? 0 : c.modifier === null ? 1 : 2;
    const tierDiff = tier(a) - tier(b);
    if (tierDiff !== 0) return tierDiff;
    return b.confidence - a.confidence;
  });
}

// ─── Candidate builder ───────────────────────────────────────────────────────

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

// ─── Alias learning ──────────────────────────────────────────────────────────

/**
 * Saves a confirmed exam-name → CPT mapping to the alias table.
 *
 * Called after every user-confirmed import. On the next import:
 *   • Exact normalized match → auto-assigns at 0.97 confidence, no review prompt
 *   • Fuzzy match → surfaces as top candidate
 *
 * Works for all import sources: paste, OCR, CSV, PowerScribe API.
 */
export async function learnAlias(
  rawText: string,
  cptCode: string,
  modifier: string | null,
  source: ExamAlias['source'],
): Promise<void> {
  const normalized = normalizeExamText(rawText);
  const existing = await db.examAliases.where('aliasText').equals(normalized).first();

  const now = new Date().toISOString();

  if (existing) {
    await db.examAliases.update(existing.id, {
      cptCode,
      modifier,
      timesUsed: existing.timesUsed + 1,
      lastUsedAt: now,
      // Confidence creeps toward 1.0 as the mapping is reconfirmed
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
    matchConfidence: 0.90,
    source,
    timesUsed: 1,
    lastUsedAt: now,
    createdAt: now,
  });
}
