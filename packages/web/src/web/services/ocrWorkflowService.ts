import { CSVImportProvider } from '../providers/CSVImportProvider';
import { OCRImportProvider, type OCRImportDebugInfo, type OCRImportDebugRow } from '../providers/OCRImportProvider';
import { StructuredPowerScribeOcrImportProvider } from '../providers/StructuredPowerScribeOcrImportProvider';
import { runImportPipeline, type PipelineResult, type PipelineReviewRow } from '../pipeline/importPipeline';
import { recordAuditEvent } from '../utils/audit';
import { ensureUserSettings } from '../db/database';
import { buildFingerprint } from '../utils/duplicateDetection';
import type { ImportProvider } from '../types/importProvider';
import type { PowerScribeOcrAccounting, PowerScribeStructuredOcrRow } from '../types/structuredOcr';

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
  ocrDebug?: OCRImportDebugInfo | null;
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

function attachOcrMatchDebug(debugInfo: OCRImportDebugInfo | null, result: PipelineResult): OCRImportDebugInfo | null {
  if (!debugInfo) return null;

  const rowsByRawLine = new Map<string, PipelineReviewRow>();
  for (const row of [...result.reviewRows, ...result.skippedRows]) {
    const rawLine = row.source.parserRawLine;
    if (rawLine && !rowsByRawLine.has(rawLine)) rowsByRawLine.set(rawLine, row);
  }

  return {
    ...debugInfo,
    duplicateSkippedCount: result.skippedRows.length,
    finalReviewRowCount: result.reviewRows.length,
    autoApprovedRowCount: result.reviewRows.filter((row) => row.autoApproved || row.approvalStatus === 'auto_approved').length,
    manuallyApprovedRowCount: result.reviewRows.filter((row) => row.approvalStatus === 'manual_approved' || row.approvalStatus === 'approved_as_new').length,
    possibleDuplicateRowCount: result.reviewRows.filter((row) => row.duplicateStatus === 'possible').length,
    exactDuplicateSkippedCount: result.skippedRows.filter((row) => row.duplicateStatus === 'exact' || row.autoSkipped).length,
    excludedRowCount: result.reviewRows.filter((row) => !row.included).length,
    detectedRows: debugInfo.detectedRows.map((row) => {
      const matched = rowsByRawLine.get(row.rawText);
      if (!matched) return row;

      const selectedIndices = matched.selectedCandidateIndices.length
        ? matched.selectedCandidateIndices
        : matched.selectedCandidateIndex == null
          ? []
          : [matched.selectedCandidateIndex];
      const selected = selectedIndices
        .map((index) => matched.candidates[index])
        .filter(Boolean);
      const top = matched.candidates[0] ?? null;
      const duplicateKey = selected.length > 0
        ? buildFingerprint(
            matched.source.procedureName ?? matched.source.cleanedExamName ?? matched.source.examTitle,
            selected[0].cptCode,
            matched.source.modifiedDate ?? matched.source.modifiedDateTime?.slice(0, 10) ?? matched.source.studyDate,
            matched.source.modifiedDateTime,
            matched.source.accessionNumber,
            selected[0].modality,
            {
              cptCodes: selected.map((candidate) => candidate.cptCode),
              performedDateTime: matched.source.examDateTime ?? null,
              modifiedDateTime: matched.source.modifiedDateTime,
            },
          )
        : null;

      return {
        ...row,
        matchResult: {
          selectedCpts: selected.map((candidate) => `${candidate.cptCode}${candidate.modifier ? `-${candidate.modifier}` : ''}`),
          topCandidate: top ? `${top.cptCode}${top.modifier ? `-${top.modifier}` : ''}` : null,
          confidence: top?.confidence ?? null,
          needsReview: matched.needsReview,
          reviewReason: matched.reviewReason,
          duplicateKey,
        },
      };
    }),
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
    action: 'ocr_completed',
    summary: `Text/CSV import processed ${processed.extractedCount} extracted studies`,
    detailsJson: JSON.stringify({
      source: 'csv',
      reviewRows: processed.result.reviewRows.length,
      skippedRows: processed.result.skippedRows.length,
    }),
  });
  return processed;
}

export async function processOcrImport(
  source: Blob,
  context: WorkflowContext,
  metadata?: { filename?: string; size?: number | null; cropAlreadyApplied?: boolean },
): Promise<ProcessedImportResult> {
  const settings = await ensureUserSettings();
  const savedCrop = settings.savedPowerScribeCropRegions?.default ?? null;
  if (metadata?.filename) {
    await recordAuditEvent({
      profileId: context.profileId,
      siteId: context.siteId,
      sessionId: context.sessionId,
      logDate: context.logDate,
      action: 'screenshot_imported',
      summary: `Screenshot imported: ${metadata.filename}`,
      detailsJson: JSON.stringify({ filename: metadata.filename, size: metadata.size ?? null }),
    });
  }

  const provider = new OCRImportProvider(source, context.logDate, {
      cropBeforeOcr: !metadata?.cropAlreadyApplied && settings.requireCropBeforeOcr !== false,
      cropRegion: savedCrop
        ? {
            x: savedCrop.x,
            y: savedCrop.y,
            width: savedCrop.width,
            height: savedCrop.height,
          }
        : null,
    });
  const processed = await processProvider(
    provider,
    context,
    (count) => `Screenshot OCR completed (${count} extracted)`,
  );
  await recordAuditEvent({
    profileId: context.profileId,
    siteId: context.siteId,
    sessionId: context.sessionId,
    logDate: context.logDate,
    action: 'ocr_completed',
    summary: `OCR completed ${processed.extractedCount} extracted studies`,
    detailsJson: JSON.stringify({
      reviewRows: processed.result.reviewRows.length,
      skippedRows: processed.result.skippedRows.length,
    }),
  });
  return { ...processed, ocrDebug: attachOcrMatchDebug(provider.getDebugInfo(), processed.result) };
}

function structuredRowRawLine(row: PowerScribeStructuredOcrRow): string {
  return JSON.stringify({
    procedure: row.rawProcedureText,
    examDate: row.rawExamDateText,
    modified: row.rawModifiedText,
  });
}

function structuredRowToDebugRow(row: PowerScribeStructuredOcrRow): OCRImportDebugRow {
  return {
    rawText: structuredRowRawLine(row),
    rawProcedureColumnText: row.rawProcedureText,
    rawExamDateColumnText: row.rawExamDateText,
    rawModifiedDateColumnText: row.rawModifiedText,
    procedureName: row.procedureName,
    examName: row.procedureName,
    cleanedExamName: row.procedureName,
    cleanedText: row.procedureName,
    examDate: row.examDateTime?.slice(0, 10) ?? null,
    examTime: row.examDateTime?.slice(11, 16) ?? null,
    examDateTime: row.examDateTime,
    studyDateTime: row.examDateTime,
    studyDate: row.examDateTime?.slice(0, 10) ?? null,
    modifiedDateTime: row.modifiedDateTime,
    modifiedDate: row.modifiedDateTime?.slice(0, 10) ?? null,
    modifiedTime: row.modifiedDateTime?.slice(11, 16) ?? null,
    accessionNumber: null,
    rowIndex: null,
    dateTimeConfidence: row.confidence,
    extractionConfidence: row.confidence,
    needsReview: row.needsReview,
    reviewReason: row.reviewReason,
  };
}

export function reconciliationWarningFor(accounting: PowerScribeOcrAccounting | null | undefined): string | null {
  if (!accounting) return null;
  const { anchorCount, bandCount, inkProjectionRowEstimate } = accounting;
  const values = [anchorCount, bandCount, inkProjectionRowEstimate];
  const spread = Math.max(...values) - Math.min(...values);
  if (spread <= 2) return null;
  return `Row-count reconciliation failed: anchors=${anchorCount}, bands=${bandCount}, ink-estimate=${inkProjectionRowEstimate} (spread ${spread}). Every row in this batch requires manual review.`;
}

function forceReviewForReconciliation(rows: PipelineReviewRow[]): PipelineReviewRow[] {
  return rows.map((row) => ({
    ...row,
    needsReview: true,
    autoApproved: false,
    autoApprovalLevel: null,
    approvalStatus: row.approvalStatus === 'auto_approved' ? 'pending' : row.approvalStatus,
  }));
}

export function __testForceReviewForReconciliation(rows: PipelineReviewRow[]): PipelineReviewRow[] {
  return forceReviewForReconciliation(rows);
}

export async function processStructuredPowerScribeOcrImport(
  rows: PowerScribeStructuredOcrRow[],
  context: WorkflowContext,
  accounting?: PowerScribeOcrAccounting | null,
): Promise<ProcessedImportResult> {
  const processed = await processProvider(
    new StructuredPowerScribeOcrImportProvider(rows, context.logDate),
    context,
    (count) => `Windows PowerScribe OCR completed (${count} extracted)`,
  );

  const reconciliationWarning = reconciliationWarningFor(accounting);
  const result = reconciliationWarning
    ? { ...processed.result, reviewRows: forceReviewForReconciliation(processed.result.reviewRows) }
    : processed.result;

  await recordAuditEvent({
    profileId: context.profileId,
    siteId: context.siteId,
    sessionId: context.sessionId,
    logDate: context.logDate,
    action: 'ocr_completed',
    summary: `Windows PowerScribe OCR completed ${processed.extractedCount} extracted studies`,
    detailsJson: JSON.stringify({
      source: 'windows_structured_ocr',
      reviewRows: result.reviewRows.length,
      skippedRows: result.skippedRows.length,
      accounting: accounting ?? null,
      reconciliationWarning,
    }),
  });

  const debugInfo: OCRImportDebugInfo = {
    crop: null,
    ocrProvider: 'Windows PowerScribe OCR helper',
    ocrText: rows.map((row) => structuredRowRawLine(row)).join('\n'),
    ocrLines: rows.map((row) => row.rawProcedureText),
    rawLineCount: accounting
      ? accounting.procedureLineCount + accounting.examLineCount + accounting.modifiedLineCount
      : rows.length,
    cleanedLineCount: rows.length,
    reconstructedRowCount: accounting?.bandCount ?? rows.length,
    parsedRowCount: rows.length,
    rejectedRowCount: 0,
    rejectedRows: [],
    detectedRows: rows.map(structuredRowToDebugRow),
    ocrConfidence: rows.length > 0 ? rows.reduce((sum, row) => sum + row.confidence, 0) / rows.length : 0,
    accounting: accounting ?? null,
    reconciliationWarning,
  };

  return { ...processed, result, ocrDebug: attachOcrMatchDebug(debugInfo, result) };
}
