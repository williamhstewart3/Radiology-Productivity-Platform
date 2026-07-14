import { describe, expect, test } from 'bun:test';
import { detectPowerScribeDatetimeLayout, detectPowerScribeHeaderLayout, type PowerScribeOcrWord } from '../src/web/utils/powerScribeHeaderAnchors';

function word(text: string, x0: number, y0: number, x1: number, y1: number): PowerScribeOcrWord {
  return { text, bbox: { x0, y0, x1, y1 }, confidence: 0.98 };
}

describe('PowerScribe header-anchor geometry', () => {
  test('excludes the left glyph gutter and stops after the last Modified band', () => {
    const words = [
      word('Procedure', 200, 100, 320, 125),
      word('Exam', 610, 100, 665, 125),
      word('Date', 675, 100, 720, 125),
      word('Modified', 805, 100, 900, 125),
      word('17', 45, 150, 65, 170),
      word('7/11/26', 805, 150, 870, 170), word('8:29', 875, 150, 920, 170),
      word('7/11/26', 805, 200, 870, 220), word('9:05', 875, 200, 920, 220),
      word('7/11/26', 805, 250, 870, 270), word('9:44', 875, 250, 920, 270),
      word('User:', 200, 900, 250, 920), word('Drafts:', 260, 900, 325, 920),
    ];

    const layout = detectPowerScribeHeaderLayout(words, 1200, 1000);
    expect(layout).not.toBeNull();
    expect(layout!.tableRect.x).toBeGreaterThan(0.15);
    expect(layout!.columns.procedure.x).toBeGreaterThanOrEqual(0);
    expect(layout!.tableRect.y + layout!.tableRect.height).toBeLessThan(0.4);
    expect(layout!.modifiedAnchorCount).toBe(3);
    expect(layout!.bandPitch).toBe(50);
  });

  test('fails closed when all three headers are not present', () => {
    expect(detectPowerScribeHeaderLayout([word('Procedure', 200, 100, 320, 125)], 1200, 1000)).toBeNull();
  });

  test('infers headerless partial-capture columns from repeated datetime clusters', () => {
    const words = [
      word('XR', 120, 100, 145, 120), word('CHEST', 150, 100, 210, 120),
      word('7/11/2026', 600, 100, 690, 120), word('8:15', 700, 100, 740, 120),
      word('7/11/2026', 810, 100, 900, 120), word('8:29', 910, 100, 950, 120),
      word('CT', 120, 150, 145, 170), word('HEAD', 150, 150, 200, 170),
      word('7/11/2026', 600, 150, 690, 170), word('9:00', 700, 150, 740, 170),
      word('7/11/2026', 810, 150, 900, 170), word('9:22', 910, 150, 950, 170),
    ];

    const layout = detectPowerScribeDatetimeLayout(words, 1200, 800);
    expect(layout).not.toBeNull();
    expect(layout!.columns.procedure.x + layout!.columns.procedure.width).toBeLessThan(layout!.columns.examDate.x);
    expect(layout!.columns.examDate.x).toBeLessThan(layout!.columns.modifiedDate.x);
    expect(layout!.modifiedAnchorCount).toBe(2);
  });
});
