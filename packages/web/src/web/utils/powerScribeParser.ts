/**
 * Parses raw OCR'd lines from a PowerScribe completed-studies screenshot
 * into structured fields. PowerScribe list layouts vary by site/version,
 * so this uses permissive regex heuristics rather than a fixed column
 * format — the user always gets a chance to correct results before they're
 * saved (see the review table requirement).
 */

export interface ParsedLine {
  rawText: string;
  examName: string;
  studyDateTime: string | null;
  accessionNumber: string | null;
}

const DATE_TIME_PATTERN = /(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)/i;
const ACCESSION_PATTERN = /\b(?:ACC|ACCESSION)[#:\s]*([A-Z0-9-]{5,})\b/i;
const STANDALONE_LONG_NUMBER = /\b(\d{7,12})\b/;

export function parseOcrLines(lines: string[]): ParsedLine[] {
  return lines.map((line) => parseSingleLine(line)).filter((p): p is ParsedLine => p !== null);
}

function parseSingleLine(rawLine: string): ParsedLine | null {
  const trimmed = rawLine.trim();
  if (trimmed.length < 3) return null;

  if (/^(page \d+|status|completed|study list|patient name)/i.test(trimmed)) {
    return null;
  }

  let working = trimmed;
  let studyDateTime: string | null = null;
  let accessionNumber: string | null = null;

  const dtMatch = working.match(DATE_TIME_PATTERN);
  if (dtMatch) {
    studyDateTime = normalizeDateTime(dtMatch[1], dtMatch[2]);
    working = working.replace(dtMatch[0], ' ');
  }

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

  const examName = working.replace(/\s{2,}/g, ' ').trim();
  if (examName.length < 2) return null;

  return { rawText: trimmed, examName, studyDateTime, accessionNumber };
}

function normalizeDateTime(datePart: string, timePart: string): string | null {
  try {
    const dt = new Date(`${datePart} ${timePart}`);
    if (Number.isNaN(dt.getTime())) return null;
    return dt.toISOString();
  } catch {
    return null;
  }
}
