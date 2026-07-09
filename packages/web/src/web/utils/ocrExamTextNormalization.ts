const MODALITY_PREFIX_SPACING: Array<[RegExp, string]> = [
  [/\bCTA(?=ABD(?:OMEN)?\b)/gi, 'CTA '],
  [/\bCTA(?=CHEST\b|HEAD\b|NECK\b|PELVIS\b|PE\b)/gi, 'CTA '],
  [/\bCT(?=CHEST\b|ABD(?:OMEN)?\b|PELVIS\b|HEAD\b|BRAIN\b|NECK\b|SPINE\b|CAP\b|LDCT\b|CARDIAC\b|RENAL\b|APPENDIX\b)/gi, 'CT '],
  [/\bXR(?=CHEST\b|ABDOMEN\b|WRIST\b|HAND\b|HIP\b|SHOULDER\b|KNEE\b|ANKLE\b|FOOT\b|PELVIS\b)/gi, 'XR '],
  [/\bMRI(?=BRAIN\b|ABD(?:OMEN)?\b|PELVIS\b|LUMBAR\b|CERVICAL\b|THORACIC\b|BREAST\b|SPINE\b)/gi, 'MRI '],
  [/\bMRA(?=HEAD\b|NECK\b|BRAIN\b|CHEST\b|ABD(?:OMEN)?\b|PELVIS\b)/gi, 'MRA '],
  [/\bUS(?=BREAST\b|ABD(?:OMEN)?\b|PELVIS\b|THYROID\b|SCROTUM\b|RENAL\b|KIDNEY\b|RUQ\b)/gi, 'US '],
];

const RADIOLOGY_OCR_CORRECTIONS: Array<[RegExp, string]> = [
  [/\bXR\s*CHEST\s*[- ]?\s*(?:PORTABLE|PORFABLE|FORTABLE|PORTBLE)\b/gi, 'XR CHEST PORTABLE'],
  [/\bOBLIGUE\b/gi, 'OBLIQUE'],
  [/\bCONTRST\b/gi, 'CONTRAST'],
  [/\bCONTRASTT\b/gi, 'CONTRAST'],
  [/\bWCONTRAST\b/gi, 'W CONTRAST'],
  [/\bWO\s*CONTRST\b/gi, 'WO CONTRAST'],
  [/\bWOCONTRAST\b/gi, 'WO CONTRAST'],
  [/\bPORTBLE\b/gi, 'PORTABLE'],
  [/\bABDCOMEN\b/gi, 'ABDOMEN'],
  [/\bABDOMN\b/gi, 'ABDOMEN'],
  [/\bPELVS\b/gi, 'PELVIS'],
  [/\bLATERL\b/gi, 'LATERAL'],
  [/\bLATRL\b/gi, 'LATERAL'],
  [/\bPA\s*\/\s*LAT(?:ERAL)?\b/gi, 'PA LATERAL'],
  [/\bAP\s*\/\s*LAT(?:ERAL)?\b/gi, 'AP LATERAL'],
];

function stripTrailingOcrDateTimeGarbage(raw: string): string {
  let text = raw.trim();
  let previous = '';

  while (text !== previous) {
    previous = text;
    text = text
      .replace(/\s+\b\d{1,2}\s*:?\s*\d{2}\s*(?:AM|PM)\b$/i, '')
      .replace(/\s+\b(?:AT\s+)?(?:AM|PM)\b$/i, '')
      .replace(/\s+\bAT\b$/i, '')
      .replace(/\s+\b[A-Z]?\/\d{4,8}\b$/i, '')
      .replace(/\s+\b[A-Z]?\d{0,2}20\d{2}\b$/i, '')
      .replace(/\s+\b[TF]\d{4,8}\b$/i, '')
      .replace(/\s+\b\d{5,8}\b$/i, '')
      .replace(/\s+\b\d{3,4}\s*(?:AM|PM)\b$/i, '')
      .replace(/\s+\b\d{1,2}\d{4}\b$/i, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  return text;
}

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
  for (const [pattern, replacement] of RADIOLOGY_OCR_CORRECTIONS) {
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
    .replace(/\bWO\s*\/\s*CONTRAST\b/gi, 'WO CONTRAST')
    .replace(/\bW\/O\s*CONTRAST\b/gi, 'WO CONTRAST')
    .replace(/\bWITH\s+CONTRAST\b/gi, 'W CONTRAST')
    .replace(/\bW\s+DYE\b/gi, 'W CONTRAST')
    .replace(/\bWITH\s+DYE\b/gi, 'W CONTRAST')
    .replace(/\s+/g, ' ')
    .trim();

  text = stripTrailingOcrDateTimeGarbage(text);

  return text;
}
