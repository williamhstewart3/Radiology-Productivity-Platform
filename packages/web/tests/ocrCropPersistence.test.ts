import { describe, expect, test } from 'bun:test';
import { isSavedPowerScribeCropCompatible } from '../src/web/services/ocrWorkflowService';

describe('saved PowerScribe crop compatibility', () => {
  const crop = { x: 0.2, y: 0.2, width: 0.7, height: 0.7, imageWidth: 1920, imageHeight: 1080 };

  test('reuses a crop only at the resolution where anchors succeeded', () => {
    expect(isSavedPowerScribeCropCompatible(crop, 1920, 1080)).toBe(true);
  });

  test('invalidates the crop after a monitor or resolution change', () => {
    expect(isSavedPowerScribeCropCompatible(crop, 2560, 1440)).toBe(false);
    expect(isSavedPowerScribeCropCompatible({ ...crop, imageWidth: undefined }, 1920, 1080)).toBe(false);
  });
});
