import { describe, expect, test } from 'bun:test';
import { __testBandColumnRows } from '../src/web/providers/OCRImportProvider';

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

describe('Modified-anchor banding', () => {
  test('68 anchors with one 2.1x-pitch gap produce 68 rows, one flagged', () => {
    const pitch = 40;
    const modifiedLines: Array<{ text: string; y0: number; y1: number }> = [];
    let y = 100;
    const gapIndex = 30;
    for (let i = 0; i < 68; i++) {
      modifiedLines.push({ text: `7/${(i % 27) + 1}/2026 8:${String(i % 60).padStart(2, '0')} AM`, y0: y, y1: y + 16 });
      y += i === gapIndex ? pitch * 2.1 : pitch;
    }

    const procedureLines = modifiedLines.map((line, index) => ({
      text: `XR CHEST PORTABLE ${index}`,
      y0: line.y0,
      y1: line.y1,
    }));

    const banded = __testBandColumnRows({
      procedure: ocrResult(procedureLines),
      examDate: ocrResult([]),
      modifiedDate: ocrResult(modifiedLines),
    });

    expect(banded).not.toBeNull();
    expect(banded!.rows).toHaveLength(68);
    const flagged = banded!.gapFlags.filter((flag) => flag === 'Possible undetected row above this one');
    expect(flagged).toHaveLength(1);
    expect(banded!.gapFlags[gapIndex + 1]).toBe('Possible undetected row above this one');
  });

  test('two anchors 1.05x line-height apart stay as two rows (regression for merge loss)', () => {
    const lineHeight = 16;
    const gap = lineHeight * 1.05;
    const modifiedLines = [
      { text: '7/1/2026 8:00 AM', y0: 100, y1: 100 + lineHeight },
      { text: '7/1/2026 8:05 AM', y0: 100 + lineHeight + gap, y1: 100 + lineHeight + gap + lineHeight },
    ];
    const procedureLines = [
      { text: 'XR CHEST PORTABLE', y0: modifiedLines[0].y0, y1: modifiedLines[0].y1 },
      { text: 'CT HEAD WITHOUT CONTRAST', y0: modifiedLines[1].y0, y1: modifiedLines[1].y1 },
    ];

    const banded = __testBandColumnRows({
      procedure: ocrResult(procedureLines),
      examDate: ocrResult([]),
      modifiedDate: ocrResult(modifiedLines),
    });

    expect(banded).not.toBeNull();
    expect(banded!.rows).toHaveLength(2);
    expect(banded!.rows[0].rawProcedureColumnText).toBe('XR CHEST PORTABLE');
    expect(banded!.rows[1].rawProcedureColumnText).toBe('CT HEAD WITHOUT CONTRAST');
  });

  test('a wrapped two-line procedure name merges into a single joined row', () => {
    const modifiedLines = [
      { text: '7/1/2026 8:00 AM', y0: 200, y1: 216 },
    ];
    const procedureLines = [
      { text: 'MRI LUMBAR SPINE', y0: 190, y1: 206 },
      { text: 'WITHOUT CONTRAST', y0: 207, y1: 223 },
    ];

    const banded = __testBandColumnRows({
      procedure: ocrResult(procedureLines),
      examDate: ocrResult([]),
      modifiedDate: ocrResult(modifiedLines),
    });

    expect(banded).not.toBeNull();
    expect(banded!.rows).toHaveLength(1);
    expect(banded!.rows[0].rawProcedureColumnText).toBe('MRI LUMBAR SPINE WITHOUT CONTRAST');
  });

  test('falls back to null (old clustering) when zero Modified anchors are found', () => {
    const banded = __testBandColumnRows({
      procedure: ocrResult([{ text: 'XR CHEST PORTABLE', y0: 100, y1: 116 }]),
      examDate: ocrResult([{ text: '7/1/2026 8:00 AM', y0: 100, y1: 116 }]),
      modifiedDate: ocrResult([{ text: 'unreadable smudge', y0: 100, y1: 116 }]),
    });

    expect(banded).toBeNull();
  });
});
