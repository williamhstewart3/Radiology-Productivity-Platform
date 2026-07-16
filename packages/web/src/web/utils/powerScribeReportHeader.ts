export interface ParsedPowerScribeReportHeader {
  matched: boolean;
  rawText: string;
  rawLine: string | null;
  examTitleRaw: string | null;
  examTitleNormalized: string | null;
  examDateTimeRaw: string | null;
  examDate: string | null;
  examTime: string | null;
  examDateTime: string | null;
  timeZone: string | null;
  needsReview: boolean;
  reviewReason: string | null;
}

const HEADER = /\bEXAMINATI[O0]N\s*[-:;|]?\s*/i;
const DATE_TIME = /\b(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})\s+([0-9]{1,2})\s*[:;. ]\s*([0-9]{2})\s*(AM|PM)\b(?:\s+([A-Z]{2,5}))?/i;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function validCalendarDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function cleanTitle(value: string): string {
  return value
    .replace(/^[-\s,:;|]+|[-\s,:;|]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parsePowerScribeReportHeader(rawText: string): ParsedPowerScribeReportHeader {
  const normalizedRaw = rawText.replace(/\r/g, '\n').replace(/[ \t]+/g, ' ').trim();
  const headerMatch = HEADER.exec(normalizedRaw);
  if (!headerMatch) {
    return {
      matched: false,
      rawText,
      rawLine: null,
      examTitleRaw: null,
      examTitleNormalized: null,
      examDateTimeRaw: null,
      examDate: null,
      examTime: null,
      examDateTime: null,
      timeZone: null,
      needsReview: false,
      reviewReason: null,
    };
  }

  const afterHeader = normalizedRaw.slice(headerMatch.index + headerMatch[0].length);
  const dateMatch = DATE_TIME.exec(afterHeader);
  const title = cleanTitle(dateMatch ? afterHeader.slice(0, dateMatch.index) : afterHeader.split('\n')[0] ?? '');
  const rawLine = cleanTitle(`${headerMatch[0]}${afterHeader.split('\n')[0] ?? afterHeader}`);
  const truncated = /(?:\.{2,}|…)$/.test(title);

  if (!dateMatch) {
    return {
      matched: title.length > 0,
      rawText,
      rawLine,
      examTitleRaw: title || null,
      examTitleNormalized: title || null,
      examDateTimeRaw: null,
      examDate: null,
      examTime: null,
      examDateTime: null,
      timeZone: null,
      needsReview: true,
      reviewReason: 'Exam datetime could not be read from the report header',
    };
  }

  const month = Number(dateMatch[1]);
  const day = Number(dateMatch[2]);
  const year = Number(dateMatch[3]);
  const hour12 = Number(dateMatch[4]);
  const minute = Number(dateMatch[5]);
  const meridiem = dateMatch[6].toUpperCase();
  const timeZone = dateMatch[7]?.toUpperCase() ?? null;
  const valid = validCalendarDate(year, month, day) && hour12 >= 1 && hour12 <= 12 && minute >= 0 && minute <= 59;
  let hour24 = hour12 % 12;
  if (meridiem === 'PM') hour24 += 12;
  const examDate = valid ? `${year}-${pad(month)}-${pad(day)}` : null;
  const examTime = valid ? `${pad(hour24)}:${pad(minute)}` : null;
  const examDateTime = valid ? `${examDate}T${examTime}:00` : null;
  const needsReview = !title || truncated || !valid;
  const reviewReason = !title
    ? 'Examination name could not be read from the report header'
    : truncated
      ? 'The visible examination name appears truncated'
      : !valid
        ? 'Exam datetime is malformed or invalid'
        : null;

  return {
    matched: Boolean(title),
    rawText,
    rawLine,
    examTitleRaw: title || null,
    examTitleNormalized: title || null,
    examDateTimeRaw: dateMatch[0].trim(),
    examDate,
    examTime,
    examDateTime,
    timeZone,
    needsReview,
    reviewReason,
  };
}
