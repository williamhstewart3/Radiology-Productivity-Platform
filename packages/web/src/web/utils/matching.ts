import { db } from '../db/database';
import type { CptRvuRow, ExamAlias, MatchCandidate } from '../types';
import { combinedSimilarity, normalizeExamText } from './textMatching';
import { normalizeForRadiology } from './examNormalizer';
import { scoreRadiologyMatch, CONFIDENCE_THRESHOLD } from './examLibrary';
import {
  getCommonRadiologyMappingCodes,
  normalizeRadiologyDescription,
} from './radiologyDescriptionNormalization';

const CPT_CODE_PATTERN = /^\d{5}$/;
const EXAM_CONTEXT_PATTERN =
  /\b(?:ct|cta|mri?|mra|x-?ray|xr|ultrasound|u\/s|us|nm|pet|fluoro|mammogram|mammo|angiogram|abdomen|pelvis|chest|head|neck|brain|spine|lumbar|thoracic|cervical|knee|shoulder|hip|ankle|wrist|contrast|with|without|w\/o|w\/)\b/i;
const DATE_TIME_OR_IDENTIFIER_PATTERN =
  /\b(?:\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm)?|dob|date of birth|age|mrn|medical record|accession|acc|patient(?:\s+id)?|account|acct|encounter|order|csn|fin|har)\b/i;

export interface FindMatchOptions {
  /**
   * OCR screenshots often contain isolated date/time/MRN/accession numbers.
   * When true, a raw numeric string is not treated as a direct CPT unless
   * the caller supplied surrounding exam/modality context.
   */
  requireExamContextForDirectCpt?: boolean;
  directCptContext?: string;
}

function canUseDirectCptMatch(rawInput: string, options?: FindMatchOptions): boolean {
  const trimmed = rawInput.trim();
  if (!CPT_CODE_PATTERN.test(trimmed)) return false;
  if (!options?.requireExamContextForDirectCpt) return true;

  const context = options.directCptContext?.trim() || rawInput;
  if (context.trim() === trimmed) return false;
  return EXAM_CONTEXT_PATTERN.test(context) && !DATE_TIME_OR_IDENTIFIER_PATTERN.test(context);
}

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

async function candidatesForCommonRadiologyMapping(rawInput: string): Promise<MatchCandidate[]> {
  const candidates: MatchCandidate[] = [];
  for (const cptCode of getCommonRadiologyMappingCodes(rawInput)) {
    const rows = await getModifier26Rows(cptCode);
    for (const row of rows) {
      candidates.push(rowToCandidate(row, 0.99, 'radiology_match'));
    }
  }
  return candidates;
}

function aliasNormalizedKeys(alias: ExamAlias): string[] {
  return [
    alias.aliasText,
    normalizeExamText(alias.aliasTextRaw),
    normalizeRadiologyDescription(alias.aliasTextRaw),
    normalizeRadiologyDescription(alias.aliasText),
  ].filter(Boolean);
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
  options?: FindMatchOptions,
): Promise<MatchCandidate[]> {
  const trimmed = rawInput.trim();
  if (!trimmed) return [];

  const candidates: MatchCandidate[] = [];

  if (canUseDirectCptMatch(rawInput, options)) {
    const directMatches = await getModifier26Rows(trimmed);
    return directMatches
      .map((row) => rowToCandidate(row, 1.0, 'manual_cpt'))
      .slice(0, maxResults);
  }

  const normalizedInput = normalizeExamText(trimmed);
  const radiologyDescriptionKey = normalizeRadiologyDescription(trimmed);
  const radiologyNorm = normalizeForRadiology(trimmed);
  const radiologyNormalizedKey = normalizeExamText(radiologyNorm.normalizedTitle);
  const exactKeys = new Set([normalizedInput, radiologyNormalizedKey, radiologyDescriptionKey].filter(Boolean));

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

  const exactAlias = sortByScope(
    scopedAliases.filter((alias) => aliasNormalizedKeys(alias).some((key) => exactKeys.has(key))),
  )[0];

  if (exactAlias) {
    candidates.push(...await candidatesForAlias(exactAlias, 0.98));
  }

  if (candidates.length < maxResults) {
    candidates.push(...await candidatesForCommonRadiologyMapping(trimmed));
  }

  const allCpt = candidates.length < maxResults
    ? await db.cptRvuTable.where('statusCategory').anyOf(['active', 'restricted']).toArray()
    : [];

  if (candidates.length < maxResults) {
    const exactDescriptionRows = allCpt
      .filter(isProductivityRelevantModifier26)
      .filter((row) => normalizeRadiologyDescription(row.description) === radiologyDescriptionKey);

    for (const row of exactDescriptionRows) {
      candidates.push(rowToCandidate(row, 0.96, 'radiology_match'));
      if (dedupeCandidates(candidates).length >= maxResults) break;
    }
  }

  if (candidates.length < maxResults) {
    const fuzzyAliasScored = scopedAliases
      .map((alias) => ({
        alias,
        score: Math.max(
          combinedSimilarity(trimmed, alias.aliasTextRaw),
          combinedSimilarity(radiologyDescriptionKey, normalizeRadiologyDescription(alias.aliasTextRaw)),
        ),
      }))
      .filter((x) => x.score >= 0.5)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults);

    for (const { alias, score } of fuzzyAliasScored) {
      candidates.push(...await candidatesForAlias(alias, score * 0.9));
    }
  }

  if (candidates.length < maxResults) {
    const descScored = allCpt
      .filter(isProductivityRelevantModifier26)
      .map((row) => {
        const normalizedDescription = normalizeRadiologyDescription(row.description);
        const exactNormalizedScore = normalizedDescription === radiologyDescriptionKey ? 0.96 : 0;
        const radioScore = scoreRadiologyMatch(radiologyNorm, row.description);
        const normalizedTextScore = combinedSimilarity(radiologyDescriptionKey, normalizedDescription);
        return { row, score: Math.max(exactNormalizedScore, radioScore, normalizedTextScore * 0.92) };
      })
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

  const radiologyDescriptionKey = normalizeRadiologyDescription(trimmed);
  const radiologyNorm = normalizeForRadiology(trimmed);
  const allCpt = await db.cptRvuTable
    .where('statusCategory')
    .anyOf(['active', 'restricted'])
    .toArray();

  const commonCandidates = await candidatesForCommonRadiologyMapping(trimmed);
  const exactDescriptionCandidates = allCpt
    .filter(isProductivityRelevantModifier26)
    .filter((row) => normalizeRadiologyDescription(row.description) === radiologyDescriptionKey)
    .map((row) => rowToCandidate(row, 0.96, 'radiology_match'));

  const tokenCount = trimmed.split(/\s+/).length;
  const fuzzyCandidates = allCpt
    .filter(isProductivityRelevantModifier26)
    .map((row) => {
      const normalizedDescription = normalizeRadiologyDescription(row.description);
      const radioScore = scoreRadiologyMatch(radiologyNorm, row.description);
      const textScore = combinedSimilarity(trimmed, row.description);
      const normalizedTextScore = combinedSimilarity(radiologyDescriptionKey, normalizedDescription);
      const blendedScore = tokenCount > 3
        ? radioScore * 0.70 + textScore * 0.15 + normalizedTextScore * 0.15
        : radioScore * 0.40 + textScore * 0.35 + normalizedTextScore * 0.25;
      const score = Math.max(normalizedDescription === radiologyDescriptionKey ? 0.96 : 0, blendedScore);
      return { row, score };
    })
    .filter((x) => x.score >= 0.20)
    .sort((a, b) => {
      const scoreDiff = b.score - a.score;
      if (scoreDiff !== 0) return scoreDiff;
      return (b.row.workRvu ?? 0) - (a.row.workRvu ?? 0);
    })
    .slice(0, maxResults * 2)
    .map(({ row, score }) => rowToCandidate(row, score, 'radiology_match'));

  return dedupeCandidates([...commonCandidates, ...exactDescriptionCandidates, ...fuzzyCandidates])
    .slice(0, maxResults);
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
  const normalized = normalizeRadiologyDescription(rawText);
  const legacyNormalized = normalizeExamText(rawText);
  const existing = (await db.examAliases.toArray())
    .find((a) => (
      a.profileId === profileId &&
      (a.aliasText === normalized || a.aliasText === legacyNormalized || normalizeRadiologyDescription(a.aliasTextRaw) === normalized)
    ));

  const cptCodes = candidates.map((c) => `${c.cptCode}-26`);
  const totalWorkRvu = candidates.reduce((sum, c) => sum + (c.workRvu ?? 0), 0) || null;
  const now = new Date().toISOString();

  if (existing) {
    await db.examAliases.update(existing.id, {
      aliasText: normalized,
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
