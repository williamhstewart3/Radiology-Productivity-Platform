import { describe, expect, test } from 'bun:test';
import { __testReassembleColumnRows, classifyPowerScribeStatusText, powerScribeRowGrammarFailure } from '../src/web/providers/OCRImportProvider';

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
    positionedWords: [],
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

describe('PowerScribe strict row grammar', () => {
  test('accepts only a plausible RIS title with both datetimes', () => {
    expect(powerScribeRowGrammarFailure({
      procedureName: 'CT HEAD WO CONTRAST',
      examDateTime: '2026-07-11T08:15:00',
      modifiedDateTime: '2026-07-11T08:29:00',
    })).toBeNull();
    expect(powerScribeRowGrammarFailure({
      procedureName: 'TEND Adult Slice 6.00',
      examDateTime: '2026-07-11T08:15:00',
      modifiedDateTime: '2026-07-11T08:29:00',
    })).toContain('RIS title');
    expect(powerScribeRowGrammarFailure({
      procedureName: 'CT HEAD WO CONTRAST',
      examDateTime: '2026-07-11T08:15:00',
      modifiedDateTime: null,
    })).toContain('Modified');
  });

  test('bands a 68-row Browse-density capture from Modified anchors without merging rows', () => {
    const rows = Array.from({ length: 68 }, (_, index) => ({
      procedure: `CT HEAD WO CONTRAST ${index + 1}`,
      exam: `7/11/2026 8:${String(index % 60).padStart(2, '0')} AM`,
      modified: `7/11/2026 9:${String(index % 60).padStart(2, '0')} AM`,
      y0: 20 + index * 42,
      y1: 44 + index * 42,
    }));
    const reconstructed = __testReassembleColumnRows({
      procedure: ocrResult(rows.map((row) => ({ text: row.procedure, y0: row.y0, y1: row.y1 }))),
      examDate: ocrResult(rows.map((row) => ({ text: row.exam, y0: row.y0, y1: row.y1 }))),
      modifiedDate: ocrResult(rows.map((row) => ({ text: row.modified, y0: row.y0, y1: row.y1 }))),
    });

    expect(reconstructed).toHaveLength(68);
    expect(reconstructed[0]).toContain('CT HEAD WO CONTRAST 1');
    expect(reconstructed[67]).toContain('CT HEAD WO CONTRAST 68');
  });

  test('classifies signed and in-progress glyphs conservatively', () => {
    expect(classifyPowerScribeStatusText('✓')).toBe('check');
    expect(classifyPowerScribeStatusText('➡')).toBe('arrow');
    expect(classifyPowerScribeStatusText('?')).toBe('unknown');
  });
});
