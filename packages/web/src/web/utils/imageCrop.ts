export interface RelativeCropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const DEFAULT_POWERSCRIBE_STUDY_LIST_CROP: RelativeCropRect = {
  x: 0.18,
  y: 0.17,
  width: 0.76,
  height: 0.66,
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function normalizeCrop(rect: RelativeCropRect): RelativeCropRect {
  const x = clamp01(rect.x);
  const y = clamp01(rect.y);
  const width = Math.max(0.05, Math.min(1 - x, clamp01(rect.width)));
  const height = Math.max(0.05, Math.min(1 - y, clamp01(rect.height)));
  return { x, y, width, height };
}

export async function cropImageBlob(
  image: File | Blob,
  cropRect: RelativeCropRect,
  outputType = 'image/png',
): Promise<Blob> {
  const bitmap = await createImageBitmap(image);
  try {
    const rect = normalizeCrop(cropRect);
    const sx = Math.round(rect.x * bitmap.width);
    const sy = Math.round(rect.y * bitmap.height);
    const sw = Math.max(1, Math.round(rect.width * bitmap.width));
    const sh = Math.max(1, Math.round(rect.height * bitmap.height));

    const canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is not available for OCR crop');
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Canvas crop export failed'));
      }, outputType);
    });
  } finally {
    bitmap.close();
  }
}
