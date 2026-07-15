import { db } from '../db/database';
import type { CptRvuRow, ExamAlias, ExamDictionaryEntry, MatchCandidate, Modality, OcrLearningEntry } from '../types';
import { combinedSimilarity, normalizeExamText, spacelessKey, stringSimilarity, tokenize, tokenOverlapScore } from './textMatching';
import { normalizeForRadiology } from './examNormalizer';
import { scoreRadiologyMatch, CONFIDENCE_THRESHOLD } from './examLibrary';
import {
  getCommonRadiologyMappingCodes,
  normalizeRadiologyDescription,
} from './radiologyDescriptionNormalization';
import { normalizeOcrExamTextForMatching } from './ocrExamTextNormalization';
import { detectMultipleModalityStarts } from './powerScribeParser';
import { findOrbitCmeSeedMapping } from '../data/orbitCmeSeedMappings';
import { classifyModality } from '../data/modalityClassifier';
import { ACR_CY2026_MPFS_IMPACT_TABLE_SOURCE, isRadiologyActiveCpt } from '../data/acrRadiologyActiveCptSet';

const CPT_CODE_PATTERN = /^\d{5}$/;
const INSTITUTION_PROCEDURE_DICTIONARY_SOURCE = 'Institution procedure dictionary';
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
  return row.modifier === '26' &&
    (row.workRvu ?? 0) > 0 &&
    (row.statusCategory === 'active' || row.statusCategory === 'restricted');
}

type ModalityLane = Modality | 'CTA' | 'MRA' | 'PET' | 'DXA';
type BodyProtocolKeyword =
  | 'CHEST'
  | 'ABDOMEN'
  | 'PELVIS'
  | 'HEAD'
  | 'NECK'
  | 'BRAIN'
  | 'SPINE'
  | 'C_SPINE'
  | 'T_SPINE'
  | 'L_SPINE'
  | 'HIP'
  | 'WRIST'
  | 'HAND'
  | 'TIBIA_FIBULA'
  | 'CHEST_PORTABLE'
  | 'PROSTATE'
  | 'RENAL_STONE'
  | 'APPENDIX'
  | 'CARDIAC_SCORE'
  | 'ANGIOGRAM'
  | 'CAROTID'
  | 'LOWER_EXTREMITY'
  | 'UPPER_EXTREMITY'
  | 'MRCP'
  | 'MAMMO_BIOPSY'
  | 'STEREOTACTIC'
  | 'LUNG_CANCER_SCREENING';

interface ModalityFirstParse {
  lane: ModalityLane | null;
  cleanedProcedure: string;
  keywords: Set<BodyProtocolKeyword>;
}

const LEADING_OCR_JUNK_PATTERN =
  /^(?:(?:[+@#*|/\\_\-.:;()[\]{}<>!?~]+|(?:\u2713|\u2714|\u2611|\u25a0|\u25a1|\u25cf|\u2022)|v\d{1,3}|\d{1,4}|vb|vi|vo|vx|v|l|i|o|x|signed|final|complete(?:d)?|normal|abnormal|new|old|read|unread|warning|warn|alert|check)\s+)+/i;
const FIRST_MODALITY_PATTERN =
  /\b(?:CTA|CT\s*ANGIO(?:GRAM|GRAPHY)?|MR\s*ANGIO(?:GRAM|GRAPHY)?|MRA|MRI|MR|X\s*-?\s*RAY|XR|RADIOGRAPH|US|U\/S|ULTRASOUND|SONOGRAM|PET|NM|NUCLEAR|MAMMO|MAMMOGRAM|MAMMOGRAPHY|DXA|DEXA|FLUORO|FLUOROSCOPY)\b|(?:CT(?=ANGIOGRAM|ANGIOGRAPHY|CARDIAC|CHEST|HEAD|ABDOMEN|RENAL|APPENDIX|LDCT))|(?:XR(?=CHEST|ABDOMEN|WRIST|HAND|HIP|SHOULDER|KNEE|ANKLE|FOOT|PELVIS))|(?:MRI(?=PROSTATE|ABDOMEN|BRAIN|SPINE|CHEST|PELVIS|MRCP))|(?:MRA(?=HEAD|NECK|CHEST|ABDOMEN|PELVIS))|(?:US(?=CAROTID|ARTERIAL|OB|ABDOMEN|PELVIS|RENAL))/i;
const CONCATENATED_MODALITY_REWRITES: Array<[RegExp, string]> = [
  [/^CT(ANGIOGRAM|ANGIOGRAPHY|CARDIAC|CHEST|HEAD|ABDOMEN|RENAL|APPENDIX|LDCT)\b/i, 'CT $1'],
  [/^MRI(PROSTATE|ABDOMEN|BRAIN|SPINE|CHEST|PELVIS|MRCP)\b/i, 'MRI $1'],
  [/^MRA(HEAD|NECK|CHEST|ABDOMEN|PELVIS)\b/i, 'MRA $1'],
  [/^XR(CHEST|ABDOMEN|WRIST|HAND|HIP)\b/i, 'XR $1'],
  [/^US(CAROTID|ARTERIAL|OB|ABDOMEN|PELVIS|RENAL)\b/i, 'US $1'],
];

function normalizeXrViewLanguage(text: string): string {
  if (!/^XR\b/i.test(text)) return text;
  return text
    .replace(/\b(?:PA|AP)\s+LATERAL\s+AND\s+OBLIQUE\b/gi, '3 VIEWS')
    .replace(/\b(?:PA|AP)\s+AND\s+LATERAL\s+AND\s+OBLIQUE\b/gi, '3 VIEWS')
    .replace(/\bPA\s+AND\s+LATERAL\b/gi, '2 VIEWS')
    .replace(/\bAP\s+AND\s+LATERAL\b/gi, '2 VIEWS')
    .replace(/\bAP\b(?!\s+(?:AND|LATERAL|OBLIQUE))\b/gi, '1 VIEW');
}

function stripLeadingOcrJunk(rawInput: string): string {
  let text = normalizeOcrExamTextForMatching(rawInput)
    .replace(/[\u201c\u201d"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const modalityStart = text.search(FIRST_MODALITY_PATTERN);
  if (modalityStart > 0) {
    const prefix = text.slice(0, modalityStart).trim();
    const prefixLooksLikeOcrGutter = /\d|[+@#*|\\_\-.:;()[\]{}<>!?~$]/.test(prefix) ||
      /^(?:SIGNED|FINAL|COMPLETE(?:D)?|NORMAL|ABNORMAL|NEW|OLD|READ|UNREAD|WARNING|ALERT|CHECK)\b/i.test(prefix);
    if (prefixLooksLikeOcrGutter) text = text.slice(modalityStart).trim();
  }

  let previous = '';
  while (text !== previous) {
    previous = text;
    text = text.replace(LEADING_OCR_JUNK_PATTERN, '').trim();
  }

  for (const [pattern, replacement] of CONCATENATED_MODALITY_REWRITES) {
    text = text.replace(pattern, replacement);
  }

  return normalizeXrViewLanguage(text).replace(/\s+/g, ' ').trim();
}

function detectModalityLane(rawInput: string): ModalityLane | null {
  const normalized = stripLeadingOcrJunk(rawInput).toUpperCase();
  if (/^(?:CTA|CT ANGIO(?:GRAM|GRAPHY)?)(?:\b|\s)/.test(normalized)) return 'CTA';
  if (/^(?:MRA|MR ANGIO(?:GRAM|GRAPHY)?)(?:\b|\s)/.test(normalized)) return 'MRA';
  if (/^CT(?:\b|\s)/.test(normalized)) return 'CT';
  if (/^(?:MRI|MR)(?:\b|\s)/.test(normalized)) return 'MRI';
  if (/^(?:XR|X RAY|X-RAY|RADIOGRAPH)(?:\b|\s)/.test(normalized)) return 'XR';
  if (/^(?:US|U\/S|ULTRASOUND|SONOGRAM)(?:\b|\s)/.test(normalized)) return 'US';
  if (/^PET(?:\b|\s)/.test(normalized)) return 'PET';
  if (/^(?:NM|NUCLEAR)(?:\b|\s)/.test(normalized)) return 'NM_PET';
  if (/^(?:MAMMO|MAMMOGRAM|MAMMOGRAPHY)(?:\b|\s)/.test(normalized)) return 'MAMMO';
  if (/^(?:DXA|DEXA)(?:\b|\s)/.test(normalized)) return 'DXA';
  if (/^(?:FLUORO|FLUOROSCOPY)(?:\b|\s)/.test(normalized)) return 'FLUORO';
  const orbitMapping = findOrbitCmeSeedMapping(normalized);
  if (orbitMapping) {
    const orbitModality = classifyModality(orbitMapping.cptCode);
    if (orbitModality === 'CT' || orbitModality === 'MRI' || orbitModality === 'XR' || orbitModality === 'US' || orbitModality === 'NM_PET' || orbitModality === 'MAMMO' || orbitModality === 'FLUORO') {
      return orbitModality;
    }
    return null;
  }
  if (/\b(?:CTA|CT ANGIO(?:GRAM|GRAPHY)?)\b/.test(normalized)) return 'CTA';
  if (/\b(?:MRA|MR ANGIO(?:GRAM|GRAPHY)?)\b/.test(normalized)) return 'MRA';
  if (/\bCT\b/.test(normalized)) return 'CT';
  if (/\b(?:MRI|MR)\b/.test(normalized)) return 'MRI';
  if (/\b(?:XR|X RAY|X-RAY|RADIOGRAPH)\b/.test(normalized)) return 'XR';
  if (/\b(?:US|U\/S|ULTRASOUND|SONOGRAM)\b/.test(normalized)) return 'US';
  if (/\bPET\b/.test(normalized)) return 'PET';
  if (/\b(?:NM|NUCLEAR)\b/.test(normalized)) return 'NM_PET';
  if (/\b(?:MAMMO|MAMMOGRAM|MAMMOGRAPHY)\b/.test(normalized)) return 'MAMMO';
  return null;
}

function extractBodyProtocolKeywords(text: string): Set<BodyProtocolKeyword> {
  const normalized = normalizeRadiologyDescription(text);
  const upper = stripLeadingOcrJunk(text).toUpperCase();
  const keywords = new Set<BodyProtocolKeyword>();
  if (/\b(?:CHEST|THORAX)\b/.test(upper) || /\bTHORAX\b/.test(normalized)) keywords.add('CHEST');
  if (/\b(?:ABDOMEN|ABD)\b/.test(upper) || /\bABD\b/.test(normalized)) keywords.add('ABDOMEN');
  if (/\b(?:PELVIS|PEL)\b/.test(upper) || /\bPEL\b/.test(normalized)) keywords.add('PELVIS');
  if (/\bHEAD\b/.test(upper)) keywords.add('HEAD');
  if (/\bNECK\b/.test(upper)) keywords.add('NECK');
  if (/\bBRAIN\b/.test(upper)) keywords.add('BRAIN');
  if (/\b(?:SPINE|CERVICAL|THORACIC|LUMBAR)\b/.test(upper)) keywords.add('SPINE');
  if (/\b(?:C SPINE|CERVICAL)\b/.test(upper)) keywords.add('C_SPINE');
  if (/\b(?:T SPINE|THORACIC)\b/.test(upper)) keywords.add('T_SPINE');
  if (/\b(?:L SPINE|LUMBAR)\b/.test(upper)) keywords.add('L_SPINE');
  if (/\bHIP\b/.test(upper)) keywords.add('HIP');
  if (/\bWRIST\b/.test(upper)) keywords.add('WRIST');
  if (/\bHAND\b/.test(upper)) keywords.add('HAND');
  if (/\bTIBIA\s+(?:AND\s+)?FIBULA\b|\bTIB\s*[/ -]?\s*FIB\b/.test(upper)) keywords.add('TIBIA_FIBULA');
  if (/\bCHEST\b.*\bPORTABLE\b|\bPORTABLE\b.*\bCHEST\b/.test(upper)) keywords.add('CHEST_PORTABLE');
  if (/\bPROSTATE\b/.test(upper)) keywords.add('PROSTATE');
  if (/\bRENAL\b.*\bSTONE\b|\bSTONE\b.*\bPROTOCOL\b/.test(upper)) keywords.add('RENAL_STONE');
  if (/\bAPPENDIX\b|\bAPPENDICITIS\b/.test(upper)) keywords.add('APPENDIX');
  if (/\bCARDIAC\b.*\b(?:SCORE|SCORING)\b|\bCALCIUM\b.*\bSCORE\b/.test(upper)) keywords.add('CARDIAC_SCORE');
  if (/\b(?:ANGIOGRAM|ANGIOGRAPHY|CTA|MRA)\b/.test(upper)) keywords.add('ANGIOGRAM');
  if (/\bCAROTID\b/.test(upper)) keywords.add('CAROTID');
  if (/\b(?:LOWER EXTREMITY|LOWER EXT|LEG)\b/.test(upper)) keywords.add('LOWER_EXTREMITY');
  if (/\b(?:UPPER EXTREMITY|UPPER EXT|ARM)\b/.test(upper)) keywords.add('UPPER_EXTREMITY');
  if (/\bMRCP\b/.test(upper)) keywords.add('MRCP');
  if (/\bMAMMO\b.*\bBIOPSY\b|\bBREAST\b.*\bBIOPSY\b/.test(upper)) keywords.add('MAMMO_BIOPSY');
  if (/\bSTEREOTACTIC\b|\bSTEREO\b/.test(upper)) keywords.add('STEREOTACTIC');
  if (/\b(?:LUNG CANCER SCREEN|LDCT|LOW DOSE)\b/.test(upper)) keywords.add('LUNG_CANCER_SCREENING');
  return keywords;
}

function parseModalityFirst(rawInput: string): ModalityFirstParse {
  const cleanedProcedure = stripLeadingOcrJunk(rawInput);
  return {
    lane: detectModalityLane(cleanedProcedure),
    cleanedProcedure,
    keywords: extractBodyProtocolKeywords(cleanedProcedure),
  };
}

function rowMatchesModalityLane(row: CptRvuRow, lane: ModalityLane | null): boolean {
  if (!lane) return true;
  const description = `${row.description} ${row.cptCode} ${row.modality}`.toUpperCase();
  const isAngio = /\b(?:ANGIO|ANGIOGRAPHY|CTA|MRA)\b/.test(description);
  if (lane === 'CTA') return row.modality === 'CT' && /\b(?:ANGIO|ANGIOGRAPHY|CTA)\b/.test(description);
  if (lane === 'MRA') return row.modality === 'MRI' && /\b(?:ANGIO|ANGIOGRAPHY|MRA)\b/.test(description);
  if (lane === 'PET') return row.modality === 'NM_PET' && /\bPET\b/.test(description);
  if (lane === 'DXA') return /^(?:77080|77081|77085|77086|77072|77078)$/.test(row.cptCode) || /\b(?:DXA|DEXA|BONE DENSITY|BONE AGE)\b/.test(description);
  if (lane === 'MAMMO') return row.modality === 'MAMMO' || /\b(?:MAMMO|MAMMOGRAM|MAMMOGRAPHY|BREAST|TOMOSYNTHESIS|STEREOTACTIC)\b/.test(description);
  if (lane === 'FLUORO') return row.modality === 'FLUORO' || /\bFLUORO/.test(description);
  if (lane === 'CT') return row.modality === 'CT' && !isAngio;
  if (lane === 'MRI') return row.modality === 'MRI' && !isAngio;
  return row.modality === lane;
}

function isAutoMatchEligibleRow(row: CptRvuRow): boolean {
  return row.includeInAutoMatch === true || isRadiologyActiveCpt(row.cptCode);
}

function candidateMatchesModalityLane(candidate: MatchCandidate, lane: ModalityLane | null): boolean {
  if (!lane) return true;
  const description = `${candidate.description} ${candidate.cptCode} ${candidate.modality ?? ''}`.toUpperCase();
  const isAngio = /\b(?:ANGIO|ANGIOGRAPHY|CTA|MRA)\b/.test(description);
  if (lane === 'CTA') return candidate.modality === 'CT' && /\b(?:ANGIO|ANGIOGRAPHY|CTA)\b/.test(description);
  if (lane === 'MRA') return candidate.modality === 'MRI' && /\b(?:ANGIO|ANGIOGRAPHY|MRA)\b/.test(description);
  if (lane === 'PET') return candidate.modality === 'NM_PET' && /\bPET\b/.test(description);
  if (lane === 'DXA') return /^(?:77080|77081|77085|77086|77072|77078)$/.test(candidate.cptCode) || /\b(?:DXA|DEXA|BONE DENSITY|BONE AGE)\b/.test(description);
  if (lane === 'MAMMO') return candidate.modality === 'MAMMO' || /\b(?:MAMMO|MAMMOGRAM|MAMMOGRAPHY|BREAST|TOMOSYNTHESIS|STEREOTACTIC)\b/.test(description);
  if (lane === 'FLUORO') return candidate.modality === 'FLUORO' || /\bFLUORO/.test(description);
  if (lane === 'CT') return candidate.modality === 'CT' && !isAngio;
  if (lane === 'MRI') return candidate.modality === 'MRI' && !isAngio;
  return candidate.modality === lane;
}

function candidateRespectsOrBypassesModalityLane(candidate: MatchCandidate, lane: ModalityLane | null): boolean {
  if (!lane) return true;
  const source = candidate.explanation?.source;
  if (
    candidate.method === 'alias_match' ||
    source === 'exam dictionary' ||
    source === 'Orbit CME seed mapping' ||
    source === INSTITUTION_PROCEDURE_DICTIONARY_SOURCE ||
    source === 'Institution mapping' ||
    source === 'OCR learning table'
  ) return true;
  return candidateMatchesModalityLane(candidate, lane);
}

function rowToCandidate(
  rawInput: string,
  row: CptRvuRow,
  confidence: number,
  method: MatchCandidate['method'],
  source = 'CMS RVU table',
): MatchCandidate {
  const normalizedText = normalizeRadiologyDescription(rawInput);
  const effectiveSource = source === 'CMS RVU table' && isAutoMatchEligibleRow(row)
    ? ACR_CY2026_MPFS_IMPACT_TABLE_SOURCE
    : source;
  return {
    cptCode: row.cptCode,
    modifier: row.modifier,
    description: row.description,
    workRvu: row.workRvu,
    modality: row.modality,
    confidence: Math.min(1, Math.max(0, confidence)),
    method,
    explanation: {
      rawText: rawInput,
      normalizedText,
      source: effectiveSource,
      detail: `${row.cptCode}${row.modifier ? `-${row.modifier}` : ''} from ${effectiveSource}; CMS description: ${row.description}`,
    },
  };
}

function serializeCandidateKey(candidate: Pick<MatchCandidate, 'cptCode' | 'modifier'>): string {
  return candidate.modifier ? `${candidate.cptCode}-${candidate.modifier}` : candidate.cptCode;
}

function aliasConfidence(alias: ExamAlias): number {
  const confirmations = alias.confirmations ?? alias.timesUsed ?? 1;
  const corrections = alias.corrections ?? 0;
  const rejections = alias.rejections ?? 0;
  const base = alias.matchConfidence ?? 0.90;
  const confirmationBoost = Math.min(0.09, Math.log10(confirmations + 1) * 0.035);
  const penalty = Math.min(0.25, corrections * 0.06 + rejections * 0.10);
  return Math.min(1, Math.max(0.5, base + confirmationBoost - penalty));
}

function parseAliasCode(serialized: string): { cptCode: string; modifier: string | null } {
  const [cptCode, modifier] = serialized.split('-');
  return { cptCode, modifier: modifier ?? null };
}

async function getModifier26Rows(cptCode: string): Promise<CptRvuRow[]> {
  const rows = await db.cptRvuTable.where('cptCode').equals(cptCode.toUpperCase()).toArray();
  return rows.filter(isProductivityRelevantModifier26);
}

async function candidatesForAlias(alias: ExamAlias, confidence?: number): Promise<MatchCandidate[]> {
  const serializedCodes = alias.cptCodes?.length
    ? alias.cptCodes
    : [alias.modifier ? `${alias.cptCode}-${alias.modifier}` : alias.cptCode];

  const candidates: MatchCandidate[] = [];
  for (const serialized of serializedCodes) {
    const { cptCode } = parseAliasCode(serialized);
    const rows = await getModifier26Rows(cptCode);
    for (const row of rows) {
      candidates.push(rowToCandidate(alias.aliasTextRaw, row, confidence ?? aliasConfidence(alias), 'alias_match', alias.siteId ? 'site alias' : 'learned alias'));
    }
  }
  return candidates;
}

async function candidatesForDictionary(rawInput: string, maxResults: number): Promise<MatchCandidate[]> {
  const normalized = normalizeRadiologyDescription(rawInput);
  const normalizedSpaceless = spacelessKey(rawInput);
  const entries = (await db.examDictionary.toArray()).filter((entry) => entry.source !== 'institution');
  const exactEntry = entries.find((entry) => {
    const knownNames = [
      entry.canonicalDisplayName,
      ...entry.commonSynonyms,
      ...entry.hospitalAliases,
      ...entry.powerScribeNames,
    ];
    return knownNames.some((name) =>
      normalizeRadiologyDescription(name) === normalized ||
      spacelessKey(name) === normalizedSpaceless,
    );
  });
  if (!exactEntry) return [];

  const candidates: MatchCandidate[] = [];
  for (const serialized of exactEntry.cptCodes) {
    const { cptCode } = parseAliasCode(serialized);
    const rows = await getModifier26Rows(cptCode);
    for (const row of rows) candidates.push(rowToCandidate(rawInput, row, 0.985, 'radiology_match', 'exam dictionary'));
    if (dedupeCandidates(candidates).length >= maxResults) break;
  }
  return candidates;
}

async function candidatesForOrbitCmeSeed(rawInput: string): Promise<MatchCandidate[]> {
  const mapping = findOrbitCmeSeedMapping(rawInput);
  if (!mapping) return [];
  const rows = await getModifier26Rows(mapping.cptCode);
  return rows.map((row) => rowToCandidate(rawInput, row, 0.93, 'radiology_match', 'Orbit CME seed mapping'));
}

async function candidatesForOcrLearning(rawInput: string, profileId?: string | null): Promise<MatchCandidate[]> {
  const normalized = normalizeRadiologyDescription(rawInput);
  if (!normalized) return [];
  const normalizedSpaceless = spacelessKey(rawInput);

  const profile = profileId ? await db.radiologistProfiles.get(profileId) : null;
  const siteId = profile?.practiceId ?? null;
  let rawEntries = await db.ocrLearningEntries
    .where('normalizedOcrText')
    .equals(normalized)
    .toArray();
  if (rawEntries.length === 0) {
    rawEntries = (await db.ocrLearningEntries.toArray()).filter((entry) => spacelessKey(entry.normalizedOcrText) === normalizedSpaceless);
  }
  const entries = rawEntries
    .filter((entry) =>
      (entry.profileId === (profileId ?? null) || entry.profileId == null) &&
      ((entry.siteId ?? null) === siteId || entry.siteId == null),
    )
    .sort((a, b) => {
      const score = (entry: OcrLearningEntry) =>
        (entry.profileId === (profileId ?? null) ? 0 : 4) +
        ((entry.siteId ?? null) === siteId ? 0 : entry.siteId == null ? 2 : 6) -
        entry.confidence;
      return score(a) - score(b);
    });

  const candidates: MatchCandidate[] = [];
  for (const entry of entries) {
    const rows = await getModifier26Rows(entry.matchedCpt);
    for (const row of rows) {
      if (entry.modifier && row.modifier !== entry.modifier) continue;
      candidates.push(rowToCandidate(rawInput, row, entry.confidence, 'ocr_match', 'OCR learning table'));
    }
  }
  return candidates;
}

async function candidatesForCommonRadiologyMapping(rawInput: string): Promise<MatchCandidate[]> {
  const candidates: MatchCandidate[] = [];
  for (const cptCode of getCommonRadiologyMappingCodes(rawInput)) {
    const rows = await getModifier26Rows(cptCode);
    for (const row of rows) {
      candidates.push(rowToCandidate(rawInput, row, 0.99, 'radiology_match', 'common radiology mapping'));
    }
  }
  return candidates;
}

function dictionaryKnownNames(entry: Pick<ExamDictionaryEntry, 'canonicalDisplayName' | 'commonSynonyms' | 'hospitalAliases' | 'powerScribeNames'>): string[] {
  return [
    entry.canonicalDisplayName,
    ...entry.commonSynonyms,
    ...entry.hospitalAliases,
    ...entry.powerScribeNames,
  ].filter(Boolean);
}

export type InstitutionResolverMatchType =
  | 'exact_institution_match'
  | 'ocr_tolerant_institution_match'
  | 'ambiguous_institution_match'
  | 'no_institution_match';

export interface InstitutionResolverCandidate {
  entry: ExamDictionaryEntry;
  procedureType: string;
  matchType: Exclude<InstitutionResolverMatchType, 'no_institution_match'>;
  confidence: number;
  score: number;
  exact: boolean;
  corrections: string[];
  hardConflicts: string[];
  truncatedPrefix: boolean;
}

function truncatedInstitutionPrefix(rawInput: string): string | null {
  const match = rawInput.trim().match(/^(.*?)(?:\u2026|\.{2,}|[·•]{2,})\s*$/u);
  if (!match) return null;
  const prefix = normalizeRadiologyDescription(match[1]).trim();
  return prefix.length >= 8 ? prefix : null;
}

export interface InstitutionResolverResult {
  matchType: InstitutionResolverMatchType;
  candidates: InstitutionResolverCandidate[];
  alternatives: InstitutionResolverCandidate[];
}

function ocrTolerantInstitutionKey(raw: string): string {
  return normalizeRadiologyDescription(normalizeOcrExamTextForMatching(raw))
    .replace(/\bCT(?=APPENDIX\b)/g, 'CT ')
    .replace(/\bAPPENDX\b/g, 'APPENDIX')
    .replace(/\bPROT0COL\b/g, 'PROTOCOL')
    .replace(/\bAPPENDIXPROTOCOL\b/g, 'APPENDIX PROTOCOL')
    .replace(/\bOBLIGUE\b/g, 'OBLIQUE')
    .replace(/\bABDCOMEN\b/g, 'ABDOMEN')
    .replace(/\bCONTRST\b/g, 'CONTRAST')
    .replace(/\bWCONTRAST\b/g, 'W CONTRAST')
    .replace(/\bWOCONTRAST\b/g, 'WO CONTRAST')
    .replace(/\s+/g, ' ')
    .trim();
}

function institutionNameKeys(name: string): { normalized: string; spaceless: string; tolerant: string; tolerantSpaceless: string; tokens: string[] } {
  const normalized = normalizeRadiologyDescription(name);
  const tolerant = ocrTolerantInstitutionKey(name);
  return {
    normalized,
    spaceless: normalized.replace(/\s+/g, ''),
    tolerant,
    tolerantSpaceless: tolerant.replace(/\s+/g, ''),
    tokens: tokenize(normalizeExamText(tolerant)),
  };
}

function institutionCorrections(rawInput: string, procedureType: string): string[] {
  const raw = normalizeOcrExamTextForMatching(rawInput).toUpperCase();
  const known = normalizeOcrExamTextForMatching(procedureType).toUpperCase();
  const corrections: string[] = [];
  if (raw.replace(/\s+/g, '') !== known.replace(/\s+/g, '')) corrections.push('spacing/spelling normalized');
  if (/\b(?:PORFABLE|FORTABLE|PORTBLE)\b/.test(raw) && /\bPORTABLE\b/.test(known)) corrections.push('portable OCR spelling corrected');
  if (/\bOBLIGUE\b/.test(raw) && /\bOBLIQUE\b/.test(known)) corrections.push('oblique OCR spelling corrected');
  if (/\bABDCOMEN\b/.test(raw) && /\bABDOMEN\b/.test(known)) corrections.push('abdomen OCR spelling corrected');
  if (/\b(?:WCONTRAST|WOCONTRAST|CONTRST)\b/.test(raw) && /\bCONTRAST\b/.test(known)) corrections.push('contrast OCR spacing/spelling corrected');
  return Array.from(new Set(corrections));
}

function institutionHardConflicts(rawInput: string, procedureType: string): string[] {
  return hasClinicallyMeaningfulInstitutionDifference(rawInput, procedureType)
    ? ['clinically meaningful distinction differs']
    : [];
}

function scoreInstitutionEntry(rawInput: string, entry: ExamDictionaryEntry): InstitutionResolverCandidate {
  const inputKeys = institutionNameKeys(rawInput);
  const truncatedPrefix = truncatedInstitutionPrefix(rawInput);
  const inputLane = detectModalityLane(rawInput);
  const knownNames = dictionaryKnownNames(entry);
  let best = {
    procedureType: entry.institutionProcedureName ?? entry.canonicalDisplayName,
    normalizedScore: 0,
    spacelessScore: 0,
    tolerantScore: 0,
    tokenScore: 0,
    exact: false,
    truncatedPrefix: false,
  };

  for (const name of knownNames) {
    const keys = institutionNameKeys(name);
    const prefixMatch = Boolean(truncatedPrefix && keys.normalized.startsWith(truncatedPrefix));
    const exact = prefixMatch || keys.normalized === inputKeys.normalized || keys.spaceless === inputKeys.spaceless || keys.tolerantSpaceless === inputKeys.tolerantSpaceless;
    const normalizedScore = stringSimilarity(inputKeys.normalized, keys.normalized);
    const spacelessScore = stringSimilarity(inputKeys.spaceless, keys.spaceless);
    const tolerantScore = stringSimilarity(inputKeys.tolerantSpaceless, keys.tolerantSpaceless);
    const tokenScore = tokenOverlapScore(inputKeys.tokens, keys.tokens);
    const score = exact ? 1 : Math.max(normalizedScore * 0.78, spacelessScore * 0.95, tolerantScore * 0.98, tokenScore * 0.82);
    const current = best.exact ? 1 : Math.max(best.normalizedScore * 0.78, best.spacelessScore * 0.95, best.tolerantScore * 0.98, best.tokenScore * 0.82);
    if (score > current) {
      best = { procedureType: name, normalizedScore, spacelessScore, tolerantScore, tokenScore, exact, truncatedPrefix: prefixMatch };
    }
  }

  const modalityBonus = inputLane && entry.modality && rowMatchesModalityLane({ modality: entry.modality, description: entry.canonicalDisplayName, cptCode: entry.cptCodes[0] ?? '', modifier: '26', workRvu: 1, statusCategory: 'active' } as CptRvuRow, inputLane)
    ? 0.03
    : 0;
  const hardConflicts = institutionHardConflicts(rawInput, best.procedureType);
  const baseScore = best.exact ? 1 : Math.max(best.normalizedScore * 0.78, best.spacelessScore * 0.95, best.tolerantScore * 0.98, best.tokenScore * 0.82) + modalityBonus;
  const score = hardConflicts.length > 0 ? Math.min(baseScore, 0.72) : Math.min(1, baseScore);
  const matchType: InstitutionResolverCandidate['matchType'] = best.exact
    ? 'exact_institution_match'
    : 'ocr_tolerant_institution_match';

  return {
    entry,
    procedureType: best.procedureType,
    matchType,
    confidence: best.exact ? 0.995 : Math.min(0.96, Math.max(0.72, score * 0.96)),
    score,
    exact: best.exact,
    corrections: institutionCorrections(rawInput, best.procedureType),
    hardConflicts,
    truncatedPrefix: best.truncatedPrefix,
  };
}

export function resolveInstitutionProcedure(rawInput: string, entries: ExamDictionaryEntry[], maxResults = 5): InstitutionResolverResult {
  const institutionEntries = entries.filter((entry) => entry.source === 'institution');
  if (!rawInput.trim() || institutionEntries.length === 0) {
    return { matchType: 'no_institution_match', candidates: [], alternatives: [] };
  }

  const scored = institutionEntries
    .map((entry) => scoreInstitutionEntry(rawInput, entry))
    .filter((candidate) => candidate.exact || (candidate.score >= 0.80 && candidate.hardConflicts.length === 0))
    .sort((a, b) => Number(b.exact) - Number(a.exact) || b.score - a.score);
  if (scored.length === 0) return { matchType: 'no_institution_match', candidates: [], alternatives: [] };

  const top = scored[0];
  const close = scored.filter((candidate) => candidate.entry.id !== top.entry.id && top.score - candidate.score <= 0.10);
  const ambiguousTruncatedPrefix = top.truncatedPrefix && close.some((candidate) => candidate.exact && candidate.truncatedPrefix);
  if ((!top.exact && close.length > 0) || ambiguousTruncatedPrefix) {
    return {
      matchType: 'ambiguous_institution_match',
      candidates: [top, ...close].slice(0, maxResults).map((candidate) => ({ ...candidate, matchType: 'ambiguous_institution_match' })),
      alternatives: [top, ...close].slice(0, maxResults),
    };
  }

  return {
    matchType: top.exact ? 'exact_institution_match' : 'ocr_tolerant_institution_match',
    candidates: scored.slice(0, maxResults),
    alternatives: scored.slice(1, maxResults),
  };
}

export async function resolveInstitutionDisplayName(rawInput: string): Promise<string | null> {
  const entries = (await db.examDictionary.toArray()).filter((entry) => entry.source === 'institution');
  const resolution = resolveInstitutionProcedure(rawInput, entries, 5);
  if (resolution.matchType === 'ambiguous_institution_match' || resolution.matchType === 'no_institution_match') return null;
  return resolution.candidates[0]?.procedureType ?? null;
}

async function candidatesForInstitutionMappings(rawInput: string, maxResults: number): Promise<MatchCandidate[]> {
  const entries = (await db.examDictionary.toArray())
    .filter((entry) => entry.source === 'institution' && entry.cptCodes.length > 0);
  const resolution = resolveInstitutionProcedure(rawInput, entries, maxResults);
  const scored = resolution.candidates.slice(0, maxResults);

  const candidates: MatchCandidate[] = [];
  for (const { entry, confidence, matchType, procedureType, corrections, hardConflicts } of scored) {
    for (const serialized of entry.cptCodes) {
      const { cptCode } = parseAliasCode(serialized);
      const rows = await getModifier26Rows(cptCode);
      for (const row of rows) {
        const candidate = rowToCandidate(
          rawInput,
          row,
          confidence,
          'radiology_match',
          INSTITUTION_PROCEDURE_DICTIONARY_SOURCE,
        );
        if (candidate.explanation) {
          candidate.explanation.detail =
            `${matchType}; ${row.cptCode}${row.modifier ? `-${row.modifier}` : ''} from Institution procedure dictionary; spreadsheet procedure: ${entry.institutionProcedureName ?? procedureType}; CPT group: ${entry.cptCodes.join(', ')}${corrections.length ? `; corrections: ${corrections.join(', ')}` : ''}${hardConflicts.length ? `; conflicts: ${hardConflicts.join(', ')}` : ''}`;
        }
        candidates.push(candidate);
      }
    }
    if (dedupeCandidates(candidates).length >= maxResults && matchType !== 'exact_institution_match') break;
  }
  return candidates;
}

function hasWord(text: string, pattern: RegExp): boolean {
  return pattern.test(text.toUpperCase());
}

function contrastSignature(text: string): 'w' | 'wo' | 'wwo' | null {
  const upper = normalizeOcrExamTextForMatching(text).toUpperCase();
  if (/\b(?:W\s*WO|WWO|WITH\s+AND\s+WITHOUT|WITHOUT\s+AND\s+WITH|W\/WO)\b/.test(upper)) return 'wwo';
  if (/\b(?:WO|W\/O|WITHOUT|NON\s*CONTRAST|NONCONTRAST)\b/.test(upper)) return 'wo';
  if (/\b(?:W|WITH)\b/.test(upper) || /\bWCONTRAST\b/.test(upper)) return 'w';
  return null;
}

function viewCountSignature(text: string): number | null {
  const upper = normalizeOcrExamTextForMatching(text).toUpperCase();
  const numeric = upper.match(/\b([1-4])\s*(?:VIEW|VIEWS|V)\b/);
  if (numeric) return Number(numeric[1]);
  if (/\b(?:ONE|SINGLE|AP|PORTABLE)\b/.test(upper) && !/\bLATERAL\b/.test(upper)) return 1;
  if (/\b(?:TWO|PA\s+AND\s+LATERAL|PA\s+LATERAL|AP\s+AND\s+LATERAL|AP\s+LATERAL)\b/.test(upper)) return 2;
  if (/\b(?:THREE|OBLIQUE|3\+)\b/.test(upper)) return 3;
  return null;
}

function hasClinicallyMeaningfulInstitutionDifference(rawInput: string, dictionaryName: string): boolean {
  const raw = normalizeOcrExamTextForMatching(rawInput).toUpperCase();
  const known = normalizeOcrExamTextForMatching(dictionaryName).toUpperCase();
  if (detectModalityLane(raw) && detectModalityLane(known) && detectModalityLane(raw) !== detectModalityLane(known)) return true;

  const rawContrast = contrastSignature(raw);
  const knownContrast = contrastSignature(known);
  if (rawContrast && knownContrast && rawContrast !== knownContrast) return true;

  const pairedChecks: Array<[RegExp, RegExp]> = [
    [/\bLEFT\b/, /\bRIGHT\b/],
    [/\bLIMITED\b/, /\bCOMPLETE\b/],
    [/\bUNILATERAL\b/, /\bBILATERAL\b/],
    [/\bARTERIAL\b/, /\bVENOUS\b/],
  ];
  for (const [a, b] of pairedChecks) {
    if ((hasWord(raw, a) && hasWord(known, b)) || (hasWord(raw, b) && hasWord(known, a))) return true;
  }

  const rawViews = viewCountSignature(raw);
  const knownViews = viewCountSignature(known);
  if (rawViews && knownViews && rawViews !== knownViews) return true;

  const exclusiveBodyPairs: Array<[RegExp, RegExp]> = [
    [/\bCHEST\b/, /\bRIBS?\b/],
    [/\bABDOMEN\b|\bABD\b/, /\bPELVIS\b|\bPEL\b/],
    [/\bHEAD\b/, /\bNECK\b/],
  ];
  for (const [a, b] of exclusiveBodyPairs) {
    const rawA = hasWord(raw, a);
    const rawB = hasWord(raw, b);
    const knownA = hasWord(known, a);
    const knownB = hasWord(known, b);
    if (rawA !== knownA && rawB !== knownB) return true;
  }

  return false;
}

function hasNormalizedPhrase(normalized: string, phrase: string): boolean {
  return normalized.includes(normalizeRadiologyDescription(phrase));
}

function deterministicCptCodesFor(parsed: ModalityFirstParse): string[] {
  const normalized = normalizeRadiologyDescription(parsed.cleanedProcedure);
  const upper = parsed.cleanedProcedure.toUpperCase();

  if (parsed.lane === 'XR') {
    if (parsed.keywords.has('CHEST_PORTABLE') || hasNormalizedPhrase(normalized, 'XR CHEST PORTABLE')) return ['71045'];
    if (hasNormalizedPhrase(normalized, 'XR CHEST PA AND LATERAL') || hasNormalizedPhrase(normalized, 'XR CHEST 2 VIEWS')) return ['71046'];
    if (hasNormalizedPhrase(normalized, 'XR ABDOMEN AP') || hasNormalizedPhrase(normalized, 'XR ABDOMEN 1 VIEW')) return ['74018'];
    if (parsed.keywords.has('TIBIA_FIBULA')) return ['73590'];
    if (/\bXR\b.*\bWRIST\b.*\b(?:PA|LATERAL|OBLIQUE|3 VIEWS)\b/i.test(upper)) return ['73110'];
    if (/\bXR\b.*\bHAND\b.*\b(?:PA|LATERAL|OBLIQUE)\b/i.test(upper)) return ['73130'];
    if (/\bXR\b.*\bHIP\b.*\bPELVIS\b.*\b(?:AP|LATERAL)\b/i.test(upper) || /\bXR\b.*\bPELVIS\b.*\bHIP\b.*\b(?:AP|LATERAL)\b/i.test(upper)) return ['73502'];
  }

  if (parsed.lane === 'CT') {
    if (parsed.keywords.has('CARDIAC_SCORE') || hasNormalizedPhrase(normalized, 'CT CARDIAC SCORING') || hasNormalizedPhrase(normalized, 'CT CARDIAC SCORE SPECIAL')) return ['75571'];
    if (parsed.keywords.has('LUNG_CANCER_SCREENING')) return ['71271'];
    if (parsed.keywords.has('RENAL_STONE')) return ['74176'];
    if (parsed.keywords.has('APPENDIX')) return ['74177'];
    if (parsed.keywords.has('CHEST') && parsed.keywords.has('ABDOMEN') && parsed.keywords.has('PELVIS')) {
      if (/\bW\s*WO\b|\bWWO\b|\bWITH AND WITHOUT\b/i.test(upper)) return ['71270', '74178'];
      if (/\bWO\b|\bWITHOUT\b|\bW\/O\b/i.test(upper)) return ['71250', '74176'];
      return ['71260', '74177'];
    }
    if (parsed.keywords.has('ABDOMEN') && parsed.keywords.has('PELVIS')) {
      if (/\bW\s*WO\b|\bWWO\b|\bWITH AND WITHOUT\b/i.test(upper)) return ['74178'];
      if (/\bWO\b|\bWITHOUT\b|\bW\/O\b/i.test(upper)) return ['74176'];
      return ['74177'];
    }
    if (parsed.keywords.has('HEAD')) {
      if (/\bWO\b|\bWITHOUT\b|\bW\/O\b/i.test(upper)) return ['70450'];
      if (/\bW\b|\bWITH\b|\bCONTRAST\b/i.test(upper)) return ['70460'];
    }
    if (parsed.keywords.has('CHEST')) {
      if (/\bWO\b|\bWITHOUT\b|\bW\/O\b/i.test(upper)) return ['71250'];
      if (/\bW\b|\bWITH\b|\bCONTRAST\b/i.test(upper)) return ['71260'];
    }
  }

  if (parsed.lane === 'CTA') {
    if (parsed.keywords.has('HEAD') && parsed.keywords.has('NECK')) return ['70496', '70498'];
    if (/\b(?:PULMONARY EMBOLUS|PULMONARY EMBOLISM|PE STUDY|PE PROTOCOL)\b/i.test(upper)) return ['71275'];
    if (/\b(?:CORONARY|CARDIAC IMAGE)\b/i.test(upper)) return ['75574'];
  }

  if (parsed.lane === 'MRI') {
    if (/\bWRIST\b/i.test(upper)) {
      if (/\bW\s*WO\b|\bWWO\b|\bWITH AND WITHOUT\b/i.test(upper)) return ['73223'];
      if (/\bWO\b|\bWITHOUT\b|\bW\/O\b/i.test(upper)) return ['73221'];
      if (/\bW\b|\bWITH\b|\bCONTRAST\b/i.test(upper)) return ['73222'];
      return ['73221', '73222', '73223'];
    }
    if (parsed.keywords.has('PROSTATE')) return ['72197'];
    if (parsed.keywords.has('MRCP') && parsed.keywords.has('ABDOMEN')) return ['74183'];
    if (parsed.keywords.has('ABDOMEN') && (/\bW\s*WO\b|\bWWO\b|\bWITH AND WITHOUT\b/i.test(upper))) return ['74183'];
  }

  if (parsed.lane === 'US') {
    if (parsed.keywords.has('CAROTID') && /\bBILATERAL\b/i.test(upper)) return ['93880'];
    if (parsed.keywords.has('LOWER_EXTREMITY') && /\bARTERIAL\b/i.test(upper)) {
      return /\bBILATERAL\b/i.test(upper) ? ['93925'] : ['93926'];
    }
    if (parsed.keywords.has('LOWER_EXTREMITY') && /\bVENOUS\b/i.test(upper)) {
      return /\bBILATERAL\b/i.test(upper) ? ['93970'] : ['93971'];
    }
    if (/\bOB\b.*(?:<|LESS THAN|LT)\s*14\b|\bOB\b.*\bFIRST GESTATION\b|\bOB\b.*\bSINGLE\b/i.test(upper)) return ['76801'];
  }

  return [];
}

async function candidatesForDeterministicProtocol(rawInput: string, parsed: ModalityFirstParse): Promise<MatchCandidate[]> {
  const candidates: MatchCandidate[] = [];
  for (const cptCode of deterministicCptCodesFor(parsed)) {
    const rows = await getModifier26Rows(cptCode);
    for (const row of rows) {
      candidates.push(rowToCandidate(rawInput, row, 0.995, 'radiology_match', 'deterministic protocol mapping'));
    }
  }
  return candidates;
}

function rowMatchesKeyword(row: CptRvuRow, keyword: BodyProtocolKeyword): boolean {
  const description = `${row.description} ${row.cptCode}`.toUpperCase();
  switch (keyword) {
    case 'CHEST':
      return /\b(?:CHEST|THORAX)\b/.test(description);
    case 'ABDOMEN':
      return /\b(?:ABDOMEN|ABD)\b/.test(description);
    case 'PELVIS':
      return /\b(?:PELVIS|PEL)\b/.test(description);
    case 'HEAD':
      return /\bHEAD\b/.test(description);
    case 'NECK':
      return /\bNECK\b/.test(description);
    case 'BRAIN':
      return /\bBRAIN\b/.test(description);
    case 'SPINE':
      return /\b(?:SPINE|CERVICAL|THORACIC|LUMBAR|C-SPINE|T-SPINE|L-SPINE)\b/.test(description);
    case 'C_SPINE':
      return /\b(?:CERVICAL|C-SPINE|C SPINE)\b/.test(description);
    case 'T_SPINE':
      return /\b(?:THORACIC|T-SPINE|T SPINE)\b/.test(description);
    case 'L_SPINE':
      return /\b(?:LUMBAR|L-SPINE|L SPINE)\b/.test(description);
    case 'HIP':
      return /\bHIP\b/.test(description);
    case 'WRIST':
      return /\bWRIST\b/.test(description);
    case 'HAND':
      return /\bHAND\b/.test(description);
    case 'TIBIA_FIBULA':
      return row.cptCode === '73590' || (/\bTIBIA\b/.test(description) && /\bFIBULA\b/.test(description));
    case 'CHEST_PORTABLE':
      return /\bCHEST\b/.test(description) && /\b(?:1 VIEW|PORTABLE)\b/.test(description);
    case 'PROSTATE':
      return /\bPROSTATE\b/.test(description) || row.cptCode === '72197';
    case 'RENAL_STONE':
      return row.cptCode === '74176' || /\bRENAL\b.*\bSTONE\b/.test(description);
    case 'APPENDIX':
      return row.cptCode === '74177' || /\bAPPENDIX\b/.test(description);
    case 'CARDIAC_SCORE':
      return row.cptCode === '75571' || /\b(?:CALCIUM SCORE|CARDIAC SCORE)\b/.test(description);
    case 'ANGIOGRAM':
      return /\b(?:ANGIO|ANGIOGRAPHY|CTA|MRA)\b/.test(description);
    case 'CAROTID':
      return /\bCAROTID\b/.test(description) || row.cptCode === '93880';
    case 'LOWER_EXTREMITY':
      return /\b(?:LOWER EXTREMITY|LEG|LOWER)\b/.test(description);
    case 'UPPER_EXTREMITY':
      return /\b(?:UPPER EXTREMITY|ARM|UPPER)\b/.test(description);
    case 'MRCP':
      return row.cptCode === '74183' || /\bMRCP\b/.test(description);
    case 'MAMMO_BIOPSY':
      return /\b(?:BREAST|MAMMO)\b.*\bBIOPSY\b/.test(description) || /^1908[1-6]$/.test(row.cptCode);
    case 'STEREOTACTIC':
      return /\b(?:STEREOTACTIC|STEREO)\b/.test(description);
    case 'LUNG_CANCER_SCREENING':
      return row.cptCode === '71271' || /\b(?:LUNG SCREEN|LOW-DOSE|LOW DOSE)\b/.test(description);
    default:
      return false;
  }
}

function keywordScopedRows(rows: CptRvuRow[], parsed: ModalityFirstParse): CptRvuRow[] {
  const priorityGroups: BodyProtocolKeyword[][] = [
    ['CARDIAC_SCORE', 'RENAL_STONE', 'APPENDIX', 'LUNG_CANCER_SCREENING', 'MRCP', 'MAMMO_BIOPSY', 'STEREOTACTIC'],
    ['PROSTATE', 'CAROTID', 'CHEST_PORTABLE'],
    ['C_SPINE', 'T_SPINE', 'L_SPINE', 'SPINE', 'HIP', 'WRIST', 'HAND', 'TIBIA_FIBULA', 'HEAD', 'NECK', 'BRAIN', 'CHEST', 'ABDOMEN', 'PELVIS', 'LOWER_EXTREMITY', 'UPPER_EXTREMITY'],
  ];

  let scoped = rows;
  for (const group of priorityGroups) {
    const active = group.filter((keyword) => parsed.keywords.has(keyword));
    if (active.length === 0) continue;
    const narrowed = scoped.filter((row) => active.some((keyword) => rowMatchesKeyword(row, keyword)));
    if (narrowed.length > 0) scoped = narrowed;
  }
  return scoped;
}

export function __testParseModalityFirst(rawInput: string): {
  lane: ModalityLane | null;
  cleanedProcedure: string;
  keywords: string[];
} {
  const parsed = parseModalityFirst(rawInput);
  return {
    lane: parsed.lane,
    cleanedProcedure: parsed.cleanedProcedure,
    keywords: Array.from(parsed.keywords).sort(),
  };
}

export function __testDeterministicCptCodesFor(rawInput: string): string[] {
  return deterministicCptCodesFor(parseModalityFirst(rawInput));
}

export function __testAutoMatchRowsFor(rawInput: string, rows: CptRvuRow[]): CptRvuRow[] {
  const parsed = parseModalityFirst(rawInput);
  return keywordScopedRows(
    rows.filter(isAutoMatchEligibleRow).filter((row) => rowMatchesModalityLane(row, parsed.lane)),
    parsed,
  );
}

export function __testHasClinicallyMeaningfulInstitutionDifference(rawInput: string, dictionaryName: string): boolean {
  return hasClinicallyMeaningfulInstitutionDifference(rawInput, dictionaryName);
}

export function __testShouldSuppressMergedProcedureMatching(rawInput: string): boolean {
  return detectMultipleModalityStarts(stripLeadingOcrJunk(rawInput)).hasMultiple;
}

function aliasNormalizedKeys(alias: ExamAlias): string[] {
  const keys = [
    alias.aliasText,
    normalizeExamText(alias.aliasTextRaw),
    normalizeRadiologyDescription(alias.aliasTextRaw),
    normalizeRadiologyDescription(alias.aliasText),
  ].filter(Boolean);
  return Array.from(new Set([...keys, ...keys.map((key) => spacelessKey(key))].filter(Boolean)));
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

function candidateSourcePriority(candidate: MatchCandidate): number {
  const source = candidate.explanation?.source;
  if (source === INSTITUTION_PROCEDURE_DICTIONARY_SOURCE || source === 'Institution mapping') return 0;
  if (candidate.method === 'alias_match') return 1;
  if (source === 'exam dictionary' || source === 'OCR learning table') return 2;
  if (source === 'Orbit CME seed mapping') return 3;
  if (source === 'deterministic protocol mapping' || source === 'common radiology mapping') return 4;
  if (source?.includes('CMS') || source?.includes('ACR')) return 5;
  return 6;
}

function rankCandidatesBySourcePriority(candidates: MatchCandidate[]): MatchCandidate[] {
  return dedupeCandidates(
    [...candidates].sort((a, b) => {
      const priorityDiff = candidateSourcePriority(a) - candidateSourcePriority(b);
      if (priorityDiff !== 0) return priorityDiff;
      const confidenceDiff = b.confidence - a.confidence;
      if (confidenceDiff !== 0) return confidenceDiff;
      return (b.workRvu ?? 0) - (a.workRvu ?? 0);
    }),
  );
}

export function __testRankCandidatesBySourcePriority(candidates: MatchCandidate[]): MatchCandidate[] {
  return rankCandidatesBySourcePriority(candidates);
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
      .map((row) => rowToCandidate(rawInput, row, 1.0, 'manual_cpt', 'direct CPT'))
      .slice(0, maxResults);
  }

  const parsed = parseModalityFirst(trimmed);
  const matchInput = parsed.cleanedProcedure || trimmed;
  if (detectMultipleModalityStarts(matchInput).hasMultiple) return [];
  const normalizedInput = normalizeExamText(matchInput);
  const radiologyDescriptionKey = normalizeRadiologyDescription(matchInput);
  const radiologyNorm = normalizeForRadiology(matchInput);
  const radiologyNormalizedKey = normalizeExamText(radiologyNorm.normalizedTitle);
  const exactKeys = new Set([
    normalizedInput,
    radiologyNormalizedKey,
    radiologyDescriptionKey,
    spacelessKey(normalizedInput),
    spacelessKey(radiologyNormalizedKey),
    spacelessKey(radiologyDescriptionKey),
  ].filter(Boolean));
  const modalityLane = parsed.lane;

  const allAliases = await db.examAliases.toArray();
  const activeProfile = profileId ? await db.radiologistProfiles.get(profileId) : null;
  const activeSiteId = activeProfile?.practiceId ?? null;
  const scopedAliases = allAliases.filter(
    (a) =>
      (a.profileId === (profileId ?? null) || a.profileId == null) &&
      ((a.siteId ?? null) === activeSiteId || a.siteId == null),
  );
  const sortByScope = (aliases: ExamAlias[]) =>
    [...aliases].sort((a, b) => {
      const score = (alias: ExamAlias) =>
        (alias.profileId === (profileId ?? null) ? 0 : 4) +
        ((alias.siteId ?? null) === activeSiteId ? 0 : alias.siteId == null ? 2 : 6);
      return score(a) - score(b);
    });

  const exactAlias = sortByScope(
    scopedAliases.filter((alias) => aliasNormalizedKeys(alias).some((key) => exactKeys.has(key))),
  )[0];

  // The local procedure table is authoritative. Learned exact titles come
  // next, then Orbit CME fills a title that is not known locally. Reference
  // rules and ACR/CMS descriptions remain lower-tier fallbacks.
  candidates.push(...await candidatesForInstitutionMappings(matchInput, maxResults));
  if (exactAlias) candidates.push(...await candidatesForAlias(exactAlias));
  candidates.push(...await candidatesForDictionary(matchInput, maxResults));
  candidates.push(...await candidatesForOcrLearning(matchInput, profileId));
  candidates.push(...await candidatesForOrbitCmeSeed(matchInput));
  candidates.push(...await candidatesForDeterministicProtocol(matchInput, parsed));

  if (rankCandidatesBySourcePriority(candidates).length < maxResults) {
    const commonCandidates = await candidatesForCommonRadiologyMapping(matchInput);
    if (commonCandidates.length > 0) {
      return rankCandidatesBySourcePriority([...candidates, ...commonCandidates])
        .filter((candidate) => candidate.modifier === '26' && (candidate.workRvu ?? 0) > 0)
        .filter((candidate) => candidateRespectsOrBypassesModalityLane(candidate, modalityLane))
        .slice(0, maxResults);
    }
  }

  const allCpt = rankCandidatesBySourcePriority(candidates).length < maxResults
    ? await db.cptRvuTable.where('statusCategory').anyOf(['active', 'restricted']).toArray()
    : [];
  const autoMatchCpt = allCpt.filter(isAutoMatchEligibleRow);
  const modalityScopedCpt = autoMatchCpt.filter((row) => rowMatchesModalityLane(row, modalityLane));
  const keywordScopedCpt = keywordScopedRows(modalityScopedCpt, parsed);

  if (candidates.length < maxResults) {
    const exactDescriptionRows = keywordScopedCpt
      .filter(isProductivityRelevantModifier26)
      .filter((row) => normalizeRadiologyDescription(row.description) === radiologyDescriptionKey);

    for (const row of exactDescriptionRows) {
      candidates.push(rowToCandidate(matchInput, row, 0.96, 'radiology_match', 'exact ACR-active CMS description'));
      if (dedupeCandidates(candidates).length >= maxResults) break;
    }
  }

  if (candidates.length < maxResults) {
    const fuzzyAliasScored = scopedAliases
      .map((alias) => ({
        alias,
        score: Math.max(
          combinedSimilarity(matchInput, alias.aliasTextRaw),
          combinedSimilarity(radiologyDescriptionKey, normalizeRadiologyDescription(alias.aliasTextRaw)),
        ),
      }))
      .filter((x) => x.score >= 0.5)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults);

    for (const { alias, score } of fuzzyAliasScored) {
      candidates.push(...await candidatesForAlias(alias, Math.min(aliasConfidence(alias), score * 0.9)));
    }
  }

  if (candidates.length < maxResults) {
    const descScored = keywordScopedCpt
      .filter(isProductivityRelevantModifier26)
      .map((row) => {
        const normalizedDescription = normalizeRadiologyDescription(row.description);
        const exactNormalizedScore = normalizedDescription === radiologyDescriptionKey ? 0.96 : 0;
        const radioScore = scoreRadiologyMatch(radiologyNorm, row.description);
        const normalizedTextScore = combinedSimilarity(radiologyDescriptionKey, normalizedDescription);
        const keywordBoost = Array.from(parsed.keywords).some((keyword) => rowMatchesKeyword(row, keyword)) ? 0.08 : 0;
        return { row, score: Math.min(0.89, Math.max(exactNormalizedScore, radioScore, normalizedTextScore * 0.92) + keywordBoost) };
      })
      .filter((x) => x.score >= 0.35)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults * 3);

    for (const { row, score } of descScored) {
      candidates.push(rowToCandidate(matchInput, row, score, 'radiology_match', 'ACR-active CMS fuzzy match'));
      if (dedupeCandidates(candidates).length >= maxResults) break;
    }
  }

  const ranked = rankCandidatesBySourcePriority(candidates)
    .filter((candidate) => candidate.modifier === '26' && (candidate.workRvu ?? 0) > 0)
    .filter((candidate) => candidateRespectsOrBypassesModalityLane(candidate, modalityLane));

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
    return rows.map((row) => rowToCandidate(trimmed, row, 1, 'manual_cpt', 'direct CPT')).slice(0, maxResults);
  }

  const parsed = parseModalityFirst(trimmed);
  const matchInput = parsed.cleanedProcedure || trimmed;
  const radiologyDescriptionKey = normalizeRadiologyDescription(matchInput);
  const radiologyNorm = normalizeForRadiology(matchInput);
  const modalityLane = parsed.lane;
  const allCpt = await db.cptRvuTable
    .where('statusCategory')
    .anyOf(['active', 'restricted'])
    .toArray();
  const modalityScopedCpt = allCpt.filter((row) => rowMatchesModalityLane(row, modalityLane));
  const keywordScopedCpt = keywordScopedRows(modalityScopedCpt, parsed);

  const orbitCandidates = await candidatesForOrbitCmeSeed(matchInput);
  const deterministicCandidates = await candidatesForDeterministicProtocol(matchInput, parsed);
  const commonCandidates = await candidatesForCommonRadiologyMapping(matchInput);
  const exactDescriptionCandidates = keywordScopedCpt
    .filter(isProductivityRelevantModifier26)
    .filter((row) => normalizeRadiologyDescription(row.description) === radiologyDescriptionKey)
    .map((row) => rowToCandidate(matchInput, row, 0.96, 'radiology_match', 'exact CMS description'));

  const tokenCount = matchInput.split(/\s+/).length;
  const fuzzyCandidates = keywordScopedCpt
    .filter(isProductivityRelevantModifier26)
    .map((row) => {
      const normalizedDescription = normalizeRadiologyDescription(row.description);
      const radioScore = scoreRadiologyMatch(radiologyNorm, row.description);
      const textScore = combinedSimilarity(matchInput, row.description);
      const normalizedTextScore = combinedSimilarity(radiologyDescriptionKey, normalizedDescription);
      const blendedScore = tokenCount > 3
        ? radioScore * 0.70 + textScore * 0.15 + normalizedTextScore * 0.15
        : radioScore * 0.40 + textScore * 0.35 + normalizedTextScore * 0.25;
      const keywordBoost = Array.from(parsed.keywords).some((keyword) => rowMatchesKeyword(row, keyword)) ? 0.08 : 0;
      const score = Math.min(1, Math.max(normalizedDescription === radiologyDescriptionKey ? 0.96 : 0, blendedScore) + keywordBoost);
      return { row, score };
    })
    .filter((x) => x.score >= 0.20)
    .sort((a, b) => {
      const scoreDiff = b.score - a.score;
      if (scoreDiff !== 0) return scoreDiff;
      return (b.row.workRvu ?? 0) - (a.row.workRvu ?? 0);
    })
    .slice(0, maxResults * 2)
    .map(({ row, score }) => rowToCandidate(matchInput, row, score, 'radiology_match', 'CMS fuzzy match'));

  return rankCandidatesBySourcePriority([...orbitCandidates, ...deterministicCandidates, ...commonCandidates, ...exactDescriptionCandidates, ...fuzzyCandidates])
    .filter((candidate) => candidateRespectsOrBypassesModalityLane(candidate, modalityLane))
    .slice(0, maxResults);
}

export interface LearnAliasPayload {
  rawText: string;
  canonicalExamName: string | null;
  candidates: Array<{
    cptCode: string;
    modifier: string | null;
    workRvu: number | null;
    description?: string | null;
    modality?: CptRvuRow['modality'] | null;
  }>;
  source: ExamAlias['source'];
  profileId?: string | null;
  siteId?: string | null;
  action?: 'confirm' | 'correct' | 'reject' | 'manual_add';
}

async function upsertDictionaryEntry(payload: LearnAliasPayload, normalized: string): Promise<void> {
  const candidates = payload.candidates.filter((candidate) => candidate.modifier === '26' && (candidate.workRvu ?? 0) > 0);
  if (!candidates.length) return;
  const cptCodes = candidates.map((candidate) => `${candidate.cptCode}-26`);
  const canonicalDisplayName = payload.canonicalExamName ?? payload.rawText;
  const dictionaryEntries = await db.examDictionary.toArray();
  const codeKey = [...cptCodes].sort().join('|');
  const existing = dictionaryEntries.find((entry) => entry.normalizedKey === normalized) ??
    dictionaryEntries.find((entry) => entry.source === 'institution' && [...entry.cptCodes].sort().join('|') === codeKey) ??
    dictionaryEntries.find((entry) => [...entry.cptCodes].sort().join('|') === codeKey);
  const now = new Date().toISOString();
  const synonym = payload.rawText.trim();
  if (existing) {
    const nextPowerScribeNames = new Set(existing.powerScribeNames ?? []);
    const nextCommonSynonyms = new Set(existing.commonSynonyms ?? []);
    if (payload.source === 'ocr_confirmed') nextPowerScribeNames.add(synonym);
    else nextCommonSynonyms.add(synonym);
    await db.examDictionary.update(existing.id, {
      canonicalDisplayName: existing.canonicalDisplayName || canonicalDisplayName,
      commonSynonyms: Array.from(nextCommonSynonyms),
      powerScribeNames: Array.from(nextPowerScribeNames),
      cmsDescription: existing.cmsDescription ?? (candidates.map((c) => c.description).filter(Boolean).join(' + ') || null),
      modifier26Wrvu: candidates.reduce((sum, c) => sum + (c.workRvu ?? 0), 0),
      modality: candidates[0].modality ?? existing.modality,
      timesUsed: (existing.timesUsed ?? 0) + 1,
      updatedAt: now,
    });
    return;
  }
  await db.examDictionary.add({
    id: crypto.randomUUID(),
    canonicalDisplayName,
    normalizedKey: normalized,
    commonSynonyms: payload.source === 'ocr_confirmed' ? [] : [synonym],
    hospitalAliases: [],
    powerScribeNames: payload.source === 'ocr_confirmed' ? [synonym] : [],
    cmsDescription: candidates.map((c) => c.description).filter(Boolean).join(' + ') || null,
    cptCodes,
    modifier26Wrvu: candidates.reduce((sum, c) => sum + (c.workRvu ?? 0), 0),
    modality: candidates[0].modality ?? 'OTHER',
    bodyRegion: null,
    typicalCombinations: cptCodes.length > 1 ? [cptCodes.join(' + ')] : [],
    timesUsed: 1,
    source: 'user',
    createdAt: now,
    updatedAt: now,
  });
}

async function upsertOcrLearningEntry(payload: LearnAliasPayload, normalized: string): Promise<void> {
  if (payload.source !== 'ocr_confirmed' && payload.source !== 'user' && payload.source !== 'manual_name_match') return;
  const candidates = payload.candidates.filter((candidate) => candidate.modifier === '26' && (candidate.workRvu ?? 0) > 0);
  const primary = candidates[0];
  if (!primary) return;

  const now = new Date().toISOString();
  const profileId = payload.profileId ?? null;
  const profile = profileId ? await db.radiologistProfiles.get(profileId) : null;
  const siteId = payload.siteId ?? profile?.practiceId ?? null;
  const existing = (await db.ocrLearningEntries
    .where('normalizedOcrText')
    .equals(normalized)
    .toArray())
    .find((entry) =>
      entry.profileId === profileId &&
      (entry.siteId ?? null) === siteId &&
      entry.matchedCpt === primary.cptCode &&
      (entry.modifier ?? null) === '26',
    );
  const historyItem = {
    at: now,
    action: payload.action ?? 'confirm',
    cptCode: primary.cptCode,
    modifier: '26',
    workRvu: primary.workRvu,
  };

  if (existing) {
    const history = JSON.parse(existing.correctionHistoryJson || '[]') as unknown[];
    const corrections = (existing.corrections ?? 0) + (payload.action === 'correct' ? 1 : 0);
    const confirmations = (existing.confirmations ?? 0) + (payload.action === 'reject' ? 0 : 1);
    await db.ocrLearningEntries.update(existing.id, {
      rawOcrText: payload.rawText,
      workRvu: primary.workRvu,
      confidence: Math.min(1, Math.max(0.65, existing.confidence + (payload.action === 'correct' ? 0.02 : 0.03))),
      correctionHistoryJson: JSON.stringify([...history.slice(-19), historyItem]),
      confirmations,
      corrections,
      lastUsedAt: now,
      updatedAt: now,
    });
    return;
  }

  await db.ocrLearningEntries.add({
    id: crypto.randomUUID(),
    profileId,
    siteId,
    rawOcrText: payload.rawText,
    normalizedOcrText: normalized,
    matchedCpt: primary.cptCode,
    modifier: '26',
    workRvu: primary.workRvu,
    confidence: payload.action === 'correct' ? 0.95 : 0.9,
    source: payload.source,
    correctionHistoryJson: JSON.stringify([historyItem]),
    confirmations: payload.action === 'reject' ? 0 : 1,
    corrections: payload.action === 'correct' ? 1 : 0,
    lastUsedAt: now,
    createdAt: now,
    updatedAt: now,
  });
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
  const profile = profileId ? await db.radiologistProfiles.get(profileId) : null;
  const siteId = payload.siteId ?? profile?.practiceId ?? null;
  const primary = candidates[0];
  const normalized = normalizeRadiologyDescription(rawText);
  const legacyNormalized = normalizeExamText(rawText);
  const canonicalNormalized = normalizeRadiologyDescription(canonicalExamName ?? rawText);
  const existing = (await db.examAliases.toArray())
    .find((a) => (
      a.profileId === profileId &&
      (a.siteId ?? null) === siteId &&
      (
        a.aliasText === normalized ||
        a.aliasText === legacyNormalized ||
        normalizeRadiologyDescription(a.aliasTextRaw) === normalized ||
        normalizeRadiologyDescription(a.canonicalExamName ?? '') === canonicalNormalized
      )
    ));

  const cptCodes = candidates.map((c) => `${c.cptCode}-26`);
  const totalWorkRvu = candidates.reduce((sum, c) => sum + (c.workRvu ?? 0), 0) || null;
  const now = new Date().toISOString();
  const action = payload.action ?? (payload.source === 'ocr_confirmed' ? 'confirm' : 'manual_add');

  if (existing) {
    const existingCodes = existing.cptCodes?.length
      ? existing.cptCodes
      : [existing.modifier ? `${existing.cptCode}-${existing.modifier}` : existing.cptCode];
    const changedMapping = existingCodes.sort().join('|') !== [...cptCodes].sort().join('|');
    const confirmations = (existing.confirmations ?? existing.timesUsed ?? 0) + (action === 'reject' ? 0 : 1);
    const corrections = (existing.corrections ?? 0) + (changedMapping || action === 'correct' ? 1 : 0);
    const rejections = (existing.rejections ?? 0) + (action === 'reject' ? 1 : 0);
    const nextConfidence = Math.min(
      1,
      Math.max(
        0.5,
        aliasConfidence({ ...existing, confirmations, corrections, rejections }) + (changedMapping ? -0.08 : 0.015),
      ),
    );
    await db.examAliases.update(existing.id, {
      aliasText: normalized,
      aliasTextRaw: rawText,
      siteId,
      cptCode: primary.cptCode,
      modifier: '26',
      cptCodes,
      totalWorkRvu,
      canonicalExamName: canonicalExamName ?? existing.canonicalExamName,
      timesUsed: existing.timesUsed + 1,
      confirmations,
      corrections,
      rejections,
      lastUsedAt: now,
      lastAdjustedAt: now,
      matchConfidence: nextConfidence,
    });
    await upsertDictionaryEntry(payload, normalized);
    await upsertOcrLearningEntry(payload, normalized);
    return;
  }

  await db.examAliases.add({
    id: crypto.randomUUID(),
    profileId,
    siteId,
    aliasText: normalized,
    aliasTextRaw: rawText,
    canonicalExamName: canonicalExamName ?? null,
    cptCode: primary.cptCode,
    modifier: '26',
    cptCodes,
    totalWorkRvu,
    matchConfidence: action === 'manual_add' || action === 'correct' || action === 'confirm' ? 0.95 : 0.90,
    confirmations: 1,
    corrections: action === 'correct' ? 1 : 0,
    rejections: action === 'reject' ? 1 : 0,
    autoApprovedCount: 0,
    lastAdjustedAt: now,
    source: payload.source,
    timesUsed: 1,
    lastUsedAt: now,
    createdAt: now,
  });
  await upsertDictionaryEntry(payload, normalized);
  await upsertOcrLearningEntry(payload, normalized);
}
