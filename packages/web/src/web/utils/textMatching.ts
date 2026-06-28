/**
 * textMatching.ts
 *
 * Normalizes free-text exam names for matching purposes. Expands common
 * radiology abbreviations so "CT A/P W/ CON" and "CT Abdomen Pelvis With
 * Contrast" normalize to comparable token sets.
 *
 * Also strips institution-specific noise tokens (e.g. "CODE", "STROKE" as
 * a protocol designator) that appear in PowerScribe/RIS titles but carry no
 * CPT-matching signal. This lets "CT ANGIOGRAM CODE STROKE HEAD NECK" resolve
 * to the same normalized form as "CTA Head and Neck w/ Contrast".
 */

// ─── Abbreviation expansion map ─────────────────────────────────────────────
// Applied token-by-token (after slash-phrases are handled first).
// Longer slash-phrases are matched before shorter ones to avoid partial hits.

const ABBREVIATION_MAP: Record<string, string> = {
  // Contrast
  'w/o':        'without',
  'wo':         'without',
  'w/':         'with',
  'w':          'with',
  'c/':         'contrast',
  'con':        'contrast',
  'cont':       'contrast',
  'wcon':       'with contrast',
  'wwocon':     'with and without contrast',

  // Modality abbreviations
  'cta':        'ct angiogram',
  'mra':        'mr angiogram',
  'mri':        'mri',
  'mr':         'mri',
  'us':         'ultrasound',
  'u/s':        'ultrasound',
  'xr':         'xray',
  'x-ray':      'xray',
  'nm':         'nuclear medicine',
  'pet':        'positron emission tomography',
  'fluoro':     'fluoroscopy',

  // Body regions
  'abd':        'abdomen',
  'pel':        'pelvis',
  'a/p':        'abdomen pelvis',
  'ap':         'abdomen pelvis',
  'c/a/p':      'chest abdomen pelvis',
  'cap':        'chest abdomen pelvis',
  'chst':       'chest',
  'hd':         'head',
  'nk':         'neck',
  'sp':         'spine',
  'lspine':     'lumbar spine',
  'l-spine':    'lumbar spine',
  'cspine':     'cervical spine',
  'c-spine':    'cervical spine',
  'tspine':     'thoracic spine',
  't-spine':    'thoracic spine',
  'lsp':        'lumbar spine',
  'csp':        'cervical spine',
  'tsp':        'thoracic spine',
  'brnst':      'brain stem',
  'brn':        'brain',

  // Laterality
  'lt':         'left',
  'rt':         'right',
  'bil':        'bilateral',
  'bi':         'bilateral',

  // Extremities
  'ext':        'extremity',
  'ue':         'upper extremity',
  'le':         'lower extremity',
  'shldr':      'shoulder',
  'kn':         'knee',
  'ank':        'ankle',
  'wr':         'wrist',
  'hp':         'hip',

  // Views / technique
  'iv':         'intravenous',
  '2v':         'two view',
  '1v':         'one view',
  '3v':         'three view',
  'wwo':        'with and without',
  'w-wo':       'with and without',
  'w/wo':       'with and without',
  'wowcon':     'without and with contrast',

  // Misc
  'dx':         'diagnostic',
  'scr':        'screening',
  'compl':      'complete',
  'comp':       'complete',
  'lim':        'limited',
  'bilat':      'bilateral',   // kept here as the primary entry
  'incl':       'including',
  'excl':       'excluding',
  'cad':        'cad',
};

// ─── Noise tokens ────────────────────────────────────────────────────────────
// These tokens appear in institution-specific RIS/PowerScribe study titles
// but carry ZERO CPT-matching signal. Strip them before normalization so
// "CT ANGIOGRAM CODE STROKE HEAD NECK" == "CTA Head Neck".
//
// "CODE" = protocol order name prefix used at many institutions
// "STROKE" = protocol variant label (not a body part here — body part is "head/neck")
// "PROTOCOL" = same as CODE
// "STAT" = urgency flag, not anatomy
// "PORTABLE" = acquisition method, not CPT-relevant
// "W&" = sometimes appears as "W& CONTRAST" (typo variant)

const NOISE_TOKENS = new Set([
  'code',
  'stroke',
  'protocol',
  'stat',
  'portable',
  'exam',
  'study',
  'scan',
  'imaging',
  'radiology',
  'diagnostic',
  'order',
  'req',
  'request',
]);

// ─── Core normalization ──────────────────────────────────────────────────────

export function normalizeExamText(raw: string): string {
  let text = raw.toLowerCase().trim();

  // Strip underscores, punctuation (except slashes — handled below)
  text = text.replace(/[_]+/g, ' ');
  text = text.replace(/[.,;:()\[\]{}]/g, ' ');

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

  // Any remaining slashes → split into separate tokens
  text = text.replace(/\//g, ' ');
  text = text.replace(/\s+/g, ' ');

  // Tokenize, expand abbreviations, strip noise tokens
  const tokens = text.split(' ').filter(Boolean);
  const expanded = tokens
    .map((tok) => ABBREVIATION_MAP[tok] ?? tok)
    // Re-tokenize expanded multi-word replacements (e.g. "cta" → "ct angiogram" → ["ct","angiogram"])
    .flatMap((tok) => tok.split(' '))
    .filter((tok) => !NOISE_TOKENS.has(tok));

  return expanded.join(' ').replace(/\s+/g, ' ').trim();
}

export function tokenize(normalized: string): string[] {
  return normalized.split(' ').filter(Boolean);
}

// ─── String similarity ───────────────────────────────────────────────────────

/** Levenshtein edit distance. */
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

/** Similarity in [0,1], 1 = identical. */
export function stringSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const dist = levenshteinDistance(a, b);
  return 1 - dist / maxLen;
}

/**
 * Token-set overlap measured as recall against the SHORTER token set.
 * A short query "CT abd" matching every one of its tokens against a longer
 * CMS description "CT abdomen w contrast" scores close to 1.0, not penalized
 * for the description's additional tokens.
 */
export function tokenOverlapScore(tokensA: string[], tokensB: string[]): number {
  if (tokensA.length === 0 || tokensB.length === 0) return 0;
  const shorter = tokensA.length <= tokensB.length ? tokensA : tokensB;
  const longer  = tokensA.length <= tokensB.length ? tokensB : tokensA;
  const longerSet = new Set(longer);

  let matched = 0;
  for (const t of shorter) {
    if (longerSet.has(t)) matched++;
  }
  return matched / shorter.length;
}

/**
 * Contrast contradiction penalty.
 * "with contrast" vs "without contrast" are different CPT codes.
 * Plain token recall can't distinguish "query didn't mention it" from
 * "query explicitly contradicts it" — so this is an explicit multiplier.
 */
function contrastConsistencyPenalty(tokensA: string[], tokensB: string[]): number {
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  const aHasWith    = setA.has('with')    && !setA.has('without');
  const aHasWithout = setA.has('without');
  const bHasWith    = setB.has('with')    && !setB.has('without');
  const bHasWithout = setB.has('without');

  if ((aHasWith && bHasWithout) || (aHasWithout && bHasWith)) return 0.3;
  return 1;
}

/**
 * Combined score blending token recall (0.8) and string similarity (0.2),
 * with an explicit contrast-contradiction penalty.
 */
export function combinedSimilarity(rawA: string, rawB: string): number {
  const normA = normalizeExamText(rawA);
  const normB = normalizeExamText(rawB);
  const tokensA = tokenize(normA);
  const tokensB = tokenize(normB);
  const tokenScore  = tokenOverlapScore(tokensA, tokensB);
  const stringScore = stringSimilarity(normA, normB);
  const baseScore   = tokenScore * 0.8 + stringScore * 0.2;
  return baseScore * contrastConsistencyPenalty(tokensA, tokensB);
}
