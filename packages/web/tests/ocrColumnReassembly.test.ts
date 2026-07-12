import { describe, expect, test } from 'bun:test';
import { __testReassembleColumnRows } from '../src/web/providers/OCRImportProvider';

function ocrResult(lines: Array<{ text: string; y0: number; y1: number; x0?: number; x1?: number }>) {
  return {
    rawText: lines.map((line) => line.text).join('\n'),
    lines: lines.map((line) => line.text),
    positionedLines: lines.map((line) => ({
      text: line.text,
      confidence: 0.95,
      bbox: {
        x0: line.x0 ?? 0,
        x1: line.x1 ?? 100,
        y0: line.y0,
        y1: line.y1,
      },
    })),
    confidence: 0.95,
  };
}

describe('PowerScribe column OCR row reassembly', () => {
  test('keeps split date and time fragments on the same structured row', () => {
    const rows = __testReassembleColumnRows({
      procedure: ocrResult([
        { text: 'XR CHEST PORTABLE', y0: 100, y1: 116 },
      ]),
      examDate: ocrResult([
        { text: '7/8/26', y0: 98, y1: 110, x0: 0, x1: 45 },
        { text: '8:19 AM', y0: 111, y1: 123, x0: 48, x1: 100 },
      ]),
      modifiedDate: ocrResult([
        { text: '7/8/26', y0: 97, y1: 109, x0: 0, x1: 45 },
        { text: '9:05 PM', y0: 112, y1: 124, x0: 48, x1: 100 },
      ]),
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('XR CHEST PORTABLE');
    expect(rows[0]).toContain('7/8/26 8:19 AM');
    expect(rows[0]).toContain('7/8/26 9:05 PM');
  });
});
