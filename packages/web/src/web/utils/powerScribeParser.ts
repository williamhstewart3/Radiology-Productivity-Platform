/**
 * Parses OCR'd PowerScribe completed-studies rows into structured fields.
 * The procedure text is intentionally separated from date/time columns before
 * CPT matching so dates never participate in normalization or fuzzy matching.
 */

import { normalizeOcrExamTextForMatching } from './ocrExamTextNormalization';
import { parseDateTimeFromOcr, parseDateTimeMatchesFromOcr } from './studyDateParser';

export interface ParsedLine {
  rawText: string;
  procedureName: string;
  examName: string;
  cleanedExamName: string;
  cleanedText: string;
  examDate: string | null;
  examTime: string | null;
  examDateTime: string | null;
  studyDateTime: string | null;
  studyDate: string | null;
  modifiedDateTime: string | null;
  modifiedDate: string | null;
  modifiedTime: string | null;
  accessionNumber: string | null;
  rowIndex: string | null;
  dateTimeConfidence: number;
  extractionConfidence: number;
  needsReview: boolean;
  reviewReason: string | null;
}

export interface RejectedOcrRow {
  rawText: string;
  reason: string;
}

export interface OcrParseDebugInfo {
  rawLineCount: number;
  cleanedLineCount: number;
  parsedRowCount: number;
  rejectedRowCount: number;
  rejectedRows: RejectedOcrRow[];
}

const ACCESSION_PATTERN = /\b(?:ACC|ACCESSION)[#:\s]*([A-Z0-9-]{5,})\b/i;
const STANDALONE_LONG_NUMBER = /\b(\d{7,12})\b/;
const LEADING_ROW_INDEX_PATTERN = /^\s*(?:#\s*)?(\d{1,4})(?:\s*[|:.)-]\s*|\s+)(.+)$/i;
const EXAM_CONTEXT_PATTERN =
  /\b(?:ct|cta|mri?|mra|x-?ray|xr|ultrasound|u\/s|us|nm|pet|fluoro|mammogram|mammo|angiogram|abdomen|pelvis|chest|head|neck|brain|spine|lumbar|thoracic|cervical|knee|shoulder|hip|ankle|wrist|contrast|with|without|w\/o|w\/)\b/i;
const METADATA_LABEL_PATTERN =
  /\b(?:dob|date of birth|birth date|age|mrn|medical record|patient(?:\s+(?:id|name))?|accession|acc|account|acct|encounter|order(?:\s+(?:id|number))?|csn|fin|har)\b/i;
const HEADER_FOOTER_PATTERN =
  /^(?:page \d+|status|completed|study list|procedure|exam date|modified|patient name|patient id|mrn|dob|date of birth|age|accession|account|encounter|order|signed|finalized|dictated|performed|provider|radiologist|facility)\b/i;
const UI_NOISE_PATTERN =
  /\b(?:reset\s+filters?|browse|search|filter|filters|refresh|logout|settings|preferences|dashboard|inbox|outbox|worklist|folder|sort|ascending|descending|click|button|menu|home|apply|clear|cancel|save|export|print|status\s+bar|tabs?)\b/i;
const LEFT_STATUS_PATTERN =
  /^\s*(?:(?:[+@|/\\_\-#>*.:;()[\]{}]+|v\d{1,3}|vb|vi|vo|vx|[voxlit]|[0-9]{1,4}|signed|final|complete(?:d)?|normal|abnormal|new|old|read|unread|warning|warn|alert|check)\s+){1,12}/i;
const MODALITY_START_PATTERN =
  /\b(?:CTA|CT\s*ANGIO(?:GRAM|GRAPHY)?|MR\s*ANGIO(?:GRAM|GRAPHY)?|MRA|MRI|MR|X\s*-?\s*RAY|XR|RADIOGRAPH|US|U\/S|ULTRASOUND|SONOGRAM|PET|NM|NUCLEAR|MAMMO|MAMMOGRAM|MAMMOGRAPHY|DXA|DEXA|FLUORO|FLUOROSCOPY)\b|(?:CT(?=ANGIOGRAM|ANGIOGRAPHY|CARDIAC|CHEST|HEAD|ABDOMEN|RENAL|APPENDIX|LDCT))|(?:XR(?=CHEST|ABDOMEN|WRIST|HAND|HIP|SHOULDER|KNEE|ANKLE|FOOT|PELVIS))|(?:MRI(?=PROSTATE|ABDOMEN|BRAIN|SPINE|CHEST|PELVIS|MRCP))|(?:MRA(?=HEAD|NECK|CHEST|ABDOMEN|PELVIS))|(?:US(?=CAROTID|ARTERIAL|OB|ABDOMEN|PELVIS|RENAL))/i;
const EMBEDDED_ROW_START_PATTERN =
  /\s(?:[+@|/\\_\-#>*.:;()[\]{}]+|[a-z]{1,3})?\s*(?:v\d{1,3}|vb|vi|vo|vx|[voxlit])?\s*\d{1,4}\s+(?=(?:CTA|CT\s*ANGIO|MRA|MRI|MR\s*ANGIO|XR|X\s*-?\s*RAY|US|U\/S|ULTRASOUND|PET|NM|MAMMO|DXA|DEXA|FLUORO|CT(?=ANGIOGRAM|ANGIOGRAPHY|CARDIAC|CHEST|HEAD|ABDOMEN|RENAL|APPENDIX|LDCT)|XR(?=CHEST|ABDOMEN|WRIST|HAND|HIP|SHOULDER|KNEE|ANKLE|FOOT|PELVIS)|MRI(?=PROSTATE|ABDOMEN|BRAIN|SPINE|CHEST|PELVIS|MRCP)|MRA(?=HEAD|NECK|CHEST|ABDOMEN|PELVIS)|US(?=CAROTID|ARTERIAL|OB|ABDOMEN|PELVIS|RENAL)))/gi;

const UI_TEXT_STRIP_PATTERNS = [
  /\breset\s+filters?\b/gi,
  /\bbrowse\b/gi,
  /\bsearch\b/gi,
  /\bfilters?\b/gi,
  /\brefresh\b/gi,
  /\bapply\b/gi,
  /\bclear\b/gi,
  /\bcancel\b/gi,
  /\bsave\b/gi,
  /\bexport\b/gi,
  /\bprint\b/gi,
  /\bstatus\s+bar\b/gi,
  /\btabs?\b/gi,
];

const DATE_STRIP_PATTERNS = [
  /\d{1,2}\/\d{1,2}\/\d{2,4}\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?/gi,
  /\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}(?::\d{2})?/gi,
  /\d{1,2}-\d{1,2}-\d{4}\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?/gi,
  /\d{1,2}\/\d{1,2}\/\d{2,4}/gi,
  /\d{4}-\d{2}-\d{2}/gi,
  /\d{1,2}-\d{1,2}-\d{4}/gi,
  /\d{1,2}-\d{1,2}-\d{2}/gi,
];

const TIME_STRIP_PATTERNS = [
  /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?Z?\b/gi,
  /\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?\b/g,
];
const COMPACT_OCR_DATE_JUNK_PATTERN = /\b(?:[TF]\d{4,8}|\d{1,2}\d{4})\b/gi;

const OCR_DATE_CHAR_MAP: Record<string, string> = {
  O: '0',
  o: '0',
  Q: '0',
  D: '0',
  I: '1',
  l: '1',
  S: '5',
  s: '5',
  B: '8',
  F: '7',
};

function hasExamContext(text: string): boolean {
  return EXAM_CONTEXT_PATTERN.test(text);
}

function firstModalityIndex(text: string): number {
  const match = text.match(MODALITY_START_PATTERN);
  return match?.index ?? -1;
}

function countModalityStarts(text: string): number {
  let count = 0;
  const pattern = new RegExp(MODALITY_START_PATTERN.source, 'gi');
  for (const match of text.matchAll(pattern)) {
    if ((match.index ?? 0) >= 0) count++;
  }
  return count;
}

function stripUiText(text: string): string {
  let cleaned = text;
  for (const pattern of UI_TEXT_STRIP_PATTERNS) {
    cleaned = cleaned.replace(pattern, ' ');
  }
  return cleaned
    .replace(/[|•·]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function isMetadataOnlyLine(text: string): boolean {
  if (HEADER_FOOTER_PATTERN.test(text) && !hasExamContext(text)) return true;
  if (UI_NOISE_PATTERN.test(text) && !hasExamContext(text)) return true;
  if (!METADATA_LABEL_PATTERN.test(text)) return false;

  let withoutNoise = text;
  for (const pattern of DATE_STRIP_PATTERNS) withoutNoise = withoutNoise.replace(pattern, ' ');
  for (const pattern of TIME_STRIP_PATTERNS) withoutNoise = withoutNoise.replace(pattern, ' ');
  withoutNoise = withoutNoise
    .replace(ACCESSION_PATTERN, ' ')
    .replace(STANDALONE_LONG_NUMBER, ' ')
    .replace(METADATA_LABEL_PATTERN, ' ')
    .replace(/[#:_-]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return !hasExamContext(text) || withoutNoise.length < 3;
}

function stripLeadingRowIndex(text: string): { rowIndex: string; text: string } | null {
  const rowIndexMatch = text.match(LEADING_ROW_INDEX_PATTERN);
  if (!rowIndexMatch) return null;

  const [, rowIndex, rest] = rowIndexMatch;
  return {
    rowIndex,
    text: rest.trim(),
  };
}

function normalizeOcrDateChars(text: string): string {
  return text.replace(
    /\b[0-9OoQDISsBlF]{1,2}([/-])[0-9OoQDISsBlF]{1,2}\1[0-9OoQDISsBlF]{2,4}(?:\s+[0-9OoQDISsBlF]{1,2}:[0-9OoQDISsBlF]{2}(?::[0-9OoQDISsBlF]{2})?\s*(?:AM|PM|am|pm)?)?/g,
    (token) => token.replace(/[OoQDISsBlF]/g, (char) => OCR_DATE_CHAR_MAP[char] ?? char),
  );
}

function replaceRanges(text: string, ranges: Array<{ index: number; endIndex: number }>): string {
  if (ranges.length === 0) return text;
  let result = '';
  let cursor = 0;
  for (const range of [...ranges].sort((a, b) => a.index - b.index)) {
    if (range.index < cursor) continue;
    result += text.slice(cursor, range.index);
    result += ' ';
    cursor = range.endIndex;
  }
  result += text.slice(cursor);
  return result;
}

function stripLeftTableJunk(text: string): { rowIndex: string | null; text: string } {
  let working = stripUiText(text).replace(LEFT_STATUS_PATTERN, '').trim();
  let rowIndex: string | null = null;

  const rowIndexResult = stripLeadingRowIndex(working);
  if (rowIndexResult) {
    rowIndex = rowIndexResult.rowIndex;
    working = rowIndexResult.text;
  }

  const modalityStart = firstModalityIndex(working);
  if (modalityStart > 0) {
    working = working.slice(modalityStart).trim();
  }

  return { rowIndex, text: working };
}

function stripDatesAndIdentifiers(text: string, dateRanges: Array<{ index: number; endIndex: number }>): { text: string; accessionNumber: string | null } {
  let working = replaceRanges(text, dateRanges);
  for (const pattern of DATE_STRIP_PATTERNS) working = working.replace(pattern, ' ');
  for (const pattern of TIME_STRIP_PATTERNS) working = working.replace(pattern, ' ');
  working = working.replace(COMPACT_OCR_DATE_JUNK_PATTERN, ' ');

  let accessionNumber: string | null = null;
  const accMatch = working.match(ACCESSION_PATTERN);
  if (accMatch) {
    accessionNumber = accMatch[1];
    working = working.replace(accMatch[0], ' ');
  } else {
    const fallback = working.match(STANDALONE_LONG_NUMBER);
    if (fallback) {
      accessionNumber = fallback[1];
      working = working.replace(fallback[0], ' ');
    }
  }

  return { text: stripUiText(working), accessionNumber };
}

function shouldStartNewRow(line: string): boolean {
  if (parseDateTimeMatchesFromOcr(normalizeOcrDateChars(line)).length > 0) return true;
  if (LEADING_ROW_INDEX_PATTERN.test(line)) return true;
  if (hasExamContext(line)) return true;
  return false;
}

function reconstructTableRows(lines: string[]): string[] {
  const rows: string[] = [];

  for (const rawLine of lines) {
    const segments = splitJoinedOcrRows(stripUiText(rawLine.trim()));
    for (const line of segments) {
      if (line.length < 2) continue;
      if (isMetadataOnlyLine(line)) {
        rows.push(line);
        continue;
      }

      if (rows.length === 0 || shouldStartNewRow(line)) {
        rows.push(line);
      } else {
        rows[rows.length - 1] = `${rows[rows.length - 1]} ${line}`.replace(/\s{2,}/g, ' ').trim();
      }
    }
  }

  return rows;
}

function splitJoinedOcrRows(line: string): string[] {
  if (!line) return [];
  const starts = [0];
  EMBEDDED_ROW_START_PATTERN.lastIndex = 0;
  for (const match of line.matchAll(EMBEDDED_ROW_START_PATTERN)) {
    const index = match.index ?? -1;
    if (index > 8) starts.push(index);
  }
  return starts
    .sort((a, b) => a - b)
    .map((start, index) => line.slice(start, starts[index + 1] ?? line.length).trim())
    .filter(Boolean);
}

export function parseOcrLines(lines: string[]): ParsedLine[] {
  return parseOcrLinesWithDebug(lines).rows;
}

export function parseOcrLinesWithDebug(lines: string[]): { rows: ParsedLine[]; debug: OcrParseDebugInfo } {
  const reconstructedRows = reconstructTableRows(lines);
  const rows: ParsedLine[] = [];
  const rejectedRows: RejectedOcrRow[] = [];

  for (const line of reconstructedRows) {
    const parsed = parseSingleRowWithReason(line);
    if (parsed.row) rows.push(parsed.row);
    else rejectedRows.push({ rawText: line, reason: parsed.reason });
  }

  return {
    rows,
    debug: {
      rawLineCount: lines.length,
      cleanedLineCount: reconstructedRows.length,
      parsedRowCount: rows.length,
      rejectedRowCount: rejectedRows.length,
      rejectedRows,
    },
  };
}

function parseSingleRow(rawRow: string): ParsedLine | null {
  return parseSingleRowWithReason(rawRow).row;
}

function parseSingleRowWithReason(rawRow: string): { row: ParsedLine | null; reason: string } {
  const trimmed = rawRow.trim();
  if (trimmed.length < 3) return { row: null, reason: 'Too short after OCR cleanup' };
  if (isMetadataOnlyLine(trimmed)) return { row: null, reason: 'Metadata or UI-only row' };

  const { rowIndex, text: rowWithoutLeftJunk } = stripLeftTableJunk(trimmed);
  const dateText = normalizeOcrDateChars(rowWithoutLeftJunk);
  const dateMatches = parseDateTimeMatchesFromOcr(dateText);
  const firstDate = dateMatches[0] ?? parseDateTimeFromOcr(dateText);
  const lastDate =
    [...dateMatches].reverse().find((match) => Boolean(match.studyDateTime)) ??
    dateMatches[dateMatches.length - 1] ??
    firstDate;

  const stripped = stripDatesAndIdentifiers(rowWithoutLeftJunk, dateMatches);
  const cleanedExamNameRaw = normalizeOcrExamTextForMatching(stripped.text);
  const cleanedExamName = cleanedExamNameRaw.length >= 2
    ? cleanedExamNameRaw
    : dateMatches.length > 0
      ? 'UNCLEAR POWERSCRIBE ROW'
      : '';
  if (cleanedExamName.length < 2) return { row: null, reason: 'No usable procedure text' };
  if (!hasExamContext(cleanedExamName) && dateMatches.length === 0) return { row: null, reason: 'No radiology exam signal' };

  const studyDateTime = firstDate?.studyDateTime ?? null;
  const studyDate = firstDate?.studyDate ?? null;
  const examDate = firstDate?.studyDate ?? null;
  const examTime = firstDate?.studyTime ?? null;
  const modifiedDateTime = lastDate?.studyDateTime ?? null;
  const modifiedDate = lastDate?.studyDate ?? null;
  const modifiedTime = lastDate?.studyTime ?? null;
  const dateTimeConfidence = lastDate?.confidence ?? firstDate?.confidence ?? 0;
  const hasContext = hasExamContext(cleanedExamName);
  const modalityCount = countModalityStarts(cleanedExamName);
  const hasDateColumns = dateMatches.length > 0;
  const extractionConfidence =
    modalityCount > 1 ? 0.45 :
    hasContext && hasDateColumns ? 0.92 :
    hasContext ? 0.72 :
    hasDateColumns ? 0.38 :
    0.2;
  const needsReview = extractionConfidence < 0.75 || dateTimeConfidence < 0.5 || !hasContext || modalityCount > 1;
  const reviewReason =
    modalityCount > 1 ? 'Possible joined PowerScribe rows in OCR text' :
    !hasContext ? 'Low-confidence PowerScribe row text' :
    dateTimeConfidence < 0.5 ? 'Missing or unclear PowerScribe date columns' :
    extractionConfidence < 0.75 ? 'PowerScribe row needs review' :
    null;

  return {
    row: {
      rawText: trimmed,
      procedureName: cleanedExamName,
      examName: cleanedExamName,
      cleanedExamName,
      cleanedText: cleanedExamName,
      examDate,
      examTime,
      examDateTime: studyDateTime,
      studyDateTime,
      studyDate,
      modifiedDateTime,
      modifiedDate,
      modifiedTime,
      accessionNumber: stripped.accessionNumber,
      rowIndex,
      dateTimeConfidence,
      extractionConfidence,
      needsReview,
      reviewReason,
    },
    reason: '',
  };
}
