/**
 * examLibrary.ts
 *
 * Radiology-aware CPT description scorer.
 *
 * Replaces generic Levenshtein/Jaccard similarity in Step 4 of matching.ts
 * with a four-component weighted score that understands radiology semantics:
 *
 *   1. Modality match       (+0.40) — "CT" vs "MRI" is a hard signal
 *   2. Body part overlap    (+0.30) — anatomy coverage
 *   3. Contrast consistency (+0.20) — with/without/w+wo alignment
 *   4. String similarity    (+0.10) — fallback token overlap after normalization
 *
 * Design: pure functions, no DB calls, no side effects.
 * DB search (searchExamLibrary) lives in matching.ts where DB access lives.
 */

import type { NormalizationResult } from './examNormalizer';
import type { Modality } from '../types';

// ─── Public constant ──────────────────────────────────────────────────────────

/** Below this threshold → no candidates shown, "Search exam library" CTA instead */
export const CONFIDENCE_THRESHOLD = 0.50;

// ─── Body part keyword registry (mirrors examNormalizer but lowercase) ────────

const BODY_PART_KEYWORDS: string[] = [
  'head', 'brain', 'neck', 'chest', 'abdomen', 'pelvis',
  'spine', 'cervical', 'thoracic', 'lumbar', 'sacral', 'coccyx',
  'shoulder', 'elbow', 'wrist', 'hand', 'finger', 'thumb',
  'hip', 'knee', 'ankle', 'foot', 'toe',
  'extremity', 'upper extremity', 'lower extremity',
  'femur', 'tibia', 'fibula', 'humerus', 'radius', 'ulna',
  'orbit', 'sinus', 'temporal', 'mastoid', 'facial',
  'liver', 'pancreas', 'kidney', 'renal', 'adrenal', 'spleen',
  'bladder', 'prostate', 'uterus', 'ovary', 'breast', 'thyroid',
  'aorta', 'pulmonary', 'coronary', 'cardiac', 'heart',
  'hepatic', 'biliary', 'bowel', 'colon', 'rectum',
  'fetal', 'obstetric',
  // multi-word — checked via includes() on lowercased description
  'head and neck',
  'abdomen and pelvis',
  'abdomen pelvis',
  'chest abdomen pelvis',
];

// Sort longer phrases first so "head and neck" beats "head" and "neck"
const SORTED_BODY_PARTS = [...BODY_PART_KEYWORDS].sort((a, b) => b.length - a.length);

// ─── Modality detection for CMS descriptions ─────────────────────────────────

const MODALITY_PATTERNS: { pattern: RegExp; modality: Modality }[] = [
  { pattern: /\bct\s*angiograph|\bcta\b/i,         modality: 'CT'       },
  { pattern: /\bmr\s*angiograph|\bmra\b/i,          modality: 'MRI'      },
  { pattern: /\bcomputed tomograph|\bcat scan\b|\bct\b/i, modality: 'CT' },
  { pattern: /\bmagnetic resonance|\bmri\b|\bmr\b/i, modality: 'MRI'     },
  { pattern: /\bpet\b/i,                            modality: 'NM_PET'   },
  { pattern: /\bnuclear medicine|\bscintigraph|\bnm\b/i, modality: 'NM_PET' },
  { pattern: /\bultrasound|\bsonograph|\bechocard/i, modality: 'US'      },
  { pattern: /\bmammograph|\bmammo\b/i,             modality: 'MAMMO'    },
  { pattern: /\bradiograph|x-?ray|\bxr\b|\bchest film\b/i, modality: 'XR' },
  { pattern: /\bfluoroscop|\bbarium/i,              modality: 'FLUORO'   },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractModalityFromDescription(desc: string): Modality | null {
  for (const { pattern, modality } of MODALITY_PATTERNS) {
    if (pattern.test(desc)) return modality;
  }
  return null;
}

function extractBodyPartsFromDescription(desc: string): string[] {
  const lower = desc.toLowerCase();
  const found: string[] = [];
  for (const bp of SORTED_BODY_PARTS) {
    if (lower.includes(bp)) {
      found.push(bp);
    }
  }
  return found;
}

type ContrastHint = 'with' | 'without' | 'with_and_without' | null;

function extractContrastFromDescription(desc: string): ContrastHint {
  if (/with(?:out)?\s+and\s+with(?:out)?|without\s+and\s+with/i.test(desc)) {
    return 'with_and_without';
  }
  if (/\bwithout\b/i.test(desc)) return 'without';
  if (/\bwith\s+contrast\b|\bw\/\s*c\b|\bpost.?contrast\b/i.test(desc)) return 'with';
  return null;
}

/**
 * Token-overlap Jaccard similarity between two lowercased strings.
 * Only counts tokens longer than 2 chars (filters "of", "a", "in" etc.)
 */
function tokenJaccard(a: string, b: string): number {
  const tokenize = (s: string) =>
    new Set(s.toLowerCase().split(/\s+/).filter((t) => t.length > 2));
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const t of setA) {
    if (setB.has(t)) intersection++;
  }
  return intersection / (setA.size + setB.size - intersection);
}

// ─── Main scorer ─────────────────────────────────────────────────────────────

/**
 * Score how well a CMS CPT description matches the normalised query.
 *
 * Returns 0.0–1.0.  Use CONFIDENCE_THRESHOLD to gate low-quality results.
 *
 * Component breakdown (all clamped 0–1 individually before weighting):
 *   modalityScore   × 0.40
 *   bodyPartScore   × 0.30
 *   contrastScore   × 0.20
 *   tokenScore      × 0.10
 */
export function scoreRadiologyMatch(
  query: NormalizationResult,
  description: string,
): number {
  // ── 1. Modality (0.40) ────────────────────────────────────────────────────
  let modalityScore = 0;
  if (query.modality !== null) {
    const descModality = extractModalityFromDescription(description);
    if (descModality === null) {
      // CMS desc has no detectable modality — neutral (0.5) so it can still surface
      modalityScore = 0.5;
    } else if (descModality === query.modality) {
      modalityScore = 1.0;
    } else {
      // Wrong modality — hard penalise
      modalityScore = 0.05;
    }
  } else {
    // Query modality unknown — can't use this signal, give neutral weight
    modalityScore = 0.5;
  }

  // ── 2. Body part overlap (0.30) ───────────────────────────────────────────
  let bodyPartScore = 0;
  if (query.bodyParts.length > 0) {
    const descParts = extractBodyPartsFromDescription(description);
    if (descParts.length === 0) {
      bodyPartScore = 0.2; // desc has no anatomy — slight penalty
    } else {
      // Intersection: how many query body parts appear in the description
      const querySet = new Set(query.bodyParts.map((b) => b.toLowerCase()));
      const descSet  = new Set(descParts.map((b) => b.toLowerCase()));
      let hits = 0;
      for (const part of querySet) {
        // Partial match: "abdomen" hits "abdomen pelvis"
        for (const dp of descSet) {
          if (dp.includes(part) || part.includes(dp)) {
            hits++;
            break;
          }
        }
      }
      bodyPartScore = hits / querySet.size;
    }
  } else {
    bodyPartScore = 0.5; // unknown anatomy — neutral
  }

  // ── 3. Contrast consistency (0.20) ───────────────────────────────────────
  let contrastScore = 0;
  const descContrast = extractContrastFromDescription(description);
  if (query.contrastStatus === null || descContrast === null) {
    contrastScore = 0.5; // one side unknown — neutral
  } else if (query.contrastStatus === descContrast) {
    contrastScore = 1.0;
  } else if (
    // "with_and_without" covers both "with" and "without"
    query.contrastStatus === 'with_and_without' ||
    descContrast === 'with_and_without'
  ) {
    contrastScore = 0.7; // partial credit
  } else {
    contrastScore = 0.1; // explicit mismatch (with vs without)
  }

  // ── 4. Token similarity (0.10) ────────────────────────────────────────────
  const tokenScore = tokenJaccard(query.normalizedTitle, description);

  // ── Weighted sum ──────────────────────────────────────────────────────────
  const score =
    modalityScore  * 0.40 +
    bodyPartScore  * 0.30 +
    contrastScore  * 0.20 +
    tokenScore     * 0.10;

  return Math.min(1, Math.max(0, score));
}
