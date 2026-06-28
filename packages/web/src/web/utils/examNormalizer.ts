/**
 * examNormalizer.ts
 *
 * Step 1 + Step 2 of the radiology-aware matching pipeline.
 *
 * Step 1 — Raw OCR cleanup:
 *   Lowercase, strip punctuation, collapse spaces.
 *
 * Step 2 — Radiology-specific normalization:
 *   Expand protocol tokens (CODE STROKE → CTA Head and Neck),
 *   expand abbreviations (A/P → Abdomen Pelvis, PE → Pulmonary Embolism),
 *   and extract structured hints (modality, body parts, contrast status)
 *   that the downstream matcher can use for weighted scoring.
 *
 * Design: all rules live in plain dictionaries — easy for a radiologist to
 * review and extend without touching any scoring logic.
 */

import type { Modality } from '../types';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NormalizationResult {
  /** Human-readable normalized title after all expansions. */
  normalizedTitle: string;
  /** Detected modality hint, or null if ambiguous. */
  modality: Modality | null;
  /** Detected body parts in order of specificity. */
  bodyParts: string[];
  /** Explicit contrast status extracted from the title. */
  contrastStatus: 'with' | 'without' | 'with_and_without' | null;
  /** True if a protocol alias (e.g. CODE STROKE) resolved the whole title. */
  wasProtocolAlias: boolean;
}

// ─── Step 2a: Protocol / institutional alias map ──────────────────────────────
// These whole-phrase substitutions fire FIRST before any token-level rules.
// Keys must be lowercase.  Values are the canonical display form.
//
// Institutional shorthand that varies by hospital:
//   CODE STROKE = CTA Head and Neck with Contrast (stroke alert protocol)
//   CODE PE     = CTA Chest Pulmonary Embolism with Contrast
//   STROKE ALERT= same as CODE STROKE

export const PROTOCOL_ALIAS_MAP: Record<string, string> = {
  // Stroke / neuro
  'code stroke':               'CTA Head and Neck with Contrast',
  'stroke alert':              'CTA Head and Neck with Contrast',
  'stroke protocol':           'CTA Head and Neck with Contrast',
  'cta stroke':                'CTA Head and Neck with Contrast',
  'ct angiogram code stroke':  'CTA Head and Neck with Contrast',
  // Pulmonary Embolism
  'code pe':                   'CTA Chest Pulmonary Embolism with Contrast',
  'pe protocol':               'CTA Chest Pulmonary Embolism with Contrast',
  'cta pe':                    'CTA Chest Pulmonary Embolism with Contrast',
  'ctpe':                      'CTA Chest Pulmonary Embolism with Contrast',
  // Aorta
  'ct aorta':                  'CTA Aorta with Contrast',
  'cta aorta':                 'CTA Aorta with Contrast',
  'aortic dissection':         'CTA Aorta with Contrast',
  // Trauma
  'trauma ct':                 'CT Chest Abdomen Pelvis with Contrast',
  'pan scan':                  'CT Chest Abdomen Pelvis with Contrast',
  'panscan':                   'CT Chest Abdomen Pelvis with Contrast',
  'trauma pan scan':           'CT Chest Abdomen Pelvis with Contrast',
  // Coronary
  'coronary cta':              'CTA Coronary Arteries with Contrast',
  'cardiac cta':               'CTA Coronary Arteries with Contrast',
  // Renal
  'renal stone':               'CT Abdomen Pelvis without Contrast',
  'kidney stone':              'CT Abdomen Pelvis without Contrast',
  'renal colic':               'CT Abdomen Pelvis without Contrast',
  // Head/Brain
  'brain mri':                 'MRI Brain without Contrast',
  'mri stroke':                'MRI Brain without and with Contrast',
  // Screening
  'screening mammo':           'Screening Mammography',
  'screening mammogram':       'Screening Mammography',
  'screening mammography':     'Screening Mammography',
  'diagnostic mammo':          'Diagnostic Mammography',
  'diagnostic mammogram':      'Diagnostic Mammography',
};

// ─── Step 2b: Token expansion dictionary ─────────────────────────────────────
// Applied token-by-token AFTER protocol aliases.
// Longer phrases matched first (sorted by key length desc at runtime).

export const RADIOLOGY_EXPANSION_MAP: Record<string, string> = {
  // ── Modality
  'cta':          'CT Angiogram',
  'mra':          'MR Angiogram',
  'ct':           'CT',
  'mri':          'MRI',
  'mr':           'MRI',
  'us':           'Ultrasound',
  'u/s':          'Ultrasound',
  'xr':           'X-Ray',
  'x-ray':        'X-Ray',
  'nm':           'Nuclear Medicine',
  'pet':          'PET',
  'pet/ct':       'PET CT',
  'petct':        'PET CT',
  'fluoro':       'Fluoroscopy',
  'mammo':        'Mammography',
  'dexa':         'DEXA Bone Density',
  'dxa':          'DEXA Bone Density',

  // ── Contrast
  'w/o':          'without Contrast',
  'w/':           'with Contrast',
  'wo':           'without Contrast',
  'wcon':         'with Contrast',
  'wwocon':       'with and without Contrast',
  'w/wo':         'with and without Contrast',
  'wwo':          'with and without Contrast',
  'w&wo':         'with and without Contrast',
  '+c':           'with Contrast',
  '-c':           'without Contrast',
  'con':          'Contrast',
  'noncon':       'without Contrast',
  'non-con':      'without Contrast',
  'nc':           'without Contrast',

  // ── Body regions (whole-word)
  'a/p':          'Abdomen Pelvis',
  'ap':           'Abdomen Pelvis',
  'c/a/p':        'Chest Abdomen Pelvis',
  'cap':          'Chest Abdomen Pelvis',
  'h&n':          'Head and Neck',
  'h/n':          'Head and Neck',
  'head neck':    'Head and Neck',
  'head/neck':    'Head and Neck',
  'abd':          'Abdomen',
  'abdo':         'Abdomen',
  'pel':          'Pelvis',
  'chst':         'Chest',
  'hd':           'Head',
  'nk':           'Neck',
  'brn':          'Brain',
  'brnstem':      'Brain Stem',
  'orb':          'Orbits',
  'sp':           'Spine',
  'c-spine':      'Cervical Spine',
  'cspine':       'Cervical Spine',
  'c spine':      'Cervical Spine',
  't-spine':      'Thoracic Spine',
  'tspine':       'Thoracic Spine',
  't spine':      'Thoracic Spine',
  'l-spine':      'Lumbar Spine',
  'lspine':       'Lumbar Spine',
  'l spine':      'Lumbar Spine',
  'ls spine':     'Lumbar Spine',
  'tlspine':      'Thoracic Lumbar Spine',
  'tl spine':     'Thoracic Lumbar Spine',
  'cl spine':     'Cervical Lumbar Spine',
  'whole spine':  'Whole Spine',
  'total spine':  'Whole Spine',
  // Extremities
  'ue':           'Upper Extremity',
  'le':           'Lower Extremity',
  'bilat':        'Bilateral',
  'bil':          'Bilateral',
  'lt':           'Left',
  'rt':           'Right',
  'shldr':        'Shoulder',
  'kn':           'Knee',
  'ank':          'Ankle',
  'wr':           'Wrist',
  'hp':           'Hip',
  'fmr':          'Femur',
  'tib':          'Tibia',
  'hum':          'Humerus',
  'elb':          'Elbow',
  'fgr':          'Finger',
  'toe':          'Toe',
  'ft':           'Foot',
  'frt':          'Forearm',
  // Organs
  'abd pelvis':   'Abdomen Pelvis',
  'liver':        'Liver',
  'gi':           'GI',
  'hepat':        'Hepatic',
  'panc':         'Pancreas',
  'renal':        'Renal',
  'kub':          'Kidneys Ureters Bladder',
  'biliary':      'Biliary',
  'prost':        'Prostate',
  'ov':           'Ovaries',
  'uterus':       'Uterus',
  'thyroid':      'Thyroid',
  'parath':       'Parathyroid',
  'adrenal':      'Adrenal',
  'endo':         'Endoscopy',
  'cardiac':      'Cardiac',
  'pulm':         'Pulmonary',
  'pe':           'Pulmonary Embolism',
  'tia':          'TIA',
  // Views / technique
  'w/contrast':   'with Contrast',
  'screening':    'Screening',
  'diag':         'Diagnostic',
  'dx':           'Diagnostic',
  'biopsy':       'Biopsy',
  'guided':       'Guided',
  'fluoro-guided':'Fluoroscopy Guided',
  'drain':        'Drainage',
  'inject':       'Injection',
  'aspir':        'Aspiration',
  'art':          'Arthrography',
  'arthro':       'Arthrography',
  'myelogram':    'Myelogram',
  'myelo':        'Myelogram',
  'angio':        'Angiography',
  // Lateral/number
  '2v':           '2 View',
  '3v':           '3 View',
  '4v':           '4 View',
};

// ─── Noise tokens — stripped before matching ─────────────────────────────────
// Institution-specific tags that add zero CPT-matching signal.

const NOISE_TOKENS = new Set([
  'code', 'protocol', 'stat', 'portable', 'exam', 'study', 'scan',
  'imaging', 'radiology', 'order', 'req', 'request', 'series',
  'sequence', 'tech', 'alert', 'urgent', 'routine', 'emergent',
  'inpatient', 'outpatient', 'ip', 'op', 'add', 'on', 'limited', 'complete',
]);

// ─── Body-part keyword registry (for extraction) ─────────────────────────────

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
];

// ─── Modality detection keywords ─────────────────────────────────────────────

const MODALITY_KEYWORDS: { pattern: RegExp; modality: Modality }[] = [
  { pattern: /\bct\s*angiogram\b|\bcta\b/i,    modality: 'CT' },
  { pattern: /\bmr\s*angiogram\b|\bmra\b/i,    modality: 'MRI' },
  { pattern: /\bct\b|\bcat scan\b/i,           modality: 'CT' },
  { pattern: /\bmri\b|\bmr\b/i,                modality: 'MRI' },
  { pattern: /\bpet\b/i,                       modality: 'NM_PET' },
  { pattern: /\bnuclear\b|\bnm\b/i,            modality: 'NM_PET' },
  { pattern: /\bultrasound\b|\bsonogram\b|\bus\b|\bechocardiogram\b/i, modality: 'US' },
  { pattern: /\bmammo\b|\bmammogram\b|\bmammography\b/i, modality: 'MAMMO' },
  { pattern: /\bx.?ray\b|\bxr\b|\bradiograph\b/i, modality: 'XR' },
  { pattern: /\bfluoroscopy\b|\bfluoro\b|\bbarium\b/i, modality: 'FLUORO' },
];

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Full two-step normalization:
 *   Step 1: clean raw OCR string
 *   Step 2: apply protocol aliases + token expansions
 *
 * Returns a structured result with the normalized title plus extracted
 * semantic hints used by the downstream radiology matcher.
 */
export function normalizeForRadiology(raw: string): NormalizationResult {
  // ── Step 1: Raw cleanup ──────────────────────────────────────────────────
  let text = raw
    .toLowerCase()
    .trim()
    .replace(/[_\-]+/g, ' ')
    .replace(/[.,;:()\[\]{}@#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // ── Step 2a: Whole-phrase protocol aliases ────────────────────────────────
  // Try longest keys first so "ct angiogram code stroke" beats "cta"
  const protocolKeys = Object.keys(PROTOCOL_ALIAS_MAP).sort((a, b) => b.length - a.length);
  let wasProtocolAlias = false;
  for (const key of protocolKeys) {
    if (text.includes(key)) {
      const expanded = PROTOCOL_ALIAS_MAP[key];
      text = expanded;
      wasProtocolAlias = true;
      break;
    }
  }

  // ── Step 2b: Token-level expansion (only if not already aliased) ─────────
  if (!wasProtocolAlias) {
    // Multi-word expansion keys first
    const expandKeys = Object.keys(RADIOLOGY_EXPANSION_MAP).sort((a, b) => b.length - a.length);
    for (const key of expandKeys) {
      if (key.includes(' ') || key.includes('/')) {
        const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`(?<![a-z])${escaped}(?![a-z])`, 'gi');
        if (re.test(text)) {
          text = text.replace(re, RADIOLOGY_EXPANSION_MAP[key]);
        }
      }
    }

    // Single-token expansion — tokenize, map, skip noise
    const tokens = text.split(/\s+/).filter(Boolean);
    const expanded = tokens
      .filter((t) => !NOISE_TOKENS.has(t.toLowerCase()))
      .map((t) => {
        const lower = t.toLowerCase();
        return RADIOLOGY_EXPANSION_MAP[lower] ?? t;
      });

    text = expanded.join(' ').replace(/\s+/g, ' ').trim();
  }

  // ── Normalize capitalisation for display ──────────────────────────────────
  // Title-case the result — modality stays uppercase, rest title-cased
  text = toRadiologyTitleCase(text);

  // ── Extract semantic hints ────────────────────────────────────────────────
  const lowerText = text.toLowerCase();

  // Contrast status
  let contrastStatus: NormalizationResult['contrastStatus'] = null;
  if (/with and without|without and with/i.test(text)) {
    contrastStatus = 'with_and_without';
  } else if (/\bwithout\b/i.test(text)) {
    contrastStatus = 'without';
  } else if (/\bwith\s+contrast\b|\bwith\b/i.test(text)) {
    contrastStatus = 'with';
  }

  // Modality
  let modality: Modality | null = null;
  for (const { pattern, modality: m } of MODALITY_KEYWORDS) {
    if (pattern.test(text)) {
      modality = m;
      break;
    }
  }

  // Body parts
  const bodyParts: string[] = [];
  for (const bp of BODY_PART_KEYWORDS) {
    if (lowerText.includes(bp)) {
      bodyParts.push(bp);
    }
  }

  return { normalizedTitle: text, modality, bodyParts, contrastStatus, wasProtocolAlias };
}

// ─── Title-case helper ────────────────────────────────────────────────────────

const ALWAYS_UPPER = new Set(['CT', 'MRI', 'CTA', 'MRA', 'PET', 'DEXA', 'US', 'XR', 'NM']);
const ALWAYS_LOWER = new Set(['and', 'or', 'of', 'the', 'a', 'an', 'in', 'on', 'at', 'with', 'without']);

function toRadiologyTitleCase(text: string): string {
  return text
    .split(/\s+/)
    .map((word, i) => {
      const upper = word.toUpperCase();
      if (ALWAYS_UPPER.has(upper)) return upper;
      const lower = word.toLowerCase();
      if (i > 0 && ALWAYS_LOWER.has(lower)) return lower;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}
