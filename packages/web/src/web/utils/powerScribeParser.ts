/**
 * Parses raw OCR'd lines from a PowerScribe completed-studies screenshot
 * into structured fields. PowerScribe list layouts vary by site/version,
 * so this uses permissive regex heuristics rather than a fixed column
 * format — the user always gets a chance to correct results before they're
 * saved (see the review table requirement).
 */

import { parseDateTimeFromOcr } from './studyDateParser';

export interface ParsedLine {
  rawText: string;
  examName: string;
  studyDateTime: string | null;
  studyDate: string | null;
  accessionNumber: string | null;
  /** 0.0–1.0 confidence in the extracted date/time */
  dateTimeConfidence: number;
}

const ACCESSION_PATTERN = /\b(?:ACC|ACCESSION)[#:\s]*([A-Z0-9-]{5,})\b/i;
const STANDALONE_LONG_NUMBER = /\b(\d{7,12})\b/;
const EXAM_CONTEXT_PATTERN =
  /\b(?:ct|cta|mri?|mra|x-?ray|xr|ultrasound|u\/s|us|nm|pet|fluoro|mammogram|mammo|angiogram|abdomen|pelvis|chest|head|neck|brain|spine|lumbar|thoracic|cervical|knee|shoulder|hip|ankle|wrist|contrast|with|without|w\/o|w\/)\b/i;
const METADATA_LABEL_PATTERN =
  /\b(?:dob|date of birth|birth date|age|mrn|medical record|patient(?:\s+(?:id|name))?|accession|acc|account|acct|encounter|order(?:\s+(?:id|number))?|csn|fin|har)\b/i;
const HEADER_FOOTER_PATTERN =
  /^(?:page \d+|status|completed|study list|patient name|patient id|mrn|dob|date of birth|age|accession|account|encounter|order|signed|finalized|dictated|performed|provider|radiologist|facility)\b/i;

// Date patterns to strip from exam name after extraction (so they don't
// contaminate the exam name text). Match the same patterns as studyDateParser.
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

function isMetadataOnlyLine(text: string): boolean {
  if (HEADER_FOOTER_PATTERN.test(text) && !hasExamContext(text)) return true;
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

export function parseOcrLines(lines: string[]): ParsedLine[] {
  return lines.map((line) => parseSingleLine(line)).filter((p): p is ParsedLine => p !== null);
}

function parseSingleLine(rawLine: string): ParsedLine | null {
  const trimmed = rawLine.trim();
  if (trimmed.length < 3) return null;

  if (isMetadataOnlyLine(trimmed)) {
    return null;
  }

  let working = trimmed;

  // ── Extract date/time using the dedicated parser ──────────────────────────
  const dtResult = parseDateTimeFromOcr(working);
  const studyDateTime = dtResult?.studyDateTime ?? null;
  const studyDate = dtResult?.studyDate ?? null;
  const dateTimeConfidence = dtResult?.confidence ?? 0;

  // Strip all date/time tokens from the working string so they don't land
  // in the exam name
  for (const pattern of DATE_STRIP_PATTERNS) {
    working = working.replace(pattern, ' ');
  }
  for (const pattern of TIME_STRIP_PATTERNS) {
    working = working.replace(pattern, ' ');
  }

  // ── Extract accession number ───────────────────────────────────────────────
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

  // ── Clean up exam name ────────────────────────────────────────────────────
  const examName = working.replace(/\s{2,}/g, ' ').trim();
  if (examName.length < 2) return null;

  return { rawText: trimmed, examName, studyDateTime, studyDate, accessionNumber, dateTimeConfidence };
}
