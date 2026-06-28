import type { Modality } from '../types';

/**
 * Maps a CPT/HCPCS code to a default modality bucket based on standard
 * AMA CPT code ranges. This is purely a code-numbering convention (public,
 * stable, documented by the AMA) — it does NOT involve any RVU values and
 * carries no billing-accuracy risk. Users can always override the modality
 * tag on any individual code or log entry.
 *
 * This is intentionally a single 'PROCEDURE' bucket per the build decision
 * (IR, biopsies, drains, etc. all grouped together rather than split further).
 */
export function classifyModality(cptCode: string): Modality {
  const code = cptCode.trim().toUpperCase();
  const num = parseInt(code, 10);

  // HCPCS Level II codes (start with a letter) - common radiology ones
  if (/^[A-Z]/.test(code)) {
    if (code.startsWith('G0202') || code.startsWith('G0204') || code.startsWith('G0206')) {
      return 'MAMMO'; // screening/diagnostic mammography G-codes
    }
    if (code.startsWith('G0279')) return 'MAMMO'; // tomosynthesis
    return 'OTHER';
  }

  if (Number.isNaN(num)) return 'OTHER';

  // Diagnostic radiology, CPT 70010–76499 (general), with sub-ranges below
  // X-Ray (plain film) ranges
  if (
    (num >= 70010 && num <= 70110) || // head/neck plain films
    (num >= 71045 && num <= 71048) || // chest XR
    (num >= 72020 && num <= 72120) || // spine XR
    (num >= 73000 && num <= 73225 && isPlainFilmExtremity(num)) ||
    (num >= 73500 && num <= 73660 && isPlainFilmExtremity(num)) ||
    (num >= 74000 && num <= 74022) // abdomen plain film
  ) {
    return 'XR';
  }

  // CT ranges
  if (
    (num >= 70450 && num <= 70498) || // CT head/neck
    (num >= 71250 && num <= 71275) || // CT chest
    (num >= 72125 && num <= 72133) || // CT spine
    (num >= 72191 && num <= 72194) || // CT angiography pelvis
    (num >= 73200 && num <= 73206) || // CT upper extremity
    (num >= 73700 && num <= 73706) || // CT lower extremity
    (num >= 74150 && num <= 74178) || // CT abdomen/pelvis
    (num >= 75571 && num <= 75574) // CT cardiac/coronary
  ) {
    return 'CT';
  }

  // MRI / MRA ranges
  if (
    (num >= 70540 && num <= 70559) || // MRI head/neck/orbit
    (num >= 71550 && num <= 71555) || // MRI chest
    (num >= 72141 && num <= 72159) || // MRI spine
    (num >= 72195 && num <= 72198) || // MRI pelvis
    (num >= 73218 && num <= 73225) || // MRI upper extremity
    (num >= 73718 && num <= 73725) || // MRI lower extremity
    (num >= 74181 && num <= 74183) // MRI abdomen
  ) {
    return 'MRI';
  }

  // Ultrasound ranges
  if (num >= 76506 && num <= 76999) {
    return 'US';
  }

  // Mammography
  if (num >= 77046 && num <= 77067) {
    return 'MAMMO';
  }

  // Nuclear medicine / PET
  if ((num >= 78000 && num <= 79999) || (num >= 78608 && num <= 78816)) {
    return 'NM_PET';
  }

  // Fluoroscopy-guided diagnostic studies (non-IR)
  if (
    (num >= 74210 && num <= 74363) || // GI fluoro studies
    (num >= 74400 && num <= 74485) // GU fluoro studies
  ) {
    return 'FLUORO';
  }

  // Interventional / procedures / biopsies / drains — single bucket per spec
  if (
    (num >= 10004 && num <= 19499 && isImageGuidedBiopsy(num)) ||
    (num >= 32550 && num <= 32674) || // chest tube/pleural procedures
    (num >= 36000 && num <= 36598) || // vascular access procedures
    (num >= 37184 && num <= 37241) || // thrombectomy/embolization/stent
    (num >= 47490 && num <= 47544) || // biliary procedures
    (num >= 49083 && num <= 49423) || // paracentesis, drain placement
    (num >= 50382 && num <= 50435) // nephrostomy
  ) {
    return 'PROCEDURE';
  }

  return 'OTHER';
}

function isPlainFilmExtremity(num: number): boolean {
  // Plain film extremity codes are typically the lower numbers in these
  // ranges; CT/MRI extremity codes are the higher numbers. This is a
  // heuristic default — always user-overridable per code.
  return num % 2 === 0 || num < 73200;
}

function isImageGuidedBiopsy(num: number): boolean {
  // Rough heuristic for image-guided biopsy CPT codes commonly read by
  // radiology (e.g. 19081-19086 breast biopsy). Overridable per code.
  return num >= 19081 && num <= 19086;
}
