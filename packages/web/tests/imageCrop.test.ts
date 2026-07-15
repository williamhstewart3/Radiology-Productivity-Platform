import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_POWERSCRIBE_STUDY_LIST_CROP,
  DEFAULT_POWERSCRIBE_MANUAL_COLUMN_GUIDES,
  __testBoundToStudyListArea,
  __testDetectPowerScribeColumnLayoutFromProjection,
  detectPowerScribeRowBandsFromProjection,
  normalizePowerScribeRowBands,
  powerScribeManualColumnsFromGuides,
  selectPowerScribeCropTier,
} from '../src/web/utils/imageCrop';

function syntheticThreeColumnProjection(width = 1000): number[] {
  const projection = Array.from({ length: width }, () => 0.002);
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
  test('fallback table crop reaches the lower visible worklist rows', () => {
    const bottom = DEFAULT_POWERSCRIBE_STUDY_LIST_CROP.y + DEFAULT_POWERSCRIBE_STUDY_LIST_CROP.height;

    expect(bottom).toBeGreaterThanOrEqual(0.93);
    expect(bottom).toBeLessThanOrEqual(0.97);
  });

  test('detected crop bounds do not clamp near row 48', () => {
    const bounded = __testBoundToStudyListArea({
      x: 0.2,
      y: 0.22,
      width: 0.76,
      height: 0.74,
    });

    expect(bounded.y + bounded.height).toBeGreaterThanOrEqual(0.95);
  });

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
    const layout = __testDetectPowerScribeColumnLayoutFromProjection(Array.from({ length: 60 }, () => 0.02));

    expect(layout.method).toBe('fallback');
    expect(layout.columns.procedure.x).toBe(0.13);
    expect(layout.columns.examDate.x).toBe(0.54);
    expect(layout.columns.modifiedDate.x).toBe(0.76);
    expect(layout.columns.examDate.width).toBeGreaterThanOrEqual(0.22);
    expect(layout.columns.modifiedDate.width).toBeGreaterThanOrEqual(0.235);
  });

  test('enforces header > datetime > valley > saved tier order', () => {
    const base = { manual: false, headerAnchors: true, datetimeColumns: true, pixelValley: true, savedCrop: true, hasPowerScribeSignal: true };
    expect(selectPowerScribeCropTier({ ...base, manual: true })).toBe('manual');
    expect(selectPowerScribeCropTier(base)).toBe('headerAnchors');
    expect(selectPowerScribeCropTier({ ...base, headerAnchors: false })).toBe('datetimeColumns');
    expect(selectPowerScribeCropTier({ ...base, headerAnchors: false, datetimeColumns: false })).toBe('pixelValley');
    expect(selectPowerScribeCropTier({ ...base, headerAnchors: false, datetimeColumns: false, pixelValley: false })).toBe('savedCrop');
  });

  test('turns manual guides into three aligned, non-overlapping column crops', () => {
    const columns = powerScribeManualColumnsFromGuides(DEFAULT_POWERSCRIBE_MANUAL_COLUMN_GUIDES);

    expect(columns.procedure.y).toBe(columns.examDate.y);
    expect(columns.examDate.y).toBe(columns.modifiedDate.y);
    expect(columns.procedure.height).toBe(columns.examDate.height);
    expect(columns.examDate.height).toBe(columns.modifiedDate.height);
    expect(columns.procedure.x + columns.procedure.width).toBe(columns.examDate.x);
    expect(columns.examDate.x + columns.examDate.width).toBe(columns.modifiedDate.x);
    expect(columns.procedure.width).toBeCloseTo(0.38);
    expect(columns.examDate.width).toBeCloseTo(0.2);
    expect(columns.modifiedDate.width).toBeCloseTo(0.2);
    expect(columns.procedure.y).toBeCloseTo(0.1);
    expect(columns.procedure.height).toBeCloseTo(0.85);
  });

  test('detects contiguous row crops from date-column ink projection before OCR', () => {
    const projection = Array.from({ length: 120 }, () => 0.002);
    for (const center of [10, 30, 50, 70, 90, 110]) {
      for (let offset = -2; offset <= 2; offset++) projection[center + offset] = 0.08 - Math.abs(offset) * 0.01;
    }

    const rows = detectPowerScribeRowBandsFromProjection(projection, { top: 0.2, bottom: 0.8 });

    expect(rows).toHaveLength(6);
    expect(rows[0].top).toBeGreaterThanOrEqual(0.2);
    expect(rows.at(-1)!.bottom).toBeLessThanOrEqual(0.8);
    for (let index = 1; index < rows.length; index++) {
      expect(rows[index - 1].bottom).toBeCloseTo(rows[index].top);
    }
  });

  test('normalizes edited row boundaries into ordered non-overlapping bands', () => {
    const rows = normalizePowerScribeRowBands([
      { top: 0.50, bottom: 0.70 },
      { top: 0.20, bottom: 0.49 },
      { top: 0.69, bottom: 0.90 },
    ], { top: 0.1, bottom: 0.95 });

    expect(rows).toHaveLength(3);
    expect(rows[0].top).toBe(0.2);
    expect(rows[0].bottom).toBeCloseTo(rows[1].top);
    expect(rows[1].bottom).toBeCloseTo(rows[2].top);
  });

  test('fails closed for a wrong-window capture with no PowerScribe signal', () => {
    expect(selectPowerScribeCropTier({
      manual: false,
      headerAnchors: false,
      datetimeColumns: false,
      pixelValley: true,
      savedCrop: true,
      hasPowerScribeSignal: false,
    })).toBeNull();
  });
});
