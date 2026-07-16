import { PSM } from 'tesseract.js';
import type { PowerScribeColumnName } from './imageCrop';
import type { OcrEngineParams } from './ocrProvider';

export type PowerScribeRecognitionLayout = 'stacked-columns' | 'individual-cells';
export type PowerScribeWhitelistMode = 'field-specific' | 'disabled';

export interface PowerScribeOcrEngineConfig {
  id: string;
  recognitionLayout: PowerScribeRecognitionLayout;
  pageSegMode: PSM;
  whitelistMode: PowerScribeWhitelistMode;
  preserveInterwordSpaces: boolean;
  dictionaryCorrection: boolean;
  userDefinedDpi: number;
  workerStrategy: 'persistent-sequential';
}

export const POWERSCRIBE_FIELD_WHITELISTS: Readonly<Record<PowerScribeColumnName, string>> = Object.freeze({
  procedure: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 /+&()-.…',
  examDate: '0123456789/: APM',
  modifiedDate: '0123456789/: APM',
});

export const POWERSCRIBE_PRODUCTION_OCR_CONFIGURATION: Readonly<PowerScribeOcrEngineConfig> = Object.freeze({
  id: 'stacked-single-block-field-dpi300-no-dict-v1',
  recognitionLayout: 'stacked-columns',
  pageSegMode: PSM.SINGLE_BLOCK,
  whitelistMode: 'field-specific',
  preserveInterwordSpaces: true,
  dictionaryCorrection: false,
  userDefinedDpi: 300,
  workerStrategy: 'persistent-sequential',
});

const individualBaseline = {
  recognitionLayout: 'individual-cells' as const,
  pageSegMode: PSM.SINGLE_LINE,
  whitelistMode: 'field-specific' as const,
  preserveInterwordSpaces: true,
  dictionaryCorrection: false,
  userDefinedDpi: 300,
  workerStrategy: 'persistent-sequential' as const,
};

/** Stage-one engine comparisons. Later stages vary one image treatment at a time. */
export const POWERSCRIBE_OCR_ENGINE_BASELINE_VARIANTS: ReadonlyArray<Readonly<PowerScribeOcrEngineConfig>> = [
  POWERSCRIBE_PRODUCTION_OCR_CONFIGURATION,
  { ...individualBaseline, id: 'cell-single-line-field-dpi300-no-dict' },
  { ...individualBaseline, id: 'cell-single-word-field-dpi300-no-dict', pageSegMode: PSM.SINGLE_WORD },
  { ...individualBaseline, id: 'cell-single-line-no-whitelist-dpi300-no-dict', whitelistMode: 'disabled' },
  { ...individualBaseline, id: 'cell-single-line-field-dpi300-dict', dictionaryCorrection: true },
  { ...individualBaseline, id: 'cell-single-line-field-dpi200-no-dict', userDefinedDpi: 200 },
  { ...individualBaseline, id: 'cell-single-line-field-dpi400-no-dict', userDefinedDpi: 400 },
];

export function powerScribeOcrParamsForColumn(
  column: PowerScribeColumnName,
  configuration: PowerScribeOcrEngineConfig = POWERSCRIBE_PRODUCTION_OCR_CONFIGURATION,
): OcrEngineParams {
  return {
    pageSegMode: configuration.pageSegMode,
    charWhitelist: configuration.whitelistMode === 'field-specific'
      ? POWERSCRIBE_FIELD_WHITELISTS[column]
      : '',
    preserveInterwordSpaces: configuration.preserveInterwordSpaces,
    dictionaryCorrection: configuration.dictionaryCorrection,
    userDefinedDpi: configuration.userDefinedDpi,
  };
}
