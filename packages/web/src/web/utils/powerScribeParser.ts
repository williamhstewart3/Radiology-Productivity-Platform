import { normalizeOcrExamTextForMatching } from './ocrExamTextNormalization';
import { parseDateTimeFromOcr, parseDateTimeMatchesFromOcr } from './studyDateParser';

export interface ParsedLine {
  rawText: string;
  examName: string;
  cleanedExamName: string;
  studyDateTime: string | null;
  studyDate: string | null;
  modifiedDateTime: string | null;
  modifiedDate: string | null;
  accessionNumber: string | null;
  rowIndex: string | null;
  dateTimeConfidence: number;
  extractionConfidence: number;
  needsReview: boolean;
  reviewReason: string | null;
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
  /^\s*(?:(?:[|/\\_\-#>*]+|[voxlit]|[0-9]{1,4}|signed|final|complete(?:d)?|normal|abnormal|new|old|read|unread)\s+){1,10}/i;

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

function hasExamContext(text: string): boolean {
  return EXAM_CONTEXT_PATTERN.test(text);
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

function stripLeftTableJunk(text: string): { rowIndex: string | null; text: string } {
  let working = stripUiText(text).replace(LEFT_STATUS_PATTERN, '').trim();
  let rowIndex: string | null = null;

  const rowIndexResult = stripLeadingRowIndex(working);
  if (rowIndexResult) {
    rowIndex = rowIndexResult.rowIndex;
    working = rowIndexResult.text;
  }

  working = normalizeOcrExamTextForMatching(working);
  return { rowIndex, text: working };
}

function stripDatesAndIdentifiers(text: string): { text: string; accessionNumber: string | null } {
  let working = text;
  for (const pattern of DATE_STRIP_PATTERNS) working = working.replace(pattern, ' ');
  for (const pattern of TIME_STRIP_PATTERNS) working = working.replace(pattern, ' ');

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
  if (parseDateTimeMatchesFromOcr(line).length > 0) return true;
  if (LEADING_ROW_INDEX_PATTERN.test(line)) return true;
  if (hasExamContext(line)) return true;
  return false;
}

function reconstructTableRows(lines: string[]): string[] {
  const rows: string[] = [];

  for (const rawLine of lines) {
    const line = stripUiText(rawLine.trim());
    if (line.length < 2 || isMetadataOnlyLine(line)) continue;

    if (rows.length === 0 || shouldStartNewRow(line)) {
      rows.push(line);
    } else {
      rows[rows.length - 1] = `${rows[rows.length - 1]} ${line}`.replace(/\s{2,}/g, ' ').trim();
    }
  }

  return rows;
}

export function parseOcrLines(lines: string[]): ParsedLine[] {
  return reconstructTableRows(lines)
    .map((line) => parseSingleRow(line))
    .filter((p): p is ParsedLine => p !== null);
}

function parseSingleRow(rawRow: string): ParsedLine | null {
  const trimmed = rawRow.trim();
  if (trimmed.length < 3 || isMetadataOnlyLine(trimmed)) return null;

  const { rowIndex, text: rowWithoutLeftJunk } = stripLeftTableJunk(trimmed);
  const dateMatches = parseDateTimeMatchesFromOcr(rowWithoutLeftJunk);
  const firstDate = dateMatches[0] ?? parseDateTimeFromOcr(rowWithoutLeftJunk);
  const lastDate =
    [...dateMatches].reverse().find((match) => Boolean(match.studyDateTime)) ??
    dateMatches[dateMatches.length - 1] ??
    firstDate;

  const stripped = stripDatesAndIdentifiers(rowWithoutLeftJunk);
  const cleanedExamNameRaw = normalizeOcrExamTextForMatching(stripped.text);
  const cleanedExamName = cleanedExamNameRaw.length >= 2
    ? cleanedExamNameRaw
    : dateMatches.length > 0
      ? 'UNCLEAR POWERSCRIBE ROW'
      : '';
  if (cleanedExamName.length < 2) return null;

  const studyDateTime = firstDate?.studyDateTime ?? null;
  const studyDate = firstDate?.studyDate ?? null;
  const modifiedDateTime = lastDate?.studyDateTime ?? null;
  const modifiedDate = lastDate?.studyDate ?? null;
  const dateTimeConfidence = lastDate?.confidence ?? firstDate?.confidence ?? 0;
  const hasContext = hasExamContext(cleanedExamName);
  const hasDateColumns = dateMatches.length > 0;
  const extractionConfidence =
    hasContext && hasDateColumns ? 0.92 :
    hasContext ? 0.72 :
    hasDateColumns ? 0.38 :
    0.2;
  const needsReview = extractionConfidence < 0.75 || dateTimeConfidence < 0.5 || !hasContext;
  const reviewReason =
    !hasContext ? 'Low-confidence PowerScribe row text' :
    dateTimeConfidence < 0.5 ? 'Missing or unclear PowerScribe date columns' :
    extractionConfidence < 0.75 ? 'PowerScribe row needs review' :
    null;

  return {
    rawText: trimmed,
    examName: cleanedExamName,
    cleanedExamName,
    studyDateTime,
    studyDate,
    modifiedDateTime,
    modifiedDate,
    accessionNumber: stripped.accessionNumber,
    rowIndex,
    dateTimeConfidence,
    extractionConfidence,
    needsReview,
    reviewReason,
  };
}
