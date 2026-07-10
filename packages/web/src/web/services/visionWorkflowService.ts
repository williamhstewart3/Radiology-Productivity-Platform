import { CSVImportProvider } from '../providers/CSVImportProvider';
import { PowerScribeVisionImportProvider } from '../providers/PowerScribeVisionImportProvider';
import { runImportPipeline, type PipelineResult } from '../pipeline/importPipeline';
import { recordAuditEvent } from '../utils/audit';
import type { ImportProvider } from '../types/importProvider';
import type { BrowserVisionDiagnostics, PowerScribeVisionRow } from '../types/structuredOcr';

interface WorkflowContext {
  profileId: string | null;
  siteId: string | null;
  sessionId: string | null;
  logDate: string;
}

export interface ProcessedImportResult {
  result: PipelineResult;
  extractedCount: number;
  timelineLabel: string;
}

async function processProvider(
  provider: ImportProvider,
  context: WorkflowContext,
  timelineLabel: (extractedCount: number) => string,
): Promise<ProcessedImportResult> {
  const studies = await provider.importStudies();
  const result = await runImportPipeline(studies, context.logDate, context.profileId);
  return {
    result,
    extractedCount: studies.length,
    timelineLabel: timelineLabel(studies.length),
  };
}

export async function processTextImport(
  rawText: string,
  context: WorkflowContext,
): Promise<ProcessedImportResult> {
  const processed = await processProvider(
    new CSVImportProvider(rawText, context.logDate),
    context,
    (count) => `Text import processed (${count} extracted)`,
  );
  await recordAuditEvent({
    profileId: context.profileId,
    siteId: context.siteId,
    sessionId: context.sessionId,
    logDate: context.logDate,
    action: 'import_processed',
    summary: `Text/CSV import processed ${processed.extractedCount} extracted studies`,
    detailsJson: JSON.stringify({
      source: 'csv',
      reviewRows: processed.result.reviewRows.length,
      skippedRows: processed.result.skippedRows.length,
    }),
  });
  return processed;
}

export async function processPowerScribeVisionImport(
  rows: PowerScribeVisionRow[],
  context: WorkflowContext,
  options: { engine?: 'ollama_vision' | 'browser_vision'; diagnostics?: BrowserVisionDiagnostics | null } = {},
): Promise<ProcessedImportResult> {
  const engine = options.engine ?? 'ollama_vision';
  const label = engine === 'browser_vision' ? 'Browser Vision' : 'Ollama Vision';
  const processed = await processProvider(
    new PowerScribeVisionImportProvider(rows, context.logDate, engine),
    context,
    (count) => `${label} extraction completed (${count} extracted)`,
  );
  await recordAuditEvent({
    profileId: context.profileId,
    siteId: context.siteId,
    sessionId: context.sessionId,
    logDate: context.logDate,
    action: 'vision_completed',
    summary: `${label} extraction completed ${processed.extractedCount} extracted studies`,
    detailsJson: JSON.stringify({
      source: engine,
      diagnostics: options.diagnostics ?? null,
      reviewRows: processed.result.reviewRows.length,
      skippedRows: processed.result.skippedRows.length,
    }),
  });
  return processed;
}
