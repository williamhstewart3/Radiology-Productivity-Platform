import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  buildVisionDiagnostics,
  validateVisionExtractionPayload,
  visionRowsToImportedStudies,
} from '../src/web/services/openaiVisionImport';
import type { PipelineResult } from '../src/web/pipeline/importPipeline';

describe('OpenAI Vision import mapping', () => {
  test('valid structured Vision output becomes ImportedStudy[] without CPT/RVU assignment', () => {
    const extraction = validateVisionExtractionPayload({
      rows: [
        {
          rowNumber: 1,
          procedure: 'XR CHEST PORTABLE',
          examDateTime: '7/1/2026 5:18 PM',
          modifiedDateTime: '7/2/2026 7:59 AM',
          confidence: 0.99,
        },
      ],
    });

    const studies = visionRowsToImportedStudies(extraction.rows, '2026-07-01');

    expect(studies).toHaveLength(1);
    expect(studies[0].source).toBe('openai_vision');
    expect(studies[0].examTitle).toBe('XR CHEST PORTABLE');
    expect(studies[0].procedureName).toBe('XR CHEST PORTABLE');
    expect(studies[0].cpt).toBeNull();
    expect(studies[0].workRvu).toBeNull();
  });

  test('modifiedDateTime determines productivity date while examDateTime remains separate', () => {
    const studies = visionRowsToImportedStudies([
      {
        rowNumber: 1,
        procedure: 'CT APPENDIX PROTOCOL',
        examDateTime: '7/1/2026 11:55 PM',
        modifiedDateTime: '7/2/2026 12:12 AM',
        confidence: 0.94,
      },
    ], '2026-07-01');

    expect(studies[0].studyDate).toBe('2026-07-02');
    expect(studies[0].studyTime).toBe('2026-07-01T23:55:00');
    expect(studies[0].examDateTime).toBe('7/1/2026 11:55 PM');
    expect(studies[0].modifiedDateTime).toBe('7/2/2026 12:12 AM');
  });

  test('malformed API output fails validation visibly', () => {
    expect(() => validateVisionExtractionPayload({
      rows: [{ rowNumber: 1, procedure: '', confidence: 1 }],
    })).toThrow();
  });

  test('low-confidence rows remain marked for downstream review inputs', () => {
    const studies = visionRowsToImportedStudies([
      {
        rowNumber: 1,
        procedure: 'XR CHEST PORTABLE',
        examDateTime: '7/1/2026 5:18 PM',
        modifiedDateTime: '7/2/2026 7:59 AM',
        confidence: 0.42,
      },
    ], '2026-07-01');

    expect(studies[0].visionConfidence).toBe(0.42);
    expect(studies[0].dateTimeConfidence).toBe(0.42);
  });
});

describe('OpenAI Vision row accounting', () => {
  test('68 returned rows produce 68 accounted downstream rows', () => {
    const pipelineResult: PipelineResult = {
      reviewRows: Array.from({ length: 63 }, (_, index) => ({
        tempId: `review-${index}`,
        source: {} as never,
        candidates: index < 4 ? [] : [{} as never],
        selectedCandidateIndex: null,
        selectedCandidateIndices: [],
        needsReview: true,
        duplicateStatus: null,
        duplicateExistingLogId: null,
        duplicateReason: null,
        included: true,
        autoSkipped: false,
        autoApproved: false,
        autoApprovalLevel: null,
        reviewReason: null,
      })),
      skippedRows: Array.from({ length: 5 }, (_, index) => ({
        tempId: `skip-${index}`,
        source: {} as never,
        candidates: [{} as never],
        selectedCandidateIndex: 0,
        selectedCandidateIndices: [0],
        needsReview: false,
        duplicateStatus: 'exact',
        duplicateExistingLogId: `existing-${index}`,
        duplicateReason: 'Exact duplicate',
        included: false,
        autoSkipped: true,
        autoApproved: false,
        autoApprovalLevel: null,
        reviewReason: null,
      })),
      sources: ['openai_vision'],
      profileId: null,
    };

    const diagnostics = buildVisionDiagnostics('gpt-5.6-terra', 68, 68, 12.5, pipelineResult);

    expect(diagnostics.rowsExtracted).toBe(68);
    expect(diagnostics.validStructuredRows).toBe(68);
    expect(diagnostics.unresolvedRows).toBe(4);
    expect(diagnostics.downstreamReviewRows).toBe(63);
    expect(diagnostics.exactDuplicatesSkipped).toBe(5);
    expect(diagnostics.finalAccountedRows).toBe(68);
  });
});

describe('OpenAI Vision implementation boundaries', () => {
  test('Vision workflow never imports or calls OCR code', () => {
    const source = readFileSync('src/web/services/openaiVisionWorkflowService.ts', 'utf8');
    expect(source).not.toContain('OCRImportProvider');
    expect(source).not.toContain('parseOcrLines');
    expect(source).not.toContain('parseOcrLinesWithDebug');
    expect(source).not.toContain('reconstructTableRows');
    expect(source).not.toContain('processOcrImport');
  });

  test('API key remains server-side', () => {
    const apiSource = readFileSync('src/api/openaiVisionExtraction.ts', 'utf8');
    const importPageSource = readFileSync('src/web/pages/Import.tsx', 'utf8');

    expect(apiSource).toContain('process.env.OPENAI_API_KEY');
    expect(importPageSource).not.toContain('OPENAI_API_KEY');
    expect(importPageSource).not.toContain('VITE_OPENAI');
    expect(importPageSource).not.toContain('localStorage');
  });

  test('experimental Vision mode has no silent OCR fallback in the UI branch', () => {
    const importPageSource = readFileSync('src/web/pages/Import.tsx', 'utf8');
    const visionBranchStart = importPageSource.indexOf("processingEngine === 'openai_vision'");
    const ocrBranch = importPageSource.indexOf(": await processOcrImport", visionBranchStart);

    expect(visionBranchStart).toBeGreaterThan(0);
    expect(importPageSource.slice(visionBranchStart, ocrBranch)).not.toContain('processOcrImport');
  });

  test('institution dictionary/CPT matching runs before duplicate detection in the pipeline', () => {
    const pipelineSource = readFileSync('src/web/pipeline/importPipeline.ts', 'utf8');
    const matchIndex = pipelineSource.indexOf('const candidates = (await findMatchCandidates');
    const duplicateIndex = pipelineSource.indexOf('const dupeResults = await checkBatchDuplicates');

    expect(matchIndex).toBeGreaterThan(0);
    expect(duplicateIndex).toBeGreaterThan(matchIndex);
  });
});
