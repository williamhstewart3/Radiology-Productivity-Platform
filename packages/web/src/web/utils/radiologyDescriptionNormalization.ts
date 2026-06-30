const COMMON_EXAM_CPT_CODES: Array<{ description: string; cptCodes: string[] }> = [
  { description: 'CT HEAD WO', cptCodes: ['70450'] },
  { description: 'CT CHEST W', cptCodes: ['71260'] },
  { description: 'CT CHEST WO', cptCodes: ['71250'] },
  { description: 'CT CHEST ABDOMEN PELVIS W', cptCodes: ['71260', '74177'] },
  { description: 'CT ABDOMEN PELVIS W', cptCodes: ['74177'] },
  { description: 'CT ABDOMEN PELVIS WO', cptCodes: ['74176'] },
  { description: 'CT ABDOMEN PELVIS WWO', cptCodes: ['74178'] },
  { description: 'CTA CHEST PE', cptCodes: ['71275'] },
  { description: 'CTA HEAD', cptCodes: ['70496'] },
  { description: 'CTA NECK', cptCodes: ['70498'] },
  { description: 'MRI BRAIN WWO', cptCodes: ['70553'] },
  { description: 'US ABDOMEN COMPLETE', cptCodes: ['76700'] },
  { description: 'US RUQ', cptCodes: ['76705'] },
  { description: 'XR CHEST 1 VIEW', cptCodes: ['71045'] },
  { description: 'XR CHEST 2 VIEWS', cptCodes: ['71046'] },
];

function replacePhrase(text: string, phrase: string, replacement: string): string {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`(^|\\s)${escaped}(?=\\s|$)`, 'g'), `$1${replacement}`);
}

function applyPhraseReplacements(text: string): string {
  let normalized = ` ${text} `;

  const phraseRules: Array<[string, string]> = [
    ['CT ANGIOGRAPHY', 'CT ANGIO'],
    ['CT ANGIOGRAM', 'CT ANGIO'],
    ['CTA', 'CT ANGIO'],
    ['WITH AND WITHOUT CONTRAST', 'WWO'],
    ['WITHOUT AND WITH CONTRAST', 'WWO'],
    ['WITH AND WITHOUT', 'WWO'],
    ['WITHOUT AND WITH', 'WWO'],
    ['W / WO', 'WWO'],
    ['W /W O', 'WWO'],
    ['W WO', 'WWO'],
    ['W/WO', 'WWO'],
    ['W-WO', 'WWO'],
    ['WITHOUT CONTRAST', 'WO'],
    ['WITHOUT IV CONTRAST', 'WO'],
    ['W / O CONTRAST', 'WO'],
    ['W / O', 'WO'],
    ['W/O CONTRAST', 'WO'],
    ['W/O', 'WO'],
    ['NON CONTRAST', 'WO'],
    ['NONCONTRAST', 'WO'],
    ['WITH CONTRAST', 'W'],
    ['WITH IV CONTRAST', 'W'],
    ['W CONTRAST', 'W'],
    ['W DYE', 'W'],
    ['W / CONTRAST', 'W'],
    ['W/ CONTRAST', 'W'],
    ['W/CONTRAST', 'W'],
    ['WITH DYE', 'W'],
    ['ABDOMEN AND PELVIS', 'ABD AND PEL'],
    ['ABDOMEN & PELVIS', 'ABD AND PEL'],
    ['ABDOMEN / PELVIS', 'ABD AND PEL'],
    ['ABD / PELVIS', 'ABD AND PEL'],
    ['ABD / PEL', 'ABD AND PEL'],
    ['ABD PELVIS', 'ABD AND PEL'],
    ['ABDOMEN PELVIS', 'ABD AND PEL'],
    ['ABD PEL', 'ABD AND PEL'],
    ['ABDOMEN', 'ABD'],
    ['PELVIS', 'PEL'],
    ['CHEST', 'THORAX'],
  ];

  for (const [phrase, replacement] of phraseRules.sort((a, b) => b[0].length - a[0].length)) {
    normalized = replacePhrase(normalized, phrase, replacement);
  }

  return normalized;
}

export function normalizeRadiologyDescription(raw: string): string {
  let text = raw.toUpperCase().trim();
  if (!text) return '';

  text = text
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/&/g, ' AND ')
    .replace(/[_.,;:()\[\]{}+]/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s*\/\s*/g, ' / ')
    .replace(/\s+/g, ' ')
    .trim();

  text = applyPhraseReplacements(text);
  text = text
    .replace(/\bCT\s+THORAX\b/g, 'CT THORAX')
    .replace(/\bMR\b/g, 'MRI')
    .replace(/\bU\s*\/\s*S\b/g, 'US')
    .replace(/\bULTRASOUND\b/g, 'US')
    .replace(/\bX\s*RAY\b/g, 'XR')
    .replace(/\bX-RAY\b/g, 'XR')
    .replace(/\bRADIOGRAPH\b/g, 'XR')
    .replace(/\bONE VIEW\b/g, '1 VIEW')
    .replace(/\bTWO VIEWS?\b/g, '2 VIEWS')
    .replace(/\b1V\b/g, '1 VIEW')
    .replace(/\b2V\b/g, '2 VIEWS')
    .replace(/\bCOMPLETE\b/g, 'COMPLETE')
    .replace(/\bRIGHT UPPER QUADRANT\b/g, 'RUQ')
    .replace(/\bRUQ ABD\b/g, 'RUQ')
    .replace(/\bPULMONARY EMBOLISM\b/g, 'PE')
    .replace(/\bPE PROTOCOL\b/g, 'PE')
    .replace(/\bCONTRAST\b/g, '')
    .replace(/\bWITHOUT\b/g, 'WO')
    .replace(/\bWITH\b/g, 'W')
    .replace(/\bDYE\b/g, '')
    .replace(/\bAND AND\b/g, 'AND')
    .replace(/\s+/g, ' ')
    .trim();

  text = applyPhraseReplacements(text)
    .replace(/\bABDOMEN\b/g, 'ABD')
    .replace(/\bPELVIS\b/g, 'PEL')
    .replace(/\bCHEST\b/g, 'THORAX')
    .replace(/\s+/g, ' ')
    .trim();

  return text;
}

export function getCommonRadiologyMappingCodes(raw: string): string[] {
  const normalized = normalizeRadiologyDescription(raw);
  const match = COMMON_EXAM_CPT_CODES.find(
    (mapping) => normalizeRadiologyDescription(mapping.description) === normalized,
  );
  return match?.cptCodes ?? [];
}
