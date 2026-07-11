import { describe, expect, test } from 'bun:test';
import { findPowerScribeHeaderAnchors, getTableRectFromAnchors, type WordBox } from '../src/web/utils/powerScribeHeaderAnchors';

function word(text: string, x0: number, y0: number, x1: number, y1: number): WordBox {
  return { text, x0, y0, x1, y1, centerY: (y0 + y1) / 2, height: Math.max(1, y1 - y0) };
}

const HEADER_ROW: WordBox[] = [
  word('Procedure', 100, 40, 220, 60),
  word('Exam', 400, 40, 450, 60),
  word('Date', 452, 40, 500, 60),
  word('Modified', 700, 40, 800, 60),
];

describe('findPowerScribeHeaderAnchors', () => {
  test('locates Procedure / Exam / Modified anchors on the header row', () => {
    const anchors = findPowerScribeHeaderAnchors(HEADER_ROW);

    expect(anchors.found).toBe(true);
    expect(anchors.headerBottom).toBeGreaterThan(60);
    expect(anchors.procX0).toBeLessThan(100);
    expect(anchors.examX0).toBeLessThan(400);
    expect(anchors.modX0).toBeLessThan(700);
    expect(anchors.procX0!).toBeLessThan(anchors.examX0!);
    expect(anchors.examX0!).toBeLessThan(anchors.modX0!);
  });

  test('tolerates a Modifled OCR misread of Modified', () => {
    const words: WordBox[] = [
      word('Procedure', 100, 40, 220, 60),
      word('Exam', 400, 40, 450, 60),
      word('Modifled', 700, 40, 800, 60),
    ];

    const anchors = findPowerScribeHeaderAnchors(words);

    expect(anchors.found).toBe(true);
    expect(anchors.modX0).toBeLessThan(700);
  });

  test('tolerates a Modifted OCR misread of Modified', () => {
    const words: WordBox[] = [
      word('Procedure', 100, 40, 220, 60),
      word('Exam', 400, 40, 450, 60),
      word('Modifted', 700, 40, 800, 60),
    ];

    const anchors = findPowerScribeHeaderAnchors(words);

    expect(anchors.found).toBe(true);
  });

  test('reports found=false when the header row is missing', () => {
    const words: WordBox[] = [
      word('XR CHEST PORTABLE', 100, 200, 300, 220),
      word('7/8/2026', 500, 200, 580, 220),
    ];

    const anchors = findPowerScribeHeaderAnchors(words);

    expect(anchors.found).toBe(false);
  });

  test('rejects a Procedure word with no Exam word to its right', () => {
    const words: WordBox[] = [
      word('Procedure', 100, 40, 220, 60),
      word('Modified', 700, 40, 800, 60),
    ];

    const anchors = findPowerScribeHeaderAnchors(words);

    expect(anchors.found).toBe(false);
  });

  test('rejects header words on different text rows', () => {
    const words: WordBox[] = [
      word('Procedure', 100, 40, 220, 60),
      word('Exam', 400, 400, 450, 420),
      word('Modified', 700, 40, 800, 60),
    ];

    const anchors = findPowerScribeHeaderAnchors(words);

    expect(anchors.found).toBe(false);
  });
});

describe('getTableRectFromAnchors', () => {
  test('derives table bottom from the last date word, not a ratio constant', () => {
    const anchors = findPowerScribeHeaderAnchors(HEADER_ROW);
    const dateWords: WordBox[] = [
      word('7/8/2026', 700, 100, 780, 120),
      word('8:14', 782, 100, 830, 120),
      word('AM', 832, 100, 860, 120),
      word('7/9/2026', 700, 5000, 780, 5020),
      word('9:00', 782, 5000, 830, 5020),
      word('PM', 832, 5000, 860, 5020),
    ];

    const rect = getTableRectFromAnchors([...HEADER_ROW, ...dateWords], anchors);

    expect(rect).not.toBeNull();
    expect(rect!.bottom).toBeGreaterThan(5020);
    expect(rect!.bottom).toBeLessThan(5100);
    expect(rect!.columns.procedure.x0).toBe(anchors.procX0);
    expect(rect!.columns.examDate.x0).toBe(anchors.examX0);
    expect(rect!.columns.modifiedDate.x0).toBe(anchors.modX0);
  });

  test('returns null when no date-shaped words exist below the header', () => {
    const anchors = findPowerScribeHeaderAnchors(HEADER_ROW);
    const rect = getTableRectFromAnchors(HEADER_ROW, anchors);

    expect(rect).toBeNull();
  });
});
