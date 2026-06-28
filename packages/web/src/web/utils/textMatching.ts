/**
 * Normalizes free-text exam names for matching purposes. Expands common
 * radiology abbreviations so "CT A/P W/ CON" and "CT Abdomen Pelvis With
 * Contrast" normalize to comparable token sets.
 */

const ABBREVIATION_MAP: Record<string, string> = {
  'w/o': 'without',
  'wo': 'without',
  'w/': 'with',
  'w': 'with',
  'c/': 'contrast',
  'con': 'contrast',
  'cont': 'contrast',
  'abd': 'abdomen',
  'pel': 'pelvis',
  'a/p': 'abdomen pelvis',
  'ap': 'abdomen pelvis',
  'c/a/p': 'chest abdomen pelvis',
  'cap': 'chest abdomen pelvis',
  'chst': 'chest',
  'hd': 'head',
  'neg': 'neck',
  'sp': 'spine',
  'lspine': 'lumbar spine',
  'l-spine': 'lumbar spine',
  'cspine': 'cervical spine',
  'c-spine': 'cervical spine',
  'tspine': 'thoracic spine',
  't-spine': 'thoracic spine',
  'lt': 'left',
  'rt': 'right',
  'bilat': 'bilateral',
  'ext': 'extremity',
  'xr': 'xray',
  'x-ray': 'xray',
  'us': 'ultrasound',
  'u/s': 'ultrasound',
  'mr': 'mri',
  'iv': 'intravenous',
  '2v': 'two view',
  '1v': 'one view',
  '3v': 'three view',
  'wwo': 'with and without',
  'w-wo': 'with and without',
  'w/wo': 'with and without',
};

export function normalizeExamText(raw: string): string {
  let text = raw.toLowerCase().trim();
  text = text.replace(/[_]+/g, ' ');
  text = text.replace(/[.,;:()]/g, ' ');

  // Expand whole-phrase slash abbreviations FIRST, while the slash is still
  // attached, before any blanket slash-splitting can break them apart.
  // Bug history: splitting on "/" before this step turned "w/o" into the
  // two tokens "w" and "o" -- "w" correctly expanded to "with", but the
  // "o" was an orphaned fragment that matched nothing, silently corrupting
  // every "without contrast" exam name normalization. Multi-word phrases
  // are replaced longest-first so e.g. "c/a/p" doesn't get clobbered by a
  // shorter alias matching part of it first.
  const slashPhrases = Object.keys(ABBREVIATION_MAP)
    .filter((k) => k.includes('/'))
    .sort((a, b) => b.length - a.length);
  for (const phrase of slashPhrases) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?<=^|\\s)${escaped}(?=\\s|$)`, 'g');
    text = text.replace(re, ` ${ABBREVIATION_MAP[phrase]} `);
  }

  // Any remaining slashes (not part of a known phrase) are split into
  // separate tokens rather than left glued together.
  text = text.replace(/\//g, ' ');
  text = text.replace(/\s+/g, ' ');

  const tokens = text.split(' ').filter(Boolean);
  const expanded = tokens.map((tok) => ABBREVIATION_MAP[tok] ?? tok);
  return expanded.join(' ').replace(/\s+/g, ' ').trim();
}

export function tokenize(normalized: string): string[] {
  return normalized.split(' ').filter(Boolean);
}

/** Levenshtein edit distance, used for fuzzy string comparisons. */
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return dp[m][n];
}

/** Similarity score in [0,1], 1 = identical, based on normalized edit distance. */
export function stringSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const dist = levenshteinDistance(a, b);
  return 1 - dist / maxLen;
}

/**
 * Token-set overlap, measured as recall against the SHORTER token set
 * rather than Jaccard (intersection-over-union). A short user query like
 * "CT abd" matching every one of its own tokens against a longer official
 * CMS description like "CT abdomen w contrast" should score close to 1.0,
 * not be punished for the description containing additional clinically
 * relevant words the user didn't bother typing. Jaccard penalizes the
 * query for the target's length; recall-against-the-query does not.
 */
export function tokenOverlapScore(tokensA: string[], tokensB: string[]): number {
  if (tokensA.length === 0 || tokensB.length === 0) return 0;
  const shorter = tokensA.length <= tokensB.length ? tokensA : tokensB;
  const longer = tokensA.length <= tokensB.length ? tokensB : tokensA;
  const longerSet = new Set(longer);

  let matched = 0;
  for (const t of shorter) {
    if (longerSet.has(t)) matched++;
  }
  return matched / shorter.length;
}

/**
 * Penalizes a match when contrast-related tokens conflict between the two
 * normalized strings: if A says "without" and B says "with" (or vice
 * versa), that's a direct contradiction, not just a missing detail --
 * "with contrast" and "without contrast" are different CPT codes with
 * different RVUs, not stylistic variants of the same study. Plain recall
 * scoring can't tell the difference between "the query just didn't mention
 * this" and "this candidate is the wrong exam," so this is an explicit
 * penalty rather than something folded into ordinary token overlap.
 * Returns a multiplier in (0, 1].
 */
function contrastConsistencyPenalty(tokensA: string[], tokensB: string[]): number {
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  const aHasWith = setA.has('with') && !setA.has('without');
  const aHasWithout = setA.has('without');
  const bHasWith = setB.has('with') && !setB.has('without');
  const bHasWithout = setB.has('without');

  const directContradiction = (aHasWith && bHasWithout) || (aHasWithout && bHasWith);
  if (directContradiction) return 0.3;

  return 1;
}

/**
 * Combined score blending token recall and full-string similarity, with an
 * explicit penalty for contrast-status contradictions (see
 * CONTRAST_SENSITIVE_TOKENS above). Token recall is weighted much more
 * heavily (0.8) than raw string similarity (0.2): for short queries against
 * long canonical descriptions, whole-string edit distance is a poor signal
 * (it punishes the query for being shorter than the target even when every
 * token it has is correct), so it's kept only as a tie-breaker between
 * candidates with equal token recall, not as a primary signal.
 */
export function combinedSimilarity(rawA: string, rawB: string): number {
  const normA = normalizeExamText(rawA);
  const normB = normalizeExamText(rawB);
  const tokensA = tokenize(normA);
  const tokensB = tokenize(normB);
  const tokenScore = tokenOverlapScore(tokensA, tokensB);
  const stringScore = stringSimilarity(normA, normB);
  const baseScore = tokenScore * 0.8 + stringScore * 0.2;
  return baseScore * contrastConsistencyPenalty(tokensA, tokensB);
}
