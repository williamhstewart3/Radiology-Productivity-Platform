import { db } from '../db/database';
import type { CptRvuRow, ExamAlias, MatchCandidate } from '../types';
import { combinedSimilarity, normalizeExamText } from './textMatching';
import { normalizeForRadiology } from './examNormalizer';
import { scoreRadiologyMatch, CONFIDENCE_THRESHOLD } from './examLibrary';

const CPT_CODE_PATTERN = /^[0-9]{4,5}[A-Z]?$/i;

function isProductivityRelevantModifier26(row: CptRvuRow): boolean {
  return row.modifier === '26' && (row.workRvu ?? 0) > 0;
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

function serializeCandidateKey(candidate: Pick<MatchCandidate, 'cptCode' | 'modifier'>): string {
  return candidate.modifier ? `${candidate.cptCode}-${candidate.modifier}` : candidate.cptCode;
}

function parseAliasCode(serialized: string): { cptCode: string; modifier: string | null } {
  const [cptCode, modifier] = serialized.split('-');
  return { cptCode, modifier: modifier ?? null };
}

async function getModifier26Rows(cptCode: string): Promise<CptRvuRow[]> {
  const rows = await db.cptRvuTable.where('cptCode').equals(cptCode.toUpperCase()).toArray();
  return rows.filter(isProductivityRelevantModifier26);
}

async function candidatesForAlias(alias: ExamAlias, confidence: number): Promise<MatchCandidate[]> {
  const serializedCodes = alias.cptCodes?.length
    ? alias.cptCodes
    : [alias.modifier ? `${alias.cptCode}-${alias.modifier}` : alias.cptCode];

  const candidates: MatchCandidate[] = [];
  for (const serialized of serializedCodes) {
    const { cptCode } = parseAliasCode(serialized);
    const rows = await getModifier26Rows(cptCode);
    for (const row of rows) {
      candidates.push(rowToCandidate(row, confidence, 'alias_match'));
    }
  }
  return candidates;
}

function dedupeCandidates(candidates: MatchCandidate[]): MatchCandidate[] {
  const seen = new Set<string>();
  const result: MatchCandidate[] = [];
  for (const candidate of candidates) {
    const key = serializeCandidateKey(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(candidate);
  }
  return result;
}

export async function findMatchCandidates(
  rawInput: string,
  maxResults = 5,
  profileId?: string | null,
): Promise<MatchCandidate[]> {
  const trimmed = rawInput.trim();
  if (!trimmed) return [];

  const candidates: MatchCandidate[] = [];

  if (CPT_CODE_PATTERN.test(trimmed)) {
    const directMatches = await getModifier26Rows(trimmed);
    return directMatches
      .map((row) => rowToCandidate(row, 1.0, 'manual_cpt'))
      .slice(0, maxResults);
  }

  const normalizedInput = normalizeExamText(trimmed);
  const radiologyNorm = normalizeForRadiology(trimmed);
  const radiologyNormalizedKey = normalizeExamText(radiologyNorm.normalizedTitle);

  const allAliases = await db.examAliases.toArray();
  const scopedAliases = allAliases.filter(
    (a) => a.profileId === (profileId ?? null) || a.profileId == null,
  );
  const sortByScope = (aliases: ExamAlias[]) =>
    [...aliases].sort((a, b) => {
      const aOwn = a.profileId === (profileId ?? null) ? 0 : 1;
      const bOwn = b.profileId === (profileId ?? null) ? 0 : 1;
      return aOwn - bOwn;
    });

  const exactAlias =
    sortByScope(scopedAliases.filter((a) => a.aliasText === normalizedInput))[0] ??
    sortByScope(scopedAliases.filter((a) => a.aliasText === radiologyNormalizedKey))[0];

  if (exactAlias) {
    candidates.push(...await candidatesForAlias(exactAlias, 0.97));
  }

  const fuzzyAliasScored = scopedAliases
    .map((alias) => ({ alias, score: combinedSimilarity(trimmed, alias.aliasTextRaw) }))
    .filter((x) => x.score >= 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);

  for (const { alias, score } of fuzzyAliasScored) {
    candidates.push(...await candidatesForAlias(alias, score * 0.9));
  }

  if (candidates.length < maxResults) {
    const allCpt = await db.cptRvuTable
      .where('statusCategory')
      .anyOf(['active', 'restricted'])
      .toArray();

    const descScored = allCpt
      .filter(isProductivityRelevantModifier26)
      .map((row) => ({ row, score: scoreRadiologyMatch(radiologyNorm, row.description) }))
      .filter((x) => x.score >= 0.35)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults * 3);

    for (const { row, score } of descScored) {
      candidates.push(rowToCandidate(row, score, 'radiology_match'));
      if (dedupeCandidates(candidates).length >= maxResults) break;
    }
  }

  const ranked = dedupeCandidates(candidates)
    .filter((candidate) => candidate.modifier === '26' && (candidate.workRvu ?? 0) > 0)
    .sort((a, b) => {
      const aRvu = a.workRvu ?? 0;
      const bRvu = b.workRvu ?? 0;
      if (aRvu === 0 && bRvu !== 0) return 1;
      if (aRvu !== 0 && bRvu === 0) return -1;
      return b.confidence - a.confidence;
    });

  if (ranked.length > 0 && ranked[0].confidence < CONFIDENCE_THRESHOLD) {
    return [];
  }

  return ranked.slice(0, maxResults);
}

export async function searchExamLibrary(
  query: string,
  maxResults = 8,
): Promise<MatchCandidate[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  if (CPT_CODE_PATTERN.test(trimmed)) {
    const rows = await getModifier26Rows(trimmed);
    return rows.map((row) => rowToCandidate(row, 1, 'manual_cpt')).slice(0, maxResults);
  }

  const radiologyNorm = normalizeForRadiology(trimmed);
  const allCpt = await db.cptRvuTable
    .where('statusCategory')
    .anyOf(['active', 'restricted'])
    .toArray();

  const tokenCount = trimmed.split(/\s+/).length;
  return allCpt
    .filter(isProductivityRelevantModifier26)
    .map((row) => {
      const radioScore = scoreRadiologyMatch(radiologyNorm, row.description);
      const textScore = combinedSimilarity(trimmed, row.description);
      const score = tokenCount > 3
        ? radioScore * 0.80 + textScore * 0.20
        : radioScore * 0.50 + textScore * 0.50;
      return { row, score };
    })
    .filter((x) => x.score >= 0.20)
    .sort((a, b) => {
      const scoreDiff = b.score - a.score;
      if (scoreDiff !== 0) return scoreDiff;
      return (b.row.workRvu ?? 0) - (a.row.workRvu ?? 0);
    })
    .slice(0, maxResults)
    .map(({ row, score }) => rowToCandidate(row, score, 'radiology_match'));
}

export interface LearnAliasPayload {
  rawText: string;
  canonicalExamName: string | null;
  candidates: Array<{ cptCode: string; modifier: string | null; workRvu: number | null }>;
  source: ExamAlias['source'];
  profileId?: string | null;
}

export async function learnAlias(payload: LearnAliasPayload): Promise<void>;
export async function learnAlias(
  rawText: string,
  cptCode: string,
  modifier: string | null,
  source: ExamAlias['source'],
): Promise<void>;
export async function learnAlias(
  payloadOrRaw: LearnAliasPayload | string,
  cptCode?: string,
  modifier?: string | null,
  source?: ExamAlias['source'],
): Promise<void> {
  let payload: LearnAliasPayload;
  if (typeof payloadOrRaw === 'string') {
    payload = {
      rawText: payloadOrRaw,
      canonicalExamName: null,
      candidates: [{ cptCode: cptCode!, modifier: modifier ?? null, workRvu: null }],
      source: source!,
    };
  } else {
    payload = payloadOrRaw;
  }

  const candidates = payload.candidates.filter((candidate) =>
    candidate.modifier === '26' && (candidate.workRvu ?? 0) > 0,
  );
  if (!candidates.length) return;

  const { rawText, canonicalExamName, profileId = null } = payload;
  const primary = candidates[0];
  const normalized = normalizeExamText(rawText);
  const existing = (await db.examAliases.where('aliasText').equals(normalized).toArray())
    .find((a) => a.profileId === profileId);

  const cptCodes = candidates.map((c) => `${c.cptCode}-26`);
  const totalWorkRvu = candidates.reduce((sum, c) => sum + (c.workRvu ?? 0), 0) || null;
  const now = new Date().toISOString();

  if (existing) {
    await db.examAliases.update(existing.id, {
      cptCode: primary.cptCode,
      modifier: '26',
      cptCodes,
      totalWorkRvu,
      canonicalExamName: canonicalExamName ?? existing.canonicalExamName,
      timesUsed: existing.timesUsed + 1,
      lastUsedAt: now,
      matchConfidence: Math.min(1, existing.matchConfidence + 0.02),
    });
    return;
  }

  await db.examAliases.add({
    id: crypto.randomUUID(),
    profileId,
    aliasText: normalized,
    aliasTextRaw: rawText,
    canonicalExamName: canonicalExamName ?? null,
    cptCode: primary.cptCode,
    modifier: '26',
    cptCodes,
    totalWorkRvu,
    matchConfidence: 0.90,
    source: payload.source,
    timesUsed: 1,
    lastUsedAt: now,
    createdAt: now,
  });
}
