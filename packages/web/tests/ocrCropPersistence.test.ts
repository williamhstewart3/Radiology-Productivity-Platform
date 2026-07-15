import { describe, expect, test } from 'bun:test';
import { getSavedPowerScribeManualGuides, isSavedPowerScribeCropCompatible } from '../src/web/services/ocrWorkflowService';

describe('saved PowerScribe crop compatibility', () => {
  const crop = { x: 0.2, y: 0.2, width: 0.7, height: 0.7, imageWidth: 1920, imageHeight: 1080 };

  test('reuses a crop only at the resolution where anchors succeeded', () => {
    expect(isSavedPowerScribeCropCompatible(crop, 1920, 1080)).toBe(true);
  });

  test('invalidates the crop after a monitor or resolution change', () => {
    expect(isSavedPowerScribeCropCompatible(crop, 2560, 1440)).toBe(false);
    expect(isSavedPowerScribeCropCompatible({ ...crop, imageWidth: undefined }, 1920, 1080)).toBe(false);
  });

  test('restores saved manual column guides only at the matching resolution', () => {
    const manualColumnGuides = {
      left: 0.18,
      procedureEnd: 0.55,
      examEnd: 0.76,
      right: 0.96,
      top: 0.12,
      bottom: 0.94,
    };
    const saved = { ...crop, manualColumnGuides };

    expect(getSavedPowerScribeManualGuides(saved, 1920, 1080)).toEqual(manualColumnGuides);
    expect(getSavedPowerScribeManualGuides(saved, 2560, 1440)).toBeNull();
  });

  test('rejects malformed saved manual guides', () => {
    const saved = {
      ...crop,
      manualColumnGuides: {
        left: 0.2,
        procedureEnd: 0.7,
        examEnd: 0.6,
        right: 0.95,
        top: 0.1,
        bottom: 0.9,
      },
    };

    expect(getSavedPowerScribeManualGuides(saved, 1920, 1080)).toBeNull();
  });
});
