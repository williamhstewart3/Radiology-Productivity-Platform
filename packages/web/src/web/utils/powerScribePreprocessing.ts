export type PowerScribeThresholdMode = 'none' | 'global' | 'adaptive';
export type PowerScribeContrastMode = 'none' | 'linear' | 'stretch' | 'local';
export type PowerScribeGrayscaleMethod = 'original-rgb' | 'luminance' | 'green-channel' | 'minimum-channel';

export interface PowerScribePreprocessConfig {
  id: string;
  scaleFactor: number | 'auto';
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: ImageSmoothingQuality;
  grayscaleMethod: PowerScribeGrayscaleMethod;
  contrastMode: PowerScribeContrastMode;
  contrast: number;
  thresholdMode: PowerScribeThresholdMode;
  thresholdValue: number;
  adaptiveRadius: number;
  adaptiveBias: number;
  denoiseStrength: number;
  sharpeningStrength: number;
  cellPaddingPx: number;
}

export interface PowerScribeRgbaImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * This intentionally matches the previously shipped adaptive-threshold path
 * while centralizing every value. Benchmark-only treatments must not become
 * production defaults until verified PowerScribe fixtures show a gain.
 */
export const POWERSCRIBE_PRODUCTION_PREPROCESSING: Readonly<PowerScribePreprocessConfig> = Object.freeze({
  id: 'adaptive-balanced-v1',
  scaleFactor: 'auto',
  imageSmoothingEnabled: false,
  imageSmoothingQuality: 'high',
  grayscaleMethod: 'luminance',
  contrastMode: 'linear',
  contrast: 1.55,
  thresholdMode: 'adaptive',
  thresholdValue: 176,
  adaptiveRadius: 14,
  adaptiveBias: 7,
  denoiseStrength: 0,
  sharpeningStrength: 0,
  cellPaddingPx: 0,
});

const benchmarkBase = {
  imageSmoothingEnabled: true,
  imageSmoothingQuality: 'high' as const,
  grayscaleMethod: 'luminance' as const,
  contrastMode: 'none' as const,
  contrast: 1,
  thresholdMode: 'none' as const,
  thresholdValue: 176,
  adaptiveRadius: 14,
  adaptiveBias: 7,
  denoiseStrength: 0,
  sharpeningStrength: 0,
  cellPaddingPx: 1,
};

/** Meaningful single-variable comparisons; not a combinatorial explosion. */
export const POWERSCRIBE_PREPROCESSING_BENCHMARK_VARIANTS: ReadonlyArray<Readonly<PowerScribePreprocessConfig>> = [
  { ...benchmarkBase, id: 'gray-1x', scaleFactor: 1 },
  { ...benchmarkBase, id: 'gray-2x', scaleFactor: 2 },
  { ...benchmarkBase, id: 'gray-3x', scaleFactor: 3 },
  { ...benchmarkBase, id: 'gray-4x', scaleFactor: 4 },
  { ...benchmarkBase, id: 'rgb-3x', scaleFactor: 3, grayscaleMethod: 'original-rgb' },
  { ...benchmarkBase, id: 'green-channel-3x', scaleFactor: 3, grayscaleMethod: 'green-channel' },
  { ...benchmarkBase, id: 'minimum-channel-3x', scaleFactor: 3, grayscaleMethod: 'minimum-channel' },
  { ...benchmarkBase, id: 'stretch-3x', scaleFactor: 3, contrastMode: 'stretch', contrast: 1 },
  { ...benchmarkBase, id: 'local-contrast-3x', scaleFactor: 3, contrastMode: 'local', contrast: 0.35 },
  { ...benchmarkBase, id: 'global-160-3x', scaleFactor: 3, thresholdMode: 'global', thresholdValue: 160 },
  { ...benchmarkBase, id: 'global-176-3x', scaleFactor: 3, thresholdMode: 'global', thresholdValue: 176 },
  { ...benchmarkBase, id: 'global-192-3x', scaleFactor: 3, thresholdMode: 'global', thresholdValue: 192 },
  { ...benchmarkBase, id: 'adaptive-2x', scaleFactor: 2, contrastMode: 'linear', contrast: 1.55, thresholdMode: 'adaptive' },
  { ...benchmarkBase, id: 'adaptive-3x', scaleFactor: 3, contrastMode: 'linear', contrast: 1.55, thresholdMode: 'adaptive' },
  { ...benchmarkBase, id: 'adaptive-4x', scaleFactor: 4, contrastMode: 'linear', contrast: 1.55, thresholdMode: 'adaptive' },
  { ...benchmarkBase, id: 'adaptive-denoise-3x', scaleFactor: 3, contrastMode: 'linear', contrast: 1.55, thresholdMode: 'adaptive', denoiseStrength: 0.18 },
  { ...benchmarkBase, id: 'adaptive-sharpen-mild-3x', scaleFactor: 3, contrastMode: 'linear', contrast: 1.55, thresholdMode: 'adaptive', sharpeningStrength: 0.25 },
  { ...benchmarkBase, id: 'adaptive-sharpen-moderate-3x', scaleFactor: 3, contrastMode: 'linear', contrast: 1.55, thresholdMode: 'adaptive', sharpeningStrength: 0.5 },
];

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function grayscale(input: PowerScribeRgbaImage, method: Exclude<PowerScribeGrayscaleMethod, 'original-rgb'>): Uint8ClampedArray {
  const gray = new Uint8ClampedArray(input.width * input.height);
  for (let pixel = 0; pixel < gray.length; pixel++) {
    const offset = pixel * 4;
    const red = input.data[offset];
    const green = input.data[offset + 1];
    const blue = input.data[offset + 2];
    gray[pixel] = method === 'green-channel'
      ? green
      : method === 'minimum-channel'
        ? Math.min(red, green, blue)
        : clampByte(red * 0.299 + green * 0.587 + blue * 0.114);
  }
  return gray;
}

function linearContrast(gray: Uint8ClampedArray, amount: number): Uint8ClampedArray {
  if (amount === 1) return gray;
  return Uint8ClampedArray.from(gray, (value) => clampByte((value - 128) * amount + 128));
}

function stretchContrast(gray: Uint8ClampedArray): Uint8ClampedArray {
  if (gray.length === 0) return gray;
  const histogram = new Uint32Array(256);
  for (const value of gray) histogram[value]++;
  const tail = Math.max(1, Math.floor(gray.length * 0.01));
  let low = 0;
  let high = 255;
  let seen = 0;
  for (; low < 255; low++) {
    seen += histogram[low];
    if (seen >= tail) break;
  }
  seen = 0;
  for (; high > 0; high--) {
    seen += histogram[high];
    if (seen >= tail) break;
  }
  if (high - low < 24) return gray;
  const scale = 255 / (high - low);
  return Uint8ClampedArray.from(gray, (value) => clampByte((value - low) * scale));
}

function boxBlur(gray: Uint8ClampedArray, width: number, height: number, radius: number): Uint8ClampedArray {
  if (radius <= 0 || width === 0 || height === 0) return gray;
  const integral = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    for (let x = 0; x < width; x++) {
      rowSum += gray[y * width + x];
      integral[(y + 1) * (width + 1) + x + 1] = integral[y * (width + 1) + x + 1] + rowSum;
    }
  }
  const output = new Uint8ClampedArray(gray.length);
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width - 1, x + radius);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sum =
        integral[(y1 + 1) * (width + 1) + x1 + 1] -
        integral[y0 * (width + 1) + x1 + 1] -
        integral[(y1 + 1) * (width + 1) + x0] +
        integral[y0 * (width + 1) + x0];
      output[y * width + x] = clampByte(sum / area);
    }
  }
  return output;
}

function localContrast(gray: Uint8ClampedArray, width: number, height: number, amount: number): Uint8ClampedArray {
  if (amount <= 0) return gray;
  const localMean = boxBlur(gray, width, height, 8);
  return Uint8ClampedArray.from(gray, (value, index) => clampByte(value + amount * (value - localMean[index])));
}

function median3x3(gray: Uint8ClampedArray, width: number, height: number, strength: number): Uint8ClampedArray {
  const blend = clampUnit(strength);
  if (blend === 0 || width < 3 || height < 3) return gray;
  const output = new Uint8ClampedArray(gray);
  const values = new Array<number>(9);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let index = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) values[index++] = gray[(y + dy) * width + x + dx];
      }
      values.sort((a, b) => a - b);
      const position = y * width + x;
      output[position] = clampByte(gray[position] * (1 - blend) + values[4] * blend);
    }
  }
  return output;
}

function unsharpMask(gray: Uint8ClampedArray, width: number, height: number, strength: number): Uint8ClampedArray {
  const amount = Math.max(0, strength);
  if (amount === 0) return gray;
  const blurred = boxBlur(gray, width, height, 1);
  return Uint8ClampedArray.from(gray, (value, index) => clampByte(value + amount * (value - blurred[index])));
}

function globalThreshold(gray: Uint8ClampedArray, threshold: number): Uint8ClampedArray {
  return Uint8ClampedArray.from(gray, (value) => value < threshold ? 0 : 255);
}

function adaptiveThreshold(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
  bias: number,
): Uint8ClampedArray {
  const localMean = boxBlur(gray, width, height, Math.max(1, Math.round(radius)));
  return Uint8ClampedArray.from(gray, (value, index) => value < localMean[index] - bias ? 0 : 255);
}

export function preprocessPowerScribeRgba(
  input: PowerScribeRgbaImage,
  config: PowerScribePreprocessConfig,
): PowerScribeRgbaImage {
  const preservesOriginalRgb = config.grayscaleMethod === 'original-rgb' &&
    config.contrastMode === 'none' &&
    config.thresholdMode === 'none' &&
    config.denoiseStrength === 0 &&
    config.sharpeningStrength === 0;
  if (preservesOriginalRgb) {
    return { data: new Uint8ClampedArray(input.data), width: input.width, height: input.height };
  }
  let gray = grayscale(
    input,
    config.grayscaleMethod === 'original-rgb' ? 'luminance' : config.grayscaleMethod,
  );
  if (config.contrastMode === 'linear') gray = linearContrast(gray, config.contrast);
  if (config.contrastMode === 'stretch') gray = stretchContrast(gray);
  if (config.contrastMode === 'local') gray = localContrast(gray, input.width, input.height, config.contrast);
  gray = median3x3(gray, input.width, input.height, config.denoiseStrength);
  gray = unsharpMask(gray, input.width, input.height, config.sharpeningStrength);
  if (config.thresholdMode === 'global') gray = globalThreshold(gray, config.thresholdValue);
  if (config.thresholdMode === 'adaptive') {
    gray = adaptiveThreshold(gray, input.width, input.height, config.adaptiveRadius, config.adaptiveBias);
  }

  const data = new Uint8ClampedArray(input.width * input.height * 4);
  for (let pixel = 0; pixel < gray.length; pixel++) {
    const offset = pixel * 4;
    data[offset] = gray[pixel];
    data[offset + 1] = gray[pixel];
    data[offset + 2] = gray[pixel];
    data[offset + 3] = 255;
  }
  return { data, width: input.width, height: input.height };
}

export function resolvePowerScribePreprocessScale(
  config: PowerScribePreprocessConfig,
  detectedBandPitch: number | null,
): number {
  if (config.scaleFactor !== 'auto') return Math.max(1, Math.min(4, config.scaleFactor));
  return detectedBandPitch == null
    ? 3
    : Math.max(1.5, Math.min(4, 36 / Math.max(9, detectedBandPitch * 0.55)));
}
