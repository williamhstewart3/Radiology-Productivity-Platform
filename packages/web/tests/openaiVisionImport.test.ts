import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import type { PipelineResult } from '../src/web/pipeline/importPipeline';
import { __testDeterministicCptCodesFor } from '../src/web/utils/matching';
import { buildFingerprint } from '../src/web/utils/duplicateDetection';
import {
  OpenAiVisionExtractorProvider,
  buildVisionDiagnostics,
  failedVisionDiagnostics,
  validateVisionExtractionPayload,
} from '../src/web/services/openaiVisionImport';
import { VisionExecutionError } from '../src/web/services/openaiVisionWorkflowService';
import { StructuredPowerScribeOcrImportProvider } from '../src/web/providers/StructuredPowerScribeOcrImportProvider';

const visibleRows = [{
  rowNumber: 1,
  procedure: 'XR CHEST PORTABLE',
  examDateTime: '7/1/2026 5:18 PM',
  modifiedDateTime: '7/2/2026 7:59 AM',
  confidence: 0.99,
}];

describe('OpenAI Vision extractor boundary', () => {
  test('strict Vision rows become StructuredStudyRow-backed imports without CPT or RVU', async () => {
    const extraction = validateVisionExtractionPayload({ rows: visibleRows });
    const studies = await new OpenAiVisionExtractorProvider(extraction.rows, '2026-07-01').importStudies();
    expect(studies).toHaveLength(1);
    expect(studies[0].source).toBe('openai_vision');
    expect(studies[0].cpt).toBeNull();
    expect(studies[0].workRvu).toBeNull();
  });

  test('Modified is productivity date and Exam remains the performed timestamp', async () => {
    const studies = await new OpenAiVisionExtractorProvider(visibleRows, '2026-07-01').importStudies();
    expect(studies[0].studyDate).toBe('2026-07-02');
    expect(studies[0].studyTime).toBe('2026-07-01T17:18:00');
    expect(studies[0].modifiedDateTime).toBe('2026-07-02T07:59:00');
  });

  test('malformed output errors and incomplete rows remain reviewable', async () => {
    expect(() => validateVisionExtractionPayload({ rows: [{ procedure: 'XR CHEST' }] })).toThrow();
    const rows = validateVisionExtractionPayload({ rows: [{ rowNumber: 2, procedure: null, examDateTime: null, modifiedDateTime: null, confidence: 0.2 }] }).rows;
    const studies = await new OpenAiVisionExtractorProvider(rows, '2026-07-01').importStudies();
    expect(studies[0].parserNeedsReview).toBe(true);
    expect(studies[0].examTitle).toContain('Unclear procedure');
  });

  test('Vision rows retain the inputs used by shared matching and strict duplicates', async () => {
    const studies = await new OpenAiVisionExtractorProvider(visibleRows, '2026-07-01').importStudies();
    expect(__testDeterministicCptCodesFor(studies[0].procedureName ?? '')).toContain('71045');
    const fingerprint = buildFingerprint(studies[0].procedureName ?? '', '71045', studies[0].studyDate, studies[0].modifiedDateTime, null, null, {
      performedDateTime: studies[0].examDateTime, modifiedDateTime: studies[0].modifiedDateTime, cptCodes: ['71045'],
    });
    expect(fingerprint).toContain('71045');
    const pipeline: PipelineResult = { reviewRows: [], skippedRows: [], sources: ['openai_vision'], profileId: null };
    const diagnostics = buildVisionDiagnostics({
      buildCommit: 'test', selectedEngine: 'openai_vision', actualEngine: 'openai_vision', ocrUsed: 'No',
      model: 'gpt-5.6-terra', cropCoordinates: { x: 0.3, y: 0.1, width: 0.69, height: 0.85 },
      extractedRows: 1, validRows: 1, extractionDurationSeconds: 1,
      extractorProviderClass: 'OpenAiVisionExtractorProvider', openAiEndpointCalled: true,
      openAiResponseReceived: true, ocrProviderCalled: false, tesseractCalled: false,
      ocrReconstructionCalled: false, modelRequested: 'gpt-5.6-terra', modelReturned: 'gpt-5.6-terra',
      cropSentToVision: true, rowsReturnedDirectlyByVision: 1, rowsEnteringSharedPipeline: 1,
      fallbackUsed: false, fallbackReason: null,
    }, pipeline);
    expect(diagnostics.downstreamAccountedRows).toBe(0);
  });

  test('Vision workflow and precheck never import or call OCR reconstruction', () => {
    const workflow = readFileSync('src/web/services/openaiVisionWorkflowService.ts', 'utf8');
    const precheck = readFileSync('src/web/services/ocrWorkflowService.ts', 'utf8')
      .split('/** Dimension-only preview for Vision.')[1];
    expect(workflow).not.toContain('OCRImportProvider');
    expect(workflow).not.toContain('processOcrImport');
    expect(workflow).not.toContain('reconstructTableRows');
    expect(precheck).not.toContain('extractText');
  });

  test('API key is server-only and the UI has no silent OCR fallback', () => {
    const server = readFileSync('src/api/openaiVisionExtraction.ts', 'utf8');
    const page = readFileSync('src/web/pages/Import.tsx', 'utf8');
    const visionBranch = page.slice(page.indexOf("processingEngine === 'openai_vision'"), page.indexOf('const usedStructuredHelper'));
    expect(server).toContain('process.env.OPENAI_API_KEY');
    expect(page).not.toContain('OPENAI_API_KEY');
    expect(page).not.toContain('VITE_OPENAI');
    expect(visionBranch).not.toContain('processOcrImport');
    expect(page).toContain('OpenAI Vision did not run. No OCR fallback was used.');
  });

  test('Vision API failure is represented as fail-closed with no OCR fallback', () => {
    const diagnostics = failedVisionDiagnostics({ x: 0.3, y: 0.1, width: 0.69, height: 0.85 }, {
      openAiEndpointCalled: true, openAiResponseReceived: true,
    });
    const error = new VisionExecutionError('OpenAI Vision did not run. No OCR fallback was used.', diagnostics);
    expect(error.message).toBe('OpenAI Vision did not run. No OCR fallback was used.');
    expect(error.diagnostics.fallbackUsed).toBe(false);
    expect(error.diagnostics.ocrProviderCalled).toBe(false);
    expect(error.diagnostics.tesseractCalled).toBe(false);
  });

  test('OCR selection never invokes Vision and current OCR rows carry the advanced marker', async () => {
    const page = readFileSync('src/web/pages/Import.tsx', 'utf8');
    const ocrBranch = page.slice(page.indexOf('const usedStructuredHelper'), page.indexOf('async function queueClipboardImage'));
    expect(ocrBranch).not.toContain('processOpenAiVisionImport');
    const rows = await new StructuredPowerScribeOcrImportProvider([{
      procedureName: 'XR CHEST PORTABLE', examDateTime: '7/1/2026 5:18 PM', modifiedDateTime: '7/2/2026 7:59 AM',
      rawProcedureText: 'XR CHEST PORTABLE', rawExamDateText: '7/1/2026 5:18 PM', rawModifiedText: '7/2/2026 7:59 AM',
      confidence: 0.99, needsReview: false, reviewReason: null,
    }], '2026-07-02').importStudies();
    expect(rows[0].source).toBe('advanced_ocr');
  });
});
