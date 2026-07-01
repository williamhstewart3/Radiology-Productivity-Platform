import { learnAlias } from '../utils/matching';
import { recordAuditEvent } from '../utils/audit';
import type { AuditLogEntry, CptRvuRow, ExamAlias, MatchCandidate, MemorySuggestion } from '../types';

type LearnableCandidate = Pick<MatchCandidate, 'cptCode' | 'modifier' | 'workRvu' | 'description' | 'modality'> | {
  cptCode: string;
  modifier: string | null;
  workRvu: number | null;
  description?: string | null;
  modality?: CptRvuRow['modality'] | null;
};

interface LearningContext {
  profileId: string | null;
  siteId: string | null;
  sessionId?: string | null;
  logDate: string;
}

interface RememberExamMappingInput extends LearningContext {
  rawText: string;
  canonicalExamName: string | null;
  candidates: LearnableCandidate[];
  source: ExamAlias['source'];
  action?: 'confirm' | 'correct' | 'reject' | 'manual_add';
  audit?: {
    action: AuditLogEntry['action'];
    summary: string;
    details?: unknown;
  };
}

function codeList(candidates: LearnableCandidate[]): string {
  return candidates
    .map((candidate) => `${candidate.cptCode}${candidate.modifier ? `-${candidate.modifier}` : ''}`)
    .join(' + ');
}

export async function rememberExamMapping(input: RememberExamMappingInput): Promise<void> {
  await learnAlias({
    rawText: input.rawText,
    canonicalExamName: input.canonicalExamName,
    candidates: input.candidates.map((candidate) => ({
      cptCode: candidate.cptCode,
      modifier: candidate.modifier,
      workRvu: candidate.workRvu,
      description: candidate.description,
      modality: candidate.modality,
    })),
    source: input.source,
    profileId: input.profileId,
    siteId: input.siteId,
    action: input.action,
  });

  if (!input.audit) return;
  await recordAuditEvent({
    profileId: input.profileId,
    siteId: input.siteId,
    sessionId: input.sessionId ?? null,
    logDate: input.logDate,
    action: input.audit.action,
    summary: input.audit.summary,
    detailsJson: JSON.stringify(input.audit.details ?? { rawText: input.rawText, candidates: input.candidates }),
  });
}

export async function rememberManualEntry(input: LearningContext & {
  rawText: string;
  candidate: MatchCandidate;
  notes?: string | null;
}): Promise<void> {
  await rememberExamMapping({
    ...input,
    canonicalExamName: input.candidate.description,
    candidates: [input.candidate],
    source: 'manual_name_match',
    action: 'manual_add',
    audit: {
      action: 'manual_entry',
      summary: `Manual entry ${input.rawText} -> ${codeList([input.candidate])}`,
      details: { candidate: input.candidate, notes: input.notes ?? null },
    },
  });
}

export async function rememberCorrectedExam(input: LearningContext & {
  rawText: string;
  candidates: LearnableCandidate[];
  source?: ExamAlias['source'];
}): Promise<void> {
  await rememberExamMapping({
    ...input,
    canonicalExamName: input.candidates.map((candidate) => candidate.description).filter(Boolean).join(' + ') || input.rawText,
    candidates: input.candidates,
    source: input.source ?? 'user',
    action: 'correct',
    audit: {
      action: 'cpt_changed',
      summary: `Corrected ${input.rawText} to ${codeList(input.candidates)}`,
      details: { rawText: input.rawText, selected: input.candidates },
    },
  });
}

export async function rememberMemorySuggestionDecision(input: LearningContext & {
  suggestion: MemorySuggestion;
  status: 'approved' | 'rejected';
  rawText?: string | null;
  canonicalExamName?: string | null;
  candidates?: LearnableCandidate[];
}): Promise<void> {
  if (input.status === 'approved' && input.rawText && input.candidates?.length) {
    await rememberExamMapping({
      ...input,
      rawText: input.rawText,
      canonicalExamName: input.canonicalExamName ?? input.rawText,
      candidates: input.candidates,
      source: 'user',
      action: 'confirm',
    });
  }

  await recordAuditEvent({
    profileId: input.profileId,
    siteId: input.siteId,
    sessionId: input.sessionId ?? null,
    logDate: input.logDate,
    action: input.status === 'approved' ? 'alias_learned' : 'cpt_changed',
    summary: `${input.status === 'approved' ? 'Approved' : 'Rejected'} memory suggestion: ${input.suggestion.prompt}`,
    detailsJson: JSON.stringify(input.suggestion),
  });
}

export async function rememberBulkCorrection(input: LearningContext & {
  rawText: string;
  candidate: MatchCandidate;
  occurrenceCount: number;
  normalizedKey: string;
  scope: 'future' | 'site' | 'personal';
  rowIds: string[];
}): Promise<void> {
  await rememberExamMapping({
    ...input,
    canonicalExamName: input.candidate.description,
    candidates: [input.candidate],
    source: 'user',
    action: 'correct',
    audit: {
      action: 'alias_learned',
      summary: `Bulk corrected ${input.occurrenceCount} repeated OCR rows to ${codeList([input.candidate])}`,
      details: {
        normalizedKey: input.normalizedKey,
        scope: input.scope,
        selected: input.candidate,
        rows: input.rowIds,
      },
    },
  });
}
