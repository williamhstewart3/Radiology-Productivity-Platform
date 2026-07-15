import { describe, expect, test } from 'bun:test';
import { __testColumnOcrParams, __testReassembleColumnRows } from '../src/web/providers/OCRImportProvider';
import { StructuredPowerScribeOcrImportProvider } from '../src/web/providers/StructuredPowerScribeOcrImportProvider';
import { parseOcrLines } from '../src/web/utils/powerScribeParser';
import type { OcrResult } from '../src/web/utils/ocrProvider';
import { getDefaultOcrEngine, getTextDetectorConstructor, type OcrEngine } from '../src/web/utils/ocrProvider';
import { inspectPowerScribeCapture } from '../src/web/services/ocrWorkflowService';
import { powerScribeImportRows } from './fixtures/powerScribeImportRows';

function result(lines: string[]): OcrResult {
  return {
    rawText: lines.join('\n'),
    lines,
    positionedWords: [],
    positionedLines: lines.map((text, index) => ({
      text,
      confidence: 0.98,
      bbox: { x0: 0, x1: 300, y0: 40 + index * 50, y1: 64 + index * 50 },
    })),
    confidence: 0.98,
  };
}

describe('browser and Windows PowerScribe OCR grammar parity', () => {
  test('reconstructs the same fixture names and timestamps', async () => {
    const procedure = powerScribeImportRows.map((fixture) => fixture.structured.rawProcedureText);
    const examDate = powerScribeImportRows.map((fixture) => fixture.structured.rawExamDateText);
    const modifiedDate = powerScribeImportRows.map((fixture) => fixture.structured.rawModifiedText);
    const browserRows = parseOcrLines(__testReassembleColumnRows({
      procedure: result(procedure),
      examDate: result(examDate),
      modifiedDate: result(modifiedDate),
    }));
    const windowsRows = await new StructuredPowerScribeOcrImportProvider(
      powerScribeImportRows.map((fixture) => fixture.structured),
      '2026-07-13',
    ).importStudies();

    expect(browserRows.map((row) => [row.procedureName, row.examDateTime, row.modifiedDateTime])).toEqual(
      windowsRows.map((row) => [row.procedureName, row.examDateTime, row.modifiedDateTime]),
    );
  });

  test('runs PowerScribe geometry against a mock engine', async () => {
    const mockEngine: OcrEngine = {
      name: 'tesseract.js',
      async extractText() {
        return {
          ...result([]),
          positionedWords: [
            { text: 'Procedure', confidence: 1, bbox: { x0: 300, y0: 100, x1: 430, y1: 125 } },
            { text: 'Exam Date', confidence: 1, bbox: { x0: 900, y0: 100, x1: 1040, y1: 125 } },
            { text: 'Modified', confidence: 1, bbox: { x0: 1250, y0: 100, x1: 1370, y1: 125 } },
            { text: '7/13/2026 8:30 AM', confidence: 1, bbox: { x0: 1250, y0: 160, x1: 1500, y1: 185 } },
            { text: '7/13/2026 9:30 AM', confidence: 1, bbox: { x0: 1250, y0: 330, x1: 1500, y1: 355 } },
          ],
        };
      },
    };
    const inspected = await inspectPowerScribeCapture(
      new Blob(['fixture']),
      mockEngine,
      async () => ({ width: 1800, height: 1000 }),
    );
    expect(inspected).toMatchObject({ detected: true, method: 'headerAnchors', width: 1800, height: 1000 });
    expect(inspected.tableRect).not.toBeNull();
    expect(inspected.suggestedManualGuides).not.toBeNull();
    expect(inspected.suggestedManualGuides!.left).toBeLessThan(inspected.suggestedManualGuides!.procedureEnd);
    expect(inspected.suggestedManualGuides!.procedureEnd).toBeLessThan(inspected.suggestedManualGuides!.examEnd);
    expect(inspected.suggestedManualGuides!.examEnd).toBeLessThan(inspected.suggestedManualGuides!.right);
  });

  test('recognizes scaled worklists when browser OCR returns whole text regions', async () => {
    const compositeResult: OcrResult = {
      ...result([]),
      positionedWords: [
        { text: 'Procedure       Exam Date       Modified Date', confidence: 1, bbox: { x0: 80, y0: 30, x1: 420, y1: 46 } },
        { text: 'US ABDOMEN COMPLETE       7/14/2026 8:15 AM       7/14/2026 8:29 AM', confidence: 1, bbox: { x0: 80, y0: 70, x1: 430, y1: 86 } },
        { text: 'CT HEAD WO CONTRAST       7/14/2026 9:00 AM       7/14/2026 9:22 AM', confidence: 1, bbox: { x0: 80, y0: 140, x1: 430, y1: 156 } },
        { text: 'XR CHEST 2 VIEWS       7/14/2026 10:00 AM       7/14/2026 10:18 AM', confidence: 1, bbox: { x0: 80, y0: 210, x1: 430, y1: 226 } },
      ],
    };
    const mockEngine: OcrEngine = { name: 'text-detector', async extractText() { return compositeResult; } };

    const inspected = await inspectPowerScribeCapture(
      new Blob(['scaled fixture']),
      mockEngine,
      async () => ({ width: 450, height: 352 }),
    );

    expect(inspected.detected).toBe(true);
    expect(inspected.tableRect).not.toBeNull();
    expect(inspected.suggestedManualGuides).not.toBeNull();
  });

  test('feature-detects TextDetector and gracefully falls back to Tesseract', () => {
    expect(getTextDetectorConstructor({} as typeof globalThis)).toBeNull();
    expect(getDefaultOcrEngine({} as typeof globalThis).name).toBe('tesseract.js');
    class MockTextDetector { async detect() { return []; } }
    const scope = { TextDetector: MockTextDetector } as unknown as typeof globalThis;
    expect(getTextDetectorConstructor(scope)).toBe(MockTextDetector);
    expect(getDefaultOcrEngine(scope).name).toBe('text-detector');
  });

  test('uses only packaged same-origin Tesseract assets', async () => {
    const source = await Bun.file(new URL('../src/web/utils/ocrProvider.ts', import.meta.url)).text();
    expect(source).not.toContain('VisionApiProvider');
    expect(source).not.toMatch(/https?:\/\//);
    expect(source).toContain("workerPath: '/ocr/tesseract/worker.min.js'");
    expect(source).toContain("langPath: '/ocr/tesseract/lang'");
  });

  test('keeps per-column OCR alphabets constrained and dictionary correction disabled', () => {
    const params = __testColumnOcrParams();
    expect(params.procedure.charWhitelist).toBe('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 /+&()-.');
    expect(params.examDate.charWhitelist).toBe('0123456789/: APM');
    expect(params.modifiedDate.charWhitelist).toBe('0123456789/: APM');
    expect(params.procedure.dictionaryCorrection).toBe(false);
    expect(params.examDate.preserveInterwordSpaces).toBe(true);
  });
});
