const MODALITY_PREFIX_SPACING: Array<[RegExp, string]> = [
  [/\bCTA(?=ABD(?:OMEN)?\b)/gi, 'CTA '],
  [/\bCTA(?=CHEST\b|HEAD\b|NECK\b|PELVIS\b|PE\b)/gi, 'CTA '],
  [/\bCT(?=CHEST\b|ABD(?:OMEN)?\b|PELVIS\b|HEAD\b|BRAIN\b|NECK\b|SPINE\b|CAP\b)/gi, 'CT '],
  [/\bMRI(?=BRAIN\b|ABD(?:OMEN)?\b|PELVIS\b|LUMBAR\b|CERVICAL\b|THORACIC\b|BREAST\b|SPINE\b)/gi, 'MRI '],
  [/\bMRA(?=HEAD\b|NECK\b|BRAIN\b|CHEST\b|ABD(?:OMEN)?\b|PELVIS\b)/gi, 'MRA '],
  [/\bUS(?=BREAST\b|ABD(?:OMEN)?\b|PELVIS\b|THYROID\b|SCROTUM\b|RENAL\b|KIDNEY\b|RUQ\b)/gi, 'US '],
];

export function normalizeOcrExamTextForMatching(raw: string): string {
  let text = raw
    .replace(/[✓✔☑☒●•·]/g, ' ')
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/&/g, ' AND ')
    .replace(/[_,;:()[\]{}]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  for (const [pattern, replacement] of MODALITY_PREFIX_SPACING) {
    text = text.replace(pattern, replacement);
  }

  text = text
    .replace(/^\s*(?:[#>*|/_\\-]+\s*)+/, '')
    .replace(/^\s*(?:(?:v|x|o|i|l|\d{1,4})\s+){1,6}(?=(?:CT|CTA|MRI|MRA|US|XR|X\s*RAY|ULTRASOUND|MAMMO|PET|NM)\b)/i, '')
    .replace(/\bABD\s+AND\s+PELVIS\b/gi, 'ABDOMEN PELVIS')
    .replace(/\bABDOMEN\s+AND\s+PELVIS\b/gi, 'ABDOMEN PELVIS')
    .replace(/\bABD\s+PEL(?:\b|VIS\b)/gi, 'ABDOMEN PELVIS')
    .replace(/\bABD\s+PELVIS\b/gi, 'ABDOMEN PELVIS')
    .replace(/\bABD\b/gi, 'ABDOMEN')
    .replace(/\bW\s*\/\s*CONTRAST\b/gi, 'W CONTRAST')
    .replace(/\bW\/CONTRAST\b/gi, 'W CONTRAST')
    .replace(/\bWITH\s+CONTRAST\b/gi, 'W CONTRAST')
    .replace(/\bW\s+DYE\b/gi, 'W CONTRAST')
    .replace(/\bWITH\s+DYE\b/gi, 'W CONTRAST')
    .replace(/\s+/g, ' ')
    .trim();

  return text;
}
