/**
 * A review reason can arrive from several layers (OCR helper, import
 * provider, pipeline matching, live UI recomputation). Each layer used to
 * either pick one upstream value or blindly concatenate onto it, so the
 * same phrase could appear twice in the same string with different
 * separators. This is the single place that combines reason strings —
 * everything else should route through it instead of joining directly.
 */
export function dedupeReasons(...parts: Array<string | null | undefined>): string | null {
  const seen = new Set<string>();
  for (const part of parts) {
    if (!part) continue;
    for (const piece of part.split(/\s*[|;]\s*/)) {
      const trimmed = piece.trim();
      if (trimmed) seen.add(trimmed);
    }
  }
  return seen.size > 0 ? [...seen].join('; ') : null;
}
