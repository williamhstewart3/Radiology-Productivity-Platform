/**
 * studyDateParser.ts
 *
 * Extracts study date and time from OCR'd text lines.
 * All parsing is local/regex — no cloud OCR, no external calls.
 *
 * PowerScribe screenshot formats vary by site/version. This covers the
 * most common layouts observed in real-world screenshots:
 *
 *   MM/DD/YYYY H:MM AM/PM   — most common US format
 *   MM/DD/YY H:MM AM/PM     — 2-digit year variant
 *   M/D/YYYY H:MM AM/PM     — no-padding variant
 *   YYYY-MM-DD HH:MM        — ISO-ish (less common in PS)
 *   YYYY-MM-DD HH:MM:SS     — ISO with seconds
 *   MM-DD-YYYY H:MM AM/PM   — dash-separated US
 *   "Today" / "Yesterday"   — relative labels in some PS versions
 *   "Mon Jun 28" style      — abbreviated date headers
 *
 * Confidence levels:
 *   1.0  — full date + time extracted, valid date parsed
 *   0.85 — date extracted, no time
 *   0.5  — relative date ("Today"/"Yesterday"), no time
 *   0.0  — no date found (caller should fall back to import date)
 */

export interface ParsedDateTime {
  /** ISO 8601 datetime string, or null if only date was found */
  studyDateTime: string | null;
  /** YYYY-MM-DD, or null if no date found */
  studyDate: string | null;
  /** HH:MM (24-hr), or null if no time found */
  studyTime: string | null;
  /** 0.0–1.0 confidence score */
  confidence: number;
  /** Which pattern matched */
  matchedPattern: string;
}

// ─── Pattern registry ────────────────────────────────────────────────────────

// M/D/YY or MM/DD/YYYY with optional H:MM or HH:MM and AM/PM
const US_DATE_TIME = /\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM|am|pm)?\b/;
// ISO date with time: YYYY-MM-DD HH:MM or YYYY-MM-DD HH:MM:SS
const ISO_DATE_TIME = /\b(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::\d{2})?\b/;
// Dash-separated US: MM-DD-YYYY H:MM AM/PM
const US_DASH_DATE_TIME = /\b(\d{1,2})-(\d{1,2})-(\d{4})\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM|am|pm)?\b/;
// Date only (no time): MM/DD/YYYY or MM/DD/YY
const US_DATE_ONLY = /\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/;
// ISO date only: YYYY-MM-DD
const ISO_DATE_ONLY = /\b(\d{4})-(\d{2})-(\d{2})\b/;
// Abbreviated month: Jun 28 or Jun 28, 2026 or Mon Jun 28
const ABBREV_MONTH = /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun\s+)?(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})(?:,?\s+(\d{4}))?\b/i;
// "Today" / "Yesterday" relative markers
const RELATIVE_DATE = /\b(Today|Yesterday)\b/i;

// ─── Core parser ──────────────────────────────────────────────────────────────

/**
 * Attempts to parse a date/time from an OCR text line.
 * Returns null if no date pattern is found at all.
 */
export function parseDateTimeFromOcr(text: string): ParsedDateTime | null {
  if (!text || text.trim().length < 3) return null;

  // ── Try US date + time (most common in PowerScribe) ─────────────────────
  const usMatch = text.match(US_DATE_TIME);
  if (usMatch) {
    const [, mStr, dStr, yStr, hStr, minStr, ampm] = usMatch;
    const parsed = buildUsDateTime(mStr, dStr, yStr, hStr, minStr, ampm ?? null);
    if (parsed) return { ...parsed, matchedPattern: 'US_DATE_TIME' };
  }

  // ── Try ISO date + time ──────────────────────────────────────────────────
  const isoMatch = text.match(ISO_DATE_TIME);
  if (isoMatch) {
    const [, yStr, mStr, dStr, hStr, minStr] = isoMatch;
    const parsed = buildIsoDateTime(yStr, mStr, dStr, hStr, minStr);
    if (parsed) return { ...parsed, matchedPattern: 'ISO_DATE_TIME' };
  }

  // ── Try dash-separated US date + time ────────────────────────────────────
  const dashMatch = text.match(US_DASH_DATE_TIME);
  if (dashMatch) {
    const [, mStr, dStr, yStr, hStr, minStr, ampm] = dashMatch;
    const parsed = buildUsDateTime(mStr, dStr, yStr, hStr, minStr, ampm ?? null);
    if (parsed) return { ...parsed, matchedPattern: 'US_DASH_DATE_TIME' };
  }

  // ── Date-only patterns ────────────────────────────────────────────────────
  const usDateOnly = text.match(US_DATE_ONLY);
  if (usDateOnly) {
    const [, mStr, dStr, yStr] = usDateOnly;
    const studyDate = buildUsDate(mStr, dStr, yStr);
    if (studyDate) {
      return {
        studyDateTime: null,
        studyDate,
        studyTime: null,
        confidence: 0.85,
        matchedPattern: 'US_DATE_ONLY',
      };
    }
  }

  const isoDateOnly = text.match(ISO_DATE_ONLY);
  if (isoDateOnly) {
    const [, yStr, mStr, dStr] = isoDateOnly;
    const studyDate = buildIsoDate(yStr, mStr, dStr);
    if (studyDate) {
      return {
        studyDateTime: null,
        studyDate,
        studyTime: null,
        confidence: 0.85,
        matchedPattern: 'ISO_DATE_ONLY',
      };
    }
  }

  // ── Abbreviated month ─────────────────────────────────────────────────────
  const abbrevMatch = text.match(ABBREV_MONTH);
  if (abbrevMatch) {
    const studyDate = buildAbbrevDate(abbrevMatch[0]);
    if (studyDate) {
      return {
        studyDateTime: null,
        studyDate,
        studyTime: null,
        confidence: 0.75,
        matchedPattern: 'ABBREV_MONTH',
      };
    }
  }

  // ── Relative date ─────────────────────────────────────────────────────────
  const relMatch = text.match(RELATIVE_DATE);
  if (relMatch) {
    const word = relMatch[1].toLowerCase();
    const d = new Date();
    if (word === 'yesterday') d.setDate(d.getDate() - 1);
    const studyDate = d.toISOString().slice(0, 10);
    return {
      studyDateTime: null,
      studyDate,
      studyTime: null,
      confidence: 0.5,
      matchedPattern: 'RELATIVE_DATE',
    };
  }

  return null;
}

/**
 * Scans all lines from an OCR result and returns the best date/time found.
 * Prefers lines with both date AND time. Falls back to date-only.
 * Returns null if no date found in any line.
 */
export function parseDateTimeFromOcrLines(lines: string[]): ParsedDateTime | null {
  let best: ParsedDateTime | null = null;

  for (const line of lines) {
    const result = parseDateTimeFromOcr(line);
    if (!result) continue;
    if (best === null || result.confidence > best.confidence) {
      best = result;
    }
    // Early exit if we've found a full date+time (1.0 confidence)
    if (best.confidence >= 1.0) break;
  }

  return best;
}

// ─── Build helpers ────────────────────────────────────────────────────────────

function buildUsDateTime(
  mStr: string,
  dStr: string,
  yStr: string,
  hStr: string,
  minStr: string,
  ampm: string | null,
): Omit<ParsedDateTime, 'matchedPattern'> | null {
  const studyDate = buildUsDate(mStr, dStr, yStr);
  if (!studyDate) return null;

  let h = parseInt(hStr, 10);
  const min = parseInt(minStr, 10);
  if (isNaN(h) || isNaN(min) || min > 59) return null;

  if (ampm) {
    const ap = ampm.toUpperCase();
    if (ap === 'PM' && h < 12) h += 12;
    if (ap === 'AM' && h === 12) h = 0;
  }
  if (h > 23) return null;

  const hh = String(h).padStart(2, '0');
  const mm = String(min).padStart(2, '0');
  const studyTime = `${hh}:${mm}`;
  const studyDateTime = `${studyDate}T${studyTime}:00`;

  // Validate the full datetime
  const dt = new Date(studyDateTime);
  if (isNaN(dt.getTime())) return null;

  return { studyDateTime, studyDate, studyTime, confidence: 1.0 };
}

function buildIsoDateTime(
  yStr: string,
  mStr: string,
  dStr: string,
  hStr: string,
  minStr: string,
): Omit<ParsedDateTime, 'matchedPattern'> | null {
  const studyDate = buildIsoDate(yStr, mStr, dStr);
  if (!studyDate) return null;

  const h = parseInt(hStr, 10);
  const min = parseInt(minStr, 10);
  if (isNaN(h) || isNaN(min) || h > 23 || min > 59) return null;

  const hh = String(h).padStart(2, '0');
  const mm = String(min).padStart(2, '0');
  const studyTime = `${hh}:${mm}`;
  const studyDateTime = `${studyDate}T${studyTime}:00`;

  const dt = new Date(studyDateTime);
  if (isNaN(dt.getTime())) return null;

  return { studyDateTime, studyDate, studyTime, confidence: 1.0 };
}

function buildUsDate(mStr: string, dStr: string, yStr: string): string | null {
  const m = parseInt(mStr, 10);
  const d = parseInt(dStr, 10);
  let y = parseInt(yStr, 10);
  if (isNaN(m) || isNaN(d) || isNaN(y)) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  // Expand 2-digit year
  if (y < 100) y = y >= 50 ? 1900 + y : 2000 + y;
  if (y < 1990 || y > 2099) return null;
  const mm = String(m).padStart(2, '0');
  const dd = String(d).padStart(2, '0');
  const dateStr = `${y}-${mm}-${dd}`;
  // Validate via Date parsing
  const dt = new Date(`${dateStr}T12:00:00`);
  if (isNaN(dt.getTime())) return null;
  return dateStr;
}

function buildIsoDate(yStr: string, mStr: string, dStr: string): string | null {
  const y = parseInt(yStr, 10);
  const m = parseInt(mStr, 10);
  const d = parseInt(dStr, 10);
  if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
  if (y < 1990 || y > 2099 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const dt = new Date(`${dateStr}T12:00:00`);
  if (isNaN(dt.getTime())) return null;
  return dateStr;
}

const MONTH_MAP: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function buildAbbrevDate(text: string): string | null {
  const lower = text.toLowerCase();
  let month = 0;
  for (const [abbrev, num] of Object.entries(MONTH_MAP)) {
    if (lower.includes(abbrev)) { month = num; break; }
  }
  if (!month) return null;

  const dayMatch = text.match(/\b(\d{1,2})\b/);
  if (!dayMatch) return null;
  const day = parseInt(dayMatch[1], 10);
  if (day < 1 || day > 31) return null;

  const yearMatch = text.match(/\b(20\d{2})\b/);
  const year = yearMatch ? parseInt(yearMatch[1], 10) : new Date().getFullYear();

  return buildIsoDate(String(year), String(month), String(day));
}
