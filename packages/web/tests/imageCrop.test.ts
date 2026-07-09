import { describe, expect, test } from 'bun:test';
import { __testDetectPowerScribeColumnLayoutFromProjection } from '../src/web/utils/imageCrop';

function syntheticThreeColumnProjection(width = 1000): number[] {
  const projection = new Array<number>(width).fill(0.002);
  const addTextBlock = (start: number, end: number, strength: number) => {
    for (let i = start; i <= end; i++) {
      projection[i] = strength + ((i % 17) / 17) * 0.008;
    }
  };

  // Left icons / status marks should not become part of Procedure.
  addTextBlock(35, 82, 0.045);
  addTextBlock(135, 535, 0.070);
  addTextBlock(610, 735, 0.062);
  addTextBlock(790, 980, 0.064);

  // Wide whitespace gutters between Procedure / Exam Date / Modified.
  for (let i = 555; i <= 590; i++) projection[i] = 0.0002;
  for (let i = 755; i <= 785; i++) projection[i] = 0.0002;
  return projection;
}

describe('PowerScribe column crop detection', () => {
  test('detects Procedure, Exam Date, and Modified columns from vertical gutters', () => {
    const layout = __testDetectPowerScribeColumnLayoutFromProjection(syntheticThreeColumnProjection());

    expect(layout.method).toBe('detected');
    expect(layout.columns.procedure.x).toBeGreaterThanOrEqual(0.12);
    expect(layout.columns.procedure.x + layout.columns.procedure.width).toBeLessThan(0.58);
    expect(layout.columns.examDate.x).toBeGreaterThan(0.56);
    expect(layout.columns.examDate.x + layout.columns.examDate.width).toBeLessThan(0.77);
    expect(layout.columns.modifiedDate.x).toBeGreaterThan(0.75);
    expect(layout.threeColumnRect.x).toBeGreaterThanOrEqual(0.12);
    expect(layout.threeColumnRect.x + layout.threeColumnRect.width).toBeLessThanOrEqual(1);
  });

  test('falls back to configured ratios when gutters are not reliable', () => {
    const layout = __testDetectPowerScribeColumnLayoutFromProjection(new Array<number>(60).fill(0.02));

    expect(layout.method).toBe('fallback');
    expect(layout.columns.procedure.x).toBe(0.13);
    expect(layout.columns.examDate.x).toBe(0.54);
    expect(layout.columns.modifiedDate.x).toBe(0.76);
    expect(layout.columns.examDate.width).toBeGreaterThanOrEqual(0.22);
    expect(layout.columns.modifiedDate.width).toBeGreaterThanOrEqual(0.235);
  });
});
