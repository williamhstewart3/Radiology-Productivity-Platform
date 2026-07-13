/**
 * displayName.ts
 *
 * Single resolution used by every surface that shows a study's name
 * (History rows, Inbox cards, Recent, Mini last-3, receipts): a matched
 * exam/protocol name first, else a cleaned fallback — never the raw OCR
 * line. The raw line still exists on the record for the Details
 * disclosure; this module never deletes it, only decides what's safe to
 * put in front of a radiologist at a glance.
 */

const STRIP_PATTERNS: RegExp[] = [
  /\bmA-?\d*(\.\d+)?\b/gi,
  /\bkV-?\d*(\.\d+)?\b/gi,
  /\bSlice-?\d*(\.\d+)?\b/gi,
  /\bFact-?\d*(\.\d+)?\b/gi,
  /\bTilt\b/gi,
  /\bNone\b/gi,
  /\b\d{2,}\b/g, // standalone runs of 2+ digits — technique/accession noise, not a real exam word
];

const MAX_NAME_LENGTH = 60;

/** Short (<=3 char) all-caps tokens are treated as modality/laterality acronyms (CT, MRI, XR, AP, L, R) and kept as-is instead of being lowercased. */
function smartTitleCase(text: string): string {
  return text
    .split(' ')
    .map((word) => {
      if (word.length === 0) return word;
      if (word.length <= 3 && word === word.toUpperCase() && /[A-Z]/.test(word)) return word;
      return word[0].toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

/**
 * Heuristic for "this text is OCR/technique noise, not a name a human
 * would recognize" — the same patterns the cleaner strips, plus a count
 * of standalone numeric tokens (accession/slice numbers scattered through
 * a garbled OCR line tend to produce several of these).
 */
export function looksLikeArtifact(text: string): boolean {
  if (!text.trim()) return true;
  if (/\bmA-?\s*\d/i.test(text)) return true;
  if (/\bkV-?\s*\d/i.test(text)) return true;
  if (/\bSlice-?\s*\d/i.test(text)) return true;
  if (/\bFact-?\s*\d/i.test(text)) return true;
  if (/\bTilt\b/i.test(text)) return true;
  // A bare run of 4+ digits (accession/study ID leftover) never appears in a
  // real exam name, even a short one like "calcium 75571".
  if (/\b\d{4,}\b/.test(text)) return true;
  const numericTokenCount = (text.match(/\b\d{2,}\b/g) ?? []).length;
  return numericTokenCount >= 3;
}

/**
 * Turns a messy/raw string into a presentable-but-honest fallback name:
 * strips known technique/artifact tokens, collapses whitespace, title-cases
 * (preserving short acronyms), and truncates. This is not trying to
 * reconstruct the real exam name — it's the "at least don't show garbage"
 * floor for when nothing better is available. Callers should treat its
 * output as a fallback (flag it for the "unnamed — tap to fix" affordance),
 * not a real match.
 */
export function cleanFallbackName(raw: string): string {
  let cleaned = raw;
  for (const pattern of STRIP_PATTERNS) cleaned = cleaned.replace(pattern, ' ');
  cleaned = cleaned.replace(/[-_.]{2,}/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return 'Unnamed study';
  const titleCased = smartTitleCase(cleaned);
  return titleCased.length > MAX_NAME_LENGTH
    ? `${titleCased.slice(0, MAX_NAME_LENGTH - 1).trimEnd()}…`
    : titleCased;
}

export interface ResolvedDisplayName {
  name: string;
  /** True when `name` came from the cleaned-fallback tier rather than a real match/alias/rename — callers should show the "unnamed — tap to fix" affordance. */
  isFallback: boolean;
}

/**
 * Resolves the name for an already-committed StudyLog. Priority:
 * 1. cmsDescription — the official CPT-table description tied to the
 *    matched code. Always clean (sourced from the RVU table, never OCR),
 *    and covers both a direct protocol match and a learned-alias match
 *    (both resolve to a candidate with a real description).
 * 2. examTitleDisplay, when it doesn't look like OCR/technique noise —
 *    covers a title the user has explicitly renamed.
 * 3. A cleaned fallback built from whatever text is available
 *    (examTitleDisplay first, then examNameRaw), flagged so the UI can
 *    offer the rename affordance.
 */
export function resolveDisplayName(log: {
  examTitleDisplay?: string | null;
  examNameRaw: string;
  cmsDescription?: string | null;
}): ResolvedDisplayName {
  const cms = log.cmsDescription?.trim();
  if (cms) return { name: cms, isFallback: false };

  const display = log.examTitleDisplay?.trim();
  if (display && !looksLikeArtifact(display)) return { name: display, isFallback: false };

  const raw = display || log.examNameRaw;
  return { name: cleanFallbackName(raw), isFallback: true };
}

/**
 * Resolves the name for a pre-commit capture row (Inbox card face) from
 * the same priority: the selected candidate's matched description first,
 * else a cleaned fallback of the raw procedure text.
 */
export function resolveCaptureName(candidateDescription: string | null | undefined, rawProcedureText: string): ResolvedDisplayName {
  const matched = candidateDescription?.trim();
  if (matched) return { name: matched, isFallback: false };
  return { name: cleanFallbackName(rawProcedureText), isFallback: true };
}
