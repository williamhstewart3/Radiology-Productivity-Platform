import { findMatchCandidates } from '../utils/matching';
import { detectMultipleModalityStarts } from '../utils/powerScribeParser';
import { normalizeOcrExamTextForMatching } from '../utils/ocrExamTextNormalization';
import { normalizeRadiologyDescription } from '../utils/radiologyDescriptionNormalization';
import type { PipelineReviewRow } from '../pipeline/importPipeline';
import type {
  CorrectionAction,
  CorrectionActionType,
  FeedbackEvent,
  FeedbackEventCategory,
  FeedbackEventSeverity,
  MatchCandidate,
} from '../types';
import type { ImportedStudy } from '../types/importProvider';

export type AssistantProblemType =
  | 'bad_ocr'
  | 'bad_exam_cleanup'
  | 'merged_ocr_rows'
  | 'wrong_cpt'
  | 'missing_datetime'
  | 'wrong_datetime'
  | 'wrong_duplicate'
  | 'should_auto_approve'
  | 'should_require_review'
  | 'institution_mapping_needed'
  | 'unclear_request';

export interface AssistantContext {
  profileId: string | null;
  siteId: string | null;
  sessionId: string | null;
  logDate: string;
  rowId: string;
  rowIndex: number;
  nearbyRows: Array<{ tempId: string; rowIndex: number; procedureName: string; examDateTime: string | null; modifiedDateTime: string | null }>;
  rawOcrText: string | null;
  rawProcedureText: string | null;
  rawExamDateText: string | null;
  rawModifiedDateText: string | null;
  cleanedExamTitle: string;
  normalizedExamTitle: string;
  parserWarnings: string[];
  parserConfidence: number | null;
  ocrConfidence: number | null;
  llmCleanupOutput: string | null;
  institutionDictionaryCandidates: string[];
  selectedCpts: string[];
  candidateCpts: string[];
  cptCandidates: Array<{ cptCode: string; modifier: string | null; description: string; confidence: number; source: string; workRvu: number | null }>;
  rvuValidation: Array<{ cptCode: string; modifier: string | null; workRvu: number | null; validForAutoCoding: boolean }>;
  examDateTime: string | null;
  modifiedDateTime: string | null;
  duplicateStatus: PipelineReviewRow['duplicateStatus'];
  duplicateReason: string | null;
  duplicateFingerprint: string | null;
  reviewReason: string | null;
  autoApprovalStatus: 'auto_approved' | 'needs_review' | 'excluded';
  priorCorrections: Array<{ actionType: CorrectionActionType; explanation: string; appliedAt: string | null }>;
}

export interface AssistantProposedAction {
  actionType: CorrectionActionType;
  targetRowId: string;
  proposedTitle?: string;
  proposedCptCodes?: string[];
  examDateTime?: string | null;
  modifiedDateTime?: string | null;
  proposedNewRows?: Array<{ procedureName: string; examDateTime: string | null; modifiedDateTime: string | null; dateTimePairingConfidence: number; reviewReason: string }>;
  explanation: string;
  confidence: number;
  requiresUserApproval: boolean;
}

export interface AssistantResponse {
  understoodIntent: string;
  problemType: AssistantProblemType;
  explanation: string;
  proposedActions: AssistantProposedAction[];
  confidence: number;
  safetyConcerns: string[];
  requiresUserApproval: boolean;
  suggestedUserChoices: string[];
}

export interface AssistantRequestInput {
  requestText: string;
  categoryHint?: FeedbackEventCategory;
  profileId?: string | null;
  siteId?: string | null;
  sessionId?: string | null;
  logDate: string;
  row: PipelineReviewRow;
  rowIndex: number;
  rows: PipelineReviewRow[];
  priorActions?: CorrectionAction[];
}

export interface FeedbackSummary {
  topRecurringIssues: string[];
  examples: Array<{ category: FeedbackEventCategory; comment: string; rawOcrText: string | null; expectedBehavior: string | null }>;
  likelyAffectedFiles: string[];
  suggestedTests: string[];
  codexPrompt: string;
}

function procedureNameForSource(source: ImportedStudy): string {
  return (source.procedureName ?? source.cleanedExamName ?? source.cleanedText ?? source.examTitle).trim();
}

function rawColumn(source: ImportedStudy, keys: string[]): string | null {
  const raw = source as unknown as Record<string, unknown>;
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function selectedCandidates(row: PipelineReviewRow): MatchCandidate[] {
  const indices = row.selectedCandidateIndices?.length
    ? row.selectedCandidateIndices
    : row.selectedCandidateIndex == null ? [] : [row.selectedCandidateIndex];
  return indices.map((index) => row.candidates[index]).filter((candidate): candidate is MatchCandidate => Boolean(candidate));
}

function duplicateFingerprint(row: PipelineReviewRow): string | null {
  const selectedCptSet = selectedCandidates(row)
    .map((candidate) => candidate.cptCode)
    .sort()
    .join('+');
  if (!selectedCptSet || !row.source.examDateTime || !row.source.modifiedDateTime) return null;
  return `${selectedCptSet}|${row.source.examDateTime.slice(0, 16)}|${row.source.modifiedDateTime.slice(0, 16)}`;
}

function parserWarningsFor(row: PipelineReviewRow): string[] {
  return [
    row.source.parserReviewReason,
    row.reviewReason,
    row.duplicateReason,
  ].filter((value): value is string => Boolean(value?.trim()));
}

function inferCategory(requestText: string, hint?: FeedbackEventCategory): FeedbackEventCategory {
  if (hint) return hint;
  const text = requestText.toLowerCase();
  if (/\bduplicate|dupe\b/.test(text)) return 'wrong_duplicate';
  if (/\btime|date|read|modified\b/.test(text)) return 'missing_datetime';
  if (/\bsplit|two exams|two studies|second (ct|xr|mri|mr|us|pet|nm)\b/.test(text)) return 'merged_ocr_rows';
  if (/\bcpt|code|mapping|71045|74177|75571\b/.test(text)) return 'wrong_cpt';
  if (/\bauto.?approve|approval\b/.test(text)) return text.includes('should') ? 'should_auto_approve' : 'bad_auto_approval';
  if (/\binstitution|dictionary|alias\b/.test(text)) return 'institution_mapping_needed';
  if (/\bshould be\b/.test(text)) return 'bad_exam_cleanup';
  if (/\bocr|raw|text|cleanup|name|title\b/.test(text)) return 'bad_ocr';
  return 'other';
}

function categoryToProblem(category: FeedbackEventCategory): AssistantProblemType {
  if (category === 'merged_ocr_rows') return 'merged_ocr_rows';
  if (category === 'wrong_duplicate') return 'wrong_duplicate';
  if (category === 'wrong_cpt') return 'wrong_cpt';
  if (category === 'missing_datetime') return 'missing_datetime';
  if (category === 'bad_exam_cleanup') return 'bad_exam_cleanup';
  if (category === 'should_auto_approve') return 'should_auto_approve';
  if (category === 'bad_auto_approval') return 'should_require_review';
  if (category === 'institution_mapping_needed') return 'institution_mapping_needed';
  if (category === 'bad_ocr') return 'bad_ocr';
  return 'unclear_request';
}

function likelySeverity(category: FeedbackEventCategory, row: PipelineReviewRow): FeedbackEventSeverity {
  if (category === 'wrong_duplicate' && row.autoSkipped) return 'blocking';
  if (category === 'merged_ocr_rows' || category === 'wrong_cpt' || category === 'missing_datetime') return 'high';
  if (category === 'bad_auto_approval' || category === 'should_auto_approve') return 'medium';
  return 'low';
}

function protectedTitleFromRequest(requestText: string, context: AssistantContext): string | null {
  const joined = `${requestText} ${context.rawProcedureText ?? ''} ${context.cleanedExamTitle}`;
  const normalized = normalizeOcrExamTextForMatching(joined).toUpperCase();
  if (/\bXR\s+CHEST\s+PORTABLE\b/.test(normalized)) return 'XR CHEST PORTABLE';
  return null;
}

export function buildAssistantContext(input: Omit<AssistantRequestInput, 'requestText' | 'categoryHint'>): AssistantContext {
  const procedureName = procedureNameForSource(input.row.source);
  const nearbyRows = input.rows
    .map((row, index) => ({ row, index }))
    .filter(({ index }) => Math.abs(index - input.rowIndex) <= 2 && index !== input.rowIndex)
    .map(({ row, index }) => ({
      tempId: row.tempId,
      rowIndex: index,
      procedureName: procedureNameForSource(row.source),
      examDateTime: row.source.examDateTime ?? null,
      modifiedDateTime: row.source.modifiedDateTime ?? null,
    }));
  const selected = selectedCandidates(input.row);
  const institutionCandidates = input.row.candidates
    .filter((candidate) => candidate.explanation?.source?.toLowerCase().includes('institution'))
    .map((candidate) => `${candidate.cptCode} ${candidate.description}`);

  return {
    profileId: input.profileId ?? null,
    siteId: input.siteId ?? null,
    sessionId: input.sessionId ?? null,
    logDate: input.logDate,
    rowId: input.row.tempId,
    rowIndex: input.rowIndex,
    nearbyRows,
    rawOcrText: input.row.source.parserRawLine ?? input.row.source.examTitle ?? null,
    rawProcedureText: rawColumn(input.row.source, ['rawProcedureText', 'rawProcedureColumnText']) ?? procedureName,
    rawExamDateText: rawColumn(input.row.source, ['rawExamDateText', 'rawExamDateColumnText']),
    rawModifiedDateText: rawColumn(input.row.source, ['rawModifiedText', 'rawModifiedDateText', 'rawModifiedDateColumnText']),
    cleanedExamTitle: procedureName,
    normalizedExamTitle: normalizeRadiologyDescription(procedureName),
    parserWarnings: parserWarningsFor(input.row),
    parserConfidence: input.row.source.extractionConfidence ?? null,
    ocrConfidence: input.row.source.ocrConfidence ?? null,
    llmCleanupOutput: rawColumn(input.row.source, ['llmCleanupOutput']),
    institutionDictionaryCandidates: institutionCandidates,
    selectedCpts: selected.map((candidate) => candidate.cptCode),
    candidateCpts: input.row.candidates.map((candidate) => candidate.cptCode),
    cptCandidates: input.row.candidates.map((candidate) => ({
      cptCode: candidate.cptCode,
      modifier: candidate.modifier,
      description: candidate.description,
      confidence: candidate.confidence,
      source: candidate.explanation?.source ?? candidate.method,
      workRvu: candidate.workRvu,
    })),
    rvuValidation: input.row.candidates.map((candidate) => ({
      cptCode: candidate.cptCode,
      modifier: candidate.modifier,
      workRvu: candidate.workRvu,
      validForAutoCoding: candidate.modifier === '26' && (candidate.workRvu ?? 0) > 0,
    })),
    examDateTime: input.row.source.examDateTime ?? null,
    modifiedDateTime: input.row.source.modifiedDateTime ?? null,
    duplicateStatus: input.row.duplicateStatus,
    duplicateReason: input.row.duplicateReason,
    duplicateFingerprint: duplicateFingerprint(input.row),
    reviewReason: input.row.reviewReason ?? input.row.source.parserReviewReason ?? null,
    autoApprovalStatus: !input.row.included ? 'excluded' : input.row.autoApproved ? 'auto_approved' : 'needs_review',
    priorCorrections: (input.priorActions ?? []).map((action) => ({
      actionType: action.actionType,
      explanation: action.explanation,
      appliedAt: action.appliedAt,
    })),
  };
}

export function createFeedbackEvent(input: {
  context: AssistantContext;
  userComment: string;
  category?: FeedbackEventCategory;
  severity?: FeedbackEventSeverity;
  assistantResponse?: AssistantResponse | null;
  expectedCorrectionJson?: string | null;
}): FeedbackEvent {
  const category = input.category ?? inferCategory(input.userComment);
  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    profileId: input.context.profileId,
    sessionId: input.context.sessionId,
    importId: null,
    rowTempId: input.context.rowId,
    studyLogId: null,
    category,
    severity: input.severity ?? 'medium',
    userComment: input.userComment,
    rawOcrText: input.context.rawOcrText,
    rawProcedureText: input.context.rawProcedureText,
    rawExamDateText: input.context.rawExamDateText,
    rawModifiedDateText: input.context.rawModifiedDateText,
    cleanedExamTitle: input.context.cleanedExamTitle,
    normalizedExamTitle: input.context.normalizedExamTitle,
    selectedCptCodes: input.context.selectedCpts,
    candidateCpts: input.context.candidateCpts,
    examDateTime: input.context.examDateTime,
    modifiedDateTime: input.context.modifiedDateTime,
    duplicateStatus: input.context.duplicateStatus,
    duplicateReason: input.context.duplicateReason,
    duplicateFingerprint: input.context.duplicateFingerprint,
    ocrProvider: 'ollama_vision',
    ocrConfidence: input.context.ocrConfidence,
    llmCleanupUsed: Boolean(input.context.llmCleanupOutput),
    llmCleanupOutput: input.context.llmCleanupOutput,
    expectedCorrectionJson: input.expectedCorrectionJson ?? null,
    assistantContextJson: JSON.stringify(input.context),
    assistantResponseJson: input.assistantResponse ? JSON.stringify(input.assistantResponse) : null,
    status: 'new',
  };
}

function actionFromProposal(feedbackEventId: string, targetRowId: string, row: PipelineReviewRow, proposal: AssistantProposedAction): CorrectionAction {
  return {
    id: crypto.randomUUID(),
    feedbackEventId,
    createdAt: new Date().toISOString(),
    actionType: proposal.actionType,
    targetRowId,
    originalRowJson: JSON.stringify(row),
    proposedRowJson: proposal.proposedTitle || proposal.proposedCptCodes || proposal.examDateTime || proposal.modifiedDateTime
      ? JSON.stringify({
          procedureName: proposal.proposedTitle,
          cptCodes: proposal.proposedCptCodes,
          examDateTime: proposal.examDateTime,
          modifiedDateTime: proposal.modifiedDateTime,
        })
      : null,
    proposedNewRowsJson: proposal.proposedNewRows ? JSON.stringify(proposal.proposedNewRows) : null,
    explanation: proposal.explanation,
    confidence: proposal.confidence,
    requiresUserApproval: proposal.requiresUserApproval,
    approvedByUser: false,
    appliedAt: null,
    revertedAt: null,
  };
}

export function proposeAssistantResponse(input: AssistantRequestInput): AssistantResponse {
  const context = buildAssistantContext(input);
  const category = inferCategory(input.requestText, input.categoryHint);
  const problemType = categoryToProblem(category);
  const request = input.requestText.toLowerCase();
  const safetyConcerns: string[] = [];
  const proposedActions: AssistantProposedAction[] = [];
  const modalityDetection = detectMultipleModalityStarts(context.rawProcedureText ?? context.cleanedExamTitle);
  const forcedTitle = protectedTitleFromRequest(input.requestText, context);

  if (problemType === 'merged_ocr_rows' || modalityDetection.hasMultiple) {
    const proposedNewRows = modalityDetection.proposedSplitSegments.map((segment) => ({
      procedureName: normalizeOcrExamTextForMatching(segment).toUpperCase(),
      examDateTime: null,
      modifiedDateTime: null,
      dateTimePairingConfidence: 0,
      reviewReason: 'Possible merged OCR rows / uncertain date-time pairing',
    }));
    safetyConcerns.push('Date/time pairing is uncertain after splitting; split rows must remain in review.');
    proposedActions.push({
      actionType: 'split_merged_row',
      targetRowId: context.rowId,
      proposedNewRows,
      explanation: `Detected ${modalityDetection.starts.map((start) => start.token).join(', ')} modality starts. The later modality likely begins a separate PowerScribe row.`,
      confidence: modalityDetection.hasMultiple ? 0.86 : 0.62,
      requiresUserApproval: true,
    });
  }

  if (forcedTitle) {
    proposedActions.push({
      actionType: 'correct_exam_title',
      targetRowId: context.rowId,
      proposedTitle: forcedTitle,
      proposedCptCodes: forcedTitle === 'XR CHEST PORTABLE' ? ['71045'] : undefined,
      explanation: `${context.cleanedExamTitle} looks like a damaged OCR variant of ${forcedTitle}. CPT matching should rerun on the clean title only.`,
      confidence: 0.92,
      requiresUserApproval: true,
    });
  }

  const explicitCpt = input.requestText.match(/\b(\d{5})(?:\s*(?:\+|\/|,|and)\s*(\d{5}))?\b/i);
  if (explicitCpt) {
    const codes = [explicitCpt[1], explicitCpt[2]].filter((code): code is string => Boolean(code));
    proposedActions.push({
      actionType: 'correct_cpt',
      targetRowId: context.rowId,
      proposedCptCodes: codes,
      explanation: `User requested CPT ${codes.join(' + ')}. The app will validate modifier 26/work RVU rows before applying.`,
      confidence: 0.95,
      requiresUserApproval: true,
    });
  }

  if (problemType === 'wrong_duplicate' || /\bnot (a )?duplicate\b/.test(request)) {
    proposedActions.push({
      actionType: 'mark_not_duplicate',
      targetRowId: context.rowId,
      explanation: context.duplicateFingerprint
        ? `This row has strict duplicate identity ${context.duplicateFingerprint}. If that identity is wrong, this correction affects only the current review session.`
        : 'This row does not have a complete strict duplicate fingerprint because exam/read datetimes or CPTs are missing.',
      confidence: context.duplicateStatus === 'exact' ? 0.72 : 0.9,
      requiresUserApproval: true,
    });
  }

  if (problemType === 'missing_datetime' || problemType === 'wrong_datetime') {
    safetyConcerns.push('The assistant will not invent missing times. Manual date/time edits require explicit confirmation.');
    proposedActions.push({
      actionType: 'correct_datetime',
      targetRowId: context.rowId,
      explanation: 'Use the visible Exam and Read columns or manual user input to correct the row datetime fields.',
      confidence: 0.55,
      requiresUserApproval: true,
    });
  }

  if (/\bwhy\b.*\breview\b|\bin review\b/.test(request)) {
    return {
      understoodIntent: 'Explain why the current row requires review',
      problemType: 'unclear_request',
      explanation: context.reviewReason ?? (context.parserWarnings.join(' | ') || 'This row is in review because the selected CPT, OCR confidence, duplicate status, or date/time confidence did not meet auto-approval rules.'),
      proposedActions: [],
      confidence: 0.82,
      safetyConcerns: [],
      requiresUserApproval: false,
      suggestedUserChoices: ['Save as feedback only', 'Correct CPT', 'Correct exam title', 'Cancel'],
    };
  }

  if (proposedActions.length === 0) {
    proposedActions.push({
      actionType: 'ignore',
      targetRowId: context.rowId,
      explanation: 'Saved as structured feedback. No safe current-session correction was inferred.',
      confidence: 0.4,
      requiresUserApproval: false,
    });
  }

  return {
    understoodIntent: category.replace(/_/g, ' '),
    problemType,
    explanation: proposedActions[0]?.explanation ?? 'Saved feedback for later review.',
    proposedActions,
    confidence: Math.max(...proposedActions.map((action) => action.confidence)),
    safetyConcerns,
    requiresUserApproval: proposedActions.some((action) => action.requiresUserApproval),
    suggestedUserChoices: proposedActions[0]?.actionType === 'split_merged_row'
      ? ['Apply split', 'Edit split', 'Keep as one row', 'Save as feedback only', 'Cancel']
      : ['Apply', 'Edit', 'Save as feedback only', 'Cancel'],
  };
}

export function createAssistantArtifacts(input: AssistantRequestInput): {
  context: AssistantContext;
  response: AssistantResponse;
  feedbackEvent: FeedbackEvent;
  correctionActions: CorrectionAction[];
} {
  const context = buildAssistantContext(input);
  const response = proposeAssistantResponse(input);
  const category = inferCategory(input.requestText, input.categoryHint);
  const feedbackEvent = createFeedbackEvent({
    context,
    userComment: input.requestText,
    category,
    severity: likelySeverity(category, input.row),
    assistantResponse: response,
    expectedCorrectionJson: response.proposedActions.length ? JSON.stringify(response.proposedActions) : null,
  });
  const correctionActions = response.proposedActions.map((proposal) =>
    actionFromProposal(feedbackEvent.id, input.row.tempId, input.row, proposal),
  );
  return { context, response, feedbackEvent, correctionActions };
}

function sourceWithTitle(source: ImportedStudy, title: string): ImportedStudy {
  return {
    ...source,
    examTitle: title,
    procedureName: title,
    cleanedExamName: title,
    cleanedText: title,
    parserRawLine: source.parserRawLine ?? source.examTitle,
    parserNeedsReview: true,
    parserReviewReason: 'Corrected by AI Assistant / user approved',
  };
}

export async function buildCorrectedTitleRow(row: PipelineReviewRow, title: string, profileId?: string | null): Promise<PipelineReviewRow> {
  const candidates = (await findMatchCandidates(title, 6, profileId, {
    requireExamContextForDirectCpt: false,
    directCptContext: title,
  })).filter((candidate) => candidate.modifier === '26' && (candidate.workRvu ?? 0) > 0);
  const selectedIndex = candidates[0] ? 0 : null;
  return {
    ...row,
    source: sourceWithTitle(row.source, title),
    displayTitle: title,
    candidates,
    selectedCandidateIndex: selectedIndex,
    selectedCandidateIndices: selectedIndex == null ? [] : [selectedIndex],
    needsReview: true,
    duplicateStatus: null,
    duplicateExistingLogId: null,
    duplicateReason: null,
    autoApproved: false,
    autoApprovalLevel: null,
    reviewReason: 'Corrected by AI Assistant / user approved',
  };
}

export async function buildSplitRows(row: PipelineReviewRow, proposedRows: AssistantProposedAction['proposedNewRows'], profileId?: string | null): Promise<PipelineReviewRow[]> {
  const rows = proposedRows ?? [];
  const result: PipelineReviewRow[] = [];
  for (const proposed of rows) {
    const candidates = (await findMatchCandidates(proposed.procedureName, 6, profileId, {
      requireExamContextForDirectCpt: false,
      directCptContext: proposed.procedureName,
    })).filter((candidate) => candidate.modifier === '26' && (candidate.workRvu ?? 0) > 0);
    const selectedIndex = candidates[0] ? 0 : null;
    result.push({
      ...row,
      tempId: crypto.randomUUID(),
      source: {
        ...sourceWithTitle(row.source, proposed.procedureName),
        examDateTime: proposed.examDateTime,
        modifiedDateTime: proposed.modifiedDateTime,
        studyTime: proposed.modifiedDateTime,
        dateTimeConfidence: proposed.dateTimePairingConfidence,
        parserNeedsReview: true,
        parserReviewReason: proposed.reviewReason,
      },
      displayTitle: proposed.procedureName,
      candidates,
      selectedCandidateIndex: selectedIndex,
      selectedCandidateIndices: selectedIndex == null ? [] : [selectedIndex],
      needsReview: true,
      duplicateStatus: null,
      duplicateExistingLogId: null,
      duplicateReason: null,
      autoApproved: false,
      autoApprovalLevel: null,
      reviewReason: proposed.reviewReason,
    });
  }
  return result;
}

export function generateFeedbackSummary(events: FeedbackEvent[]): FeedbackSummary {
  const counts = new Map<FeedbackEventCategory, number>();
  for (const event of events) counts.set(event.category, (counts.get(event.category) ?? 0) + 1);
  const topRecurringIssues = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([category, count]) => `${category.replace(/_/g, ' ')}: ${count}`);
  const examples = events.slice(0, 8).map((event) => ({
    category: event.category,
    comment: event.userComment,
    rawOcrText: event.rawOcrText,
    expectedBehavior: event.expectedCorrectionJson,
  }));
  const likelyAffectedFiles = [
    'packages/web/src/web/providers/PowerScribeVisionImportProvider.ts',
    'packages/web/src/web/utils/matching.ts',
    'packages/web/src/web/utils/duplicateDetection.ts',
    'packages/web/src/web/pipeline/importPipeline.ts',
    'packages/web/src/web/pages/Import.tsx',
  ];
  const suggestedTests = [
    'Feedback event includes raw OCR/debug context without PHI fields',
    'Merged procedure rows are flagged and split only after approval',
    'Duplicate correction affects current review session only',
    'Corrected exam title reruns CPT matching and updates selected CPTs',
    'Date/time correction does not invent missing times',
  ];
  const codexPrompt = [
    'Problem statement:',
    topRecurringIssues.join('\n') || 'No recurring issues selected.',
    '',
    'Workflow impact:',
    'PowerScribe OCR review should be fast and quiet; recurring row problems should become durable parser, matching, or duplicate-detection fixes.',
    '',
    'Examples:',
    ...examples.map((event) => `- ${event.category}: ${event.comment}${event.rawOcrText ? ` | raw: ${event.rawOcrText}` : ''}`),
    '',
    'Files likely involved:',
    ...likelyAffectedFiles.map((file) => `- ${file}`),
    '',
    'Tests required:',
    ...suggestedTests.map((test) => `- ${test}`),
  ].join('\n');

  return { topRecurringIssues, examples, likelyAffectedFiles, suggestedTests, codexPrompt };
}
