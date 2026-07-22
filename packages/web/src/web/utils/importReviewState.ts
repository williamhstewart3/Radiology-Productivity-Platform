export interface ImportReviewStateInput {
  extractedCount: number;
  reviewRowCount: number;
  skippedRowCount: number;
  matchedCount: number;
  selectedCodeCount: number;
  importing: boolean;
}

export interface ImportReviewState {
  isEmptyExtraction: boolean;
  isAllDuplicates: boolean;
  commitDisabled: boolean;
  commitLabel: string;
}

export function getImportReviewState(input: ImportReviewStateInput): ImportReviewState {
  const isEmptyExtraction = input.extractedCount === 0 && input.reviewRowCount === 0 && input.skippedRowCount === 0;
  const isAllDuplicates = input.extractedCount > 0 && input.reviewRowCount === 0 && input.skippedRowCount > 0;
  const commitDisabled =
    input.importing ||
    isEmptyExtraction ||
    (input.selectedCodeCount === 0 && input.reviewRowCount > 0) ||
    isAllDuplicates;

  const commitLabel = input.importing
    ? 'Saving...'
    : isEmptyExtraction
      ? 'No Studies Found'
      : isAllDuplicates
        ? 'All Duplicates - Nothing to Import'
        : input.reviewRowCount === 0
          ? 'Nothing to Import'
          : `Finalize Day: ${input.matchedCount} ${input.matchedCount === 1 ? 'Study' : 'Studies'} (${input.selectedCodeCount} CPT${input.selectedCodeCount === 1 ? '' : 's'})`;

  return { isEmptyExtraction, isAllDuplicates, commitDisabled, commitLabel };
}
