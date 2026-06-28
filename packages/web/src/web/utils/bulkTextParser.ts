/**
 * Parses a block of pasted text into individual exam entries. Handles
 * whatever delimiter pattern the user happens to paste with -- one item
 * per line, comma-separated on one line, space-separated CPT codes, or
 * any mix of these -- since the actual format varies day to day.
 *
 * Strategy: split on newlines first (since that's the most common and
 * least ambiguous separator for full exam names, which often contain
 * internal spaces). Then, for any resulting line that looks like it
 * contains multiple comma-separated items, split further on commas. Bare
 * space-separated CPT codes (no commas, no exam-name words) are split on
 * whitespace too, but only when EVERY token on the line independently
 * looks like a CPT code -- otherwise a multi-word exam name like
 * "CT abdomen pelvis" would get wrongly shredded into "CT", "abdomen",
 * "pelvis" as three separate bogus entries.
 */

const CPT_TOKEN_PATTERN = /^[0-9]{4,5}[A-Z]?$/i;

function looksLikeCptCode(token: string): boolean {
  return CPT_TOKEN_PATTERN.test(token.trim());
}

export function parseBulkText(raw: string): string[] {
  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const entries: string[] = [];

  for (const line of lines) {
    if (line.includes(',')) {
      const parts = line
        .split(',')
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
      entries.push(...parts);
      continue;
    }

    const spaceParts = line.split(/\s+/).filter(Boolean);
    if (spaceParts.length > 1 && spaceParts.every(looksLikeCptCode)) {
      // Every token is independently a valid-looking CPT code -- this is a
      // space-separated list of codes, not a single exam name with spaces.
      entries.push(...spaceParts);
      continue;
    }

    // Otherwise treat the whole line as one entry (a single CPT code, or
    // a multi-word exam name like "CT abdomen pelvis with contrast").
    entries.push(line);
  }

  // De-duplicate while preserving order, in case the same code/name was
  // pasted twice by accident.
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const entry of entries) {
    const key = entry.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(entry);
    }
  }

  return deduped;
}
