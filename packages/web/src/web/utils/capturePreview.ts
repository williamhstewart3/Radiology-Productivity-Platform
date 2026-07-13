/**
 * capturePreview.ts
 *
 * Cheap, in-memory sanity check for the P5 capture preview stage: image
 * dimensions plus a "does this look like a PowerScribe window" hint reusing
 * the existing header-anchored crop detector (Tier 1 of
 * preprocessPowerScribeColumnsForOcr) as a pre-check. No OCR runs here --
 * this is pixel/geometry analysis only, so it's safe to run on every pasted
 * or dropped image before the radiologist has decided whether to process it.
 */

import { detectPowerScribeStudyListCrop } from './imageCrop';

export interface CapturePreviewInfo {
  width: number;
  height: number;
  looksLikePowerScribe: boolean;
}

/** Matches the confidence floor detectPowerScribeStudyListCrop itself uses to fall back to a default crop. */
export const POWERSCRIBE_ANCHOR_CONFIDENCE_FLOOR = 0.35;

export function isLikelyPowerScribeWindow(crop: { method: 'detected' | 'fallback'; confidence: number }): boolean {
  return crop.method === 'detected' && crop.confidence >= POWERSCRIBE_ANCHOR_CONFIDENCE_FLOOR;
}

export async function analyzeCapturePreview(file: File | Blob): Promise<CapturePreviewInfo> {
  const bitmap = await createImageBitmap(file);
  const width = bitmap.width;
  const height = bitmap.height;
  bitmap.close();
  const crop = await detectPowerScribeStudyListCrop(file);
  return { width, height, looksLikePowerScribe: isLikelyPowerScribeWindow(crop) };
}
