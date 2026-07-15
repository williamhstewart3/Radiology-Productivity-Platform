import type { MatchCandidate } from '../types';

export function matchCandidateDisplayTitle(
  candidate: Pick<MatchCandidate, 'description' | 'displayTitle' | 'explanation'>,
  institutionalFallback?: string | null,
): string {
  if (candidate.displayTitle?.trim()) return candidate.displayTitle.trim();
  const isInstitutionCandidate =
    candidate.explanation?.source === 'Institution procedure dictionary' ||
    candidate.explanation?.source === 'Institution mapping';
  if (isInstitutionCandidate && institutionalFallback?.trim()) return institutionalFallback.trim();
  return candidate.description;
}
