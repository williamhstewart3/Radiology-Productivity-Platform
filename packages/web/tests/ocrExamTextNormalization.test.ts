import { describe, expect, test } from 'bun:test';
import { normalizeForRadiology } from '../src/web/utils/examNormalizer';
import { normalizeOcrExamTextForMatching } from '../src/web/utils/ocrExamTextNormalization';
import { getCommonRadiologyMappingCodes, normalizeRadiologyDescription } from '../src/web/utils/radiologyDescriptionNormalization';

describe('OCR exam text normalization', () => {
  test.each([
    ['v 8 CTCHEST ABDOMEN PELVIS W CONTRAST', 'CT CHEST ABDOMEN PELVIS W CONTRAST'],
    ['CTCHEST ABDOMEN PELVIS W CONTRAST', 'CT CHEST ABDOMEN PELVIS W CONTRAST'],
    ['CT CHEST ABD PEL W', 'CT CHEST ABDOMEN PELVIS W'],
    ['CT ABDOMEN PELVIS W CONTRAST', 'CT ABDOMEN PELVIS W CONTRAST'],
    ['CTA CHEST PE', 'CTA CHEST PE'],
    ['MRIBRAIN W/ CONTRAST', 'MRI BRAIN W CONTRAST'],
    ['USBREAST COMPLETE', 'US BREAST COMPLETE'],
    ['LE VENOUS LOWER EXTREMITY BILATERAL', 'US LE VENOUS LOWER EXTREMITY BILATERAL'],
    ['XR WRIST RIGHT PA LATERAL AND OBLIGUE', 'XR WRIST RIGHT PA LATERAL AND OBLIQUE'],
    ['CT ABDCOMEN PELVS WCONTRAST', 'CT ABDOMEN PELVIS W CONTRAST'],
    ['XR CHEST PORTBLE', 'XR CHEST PORTABLE'],
    ['CT HEAD WO CONTRST', 'CT HEAD WO CONTRAST'],
    ['XRCHESTFORTABLE', 'XR CHEST PORTABLE'],
    ['XRCHESTPORTABLE', 'XR CHEST PORTABLE'],
    ['XR CHEST FORTABLE', 'XR CHEST PORTABLE'],
    ['XR CHEST PORTBLE', 'XR CHEST PORTABLE'],
    ['XR CHESTPORTABLE', 'XR CHEST PORTABLE'],
    ['XRCHEST PORTABLE', 'XR CHEST PORTABLE'],
    ['XR CHEST-PORTABLE', 'XR CHEST PORTABLE'],
    ['XR ABDOMEN AP A2026 AT AM', 'XR ABDOMEN AP'],
    ['XR WRIST RIGHT PA LATERAL AND OBLIGUE T2026 212026', 'XR WRIST RIGHT PA LATERAL AND OBLIQUE'],
    ['CT HEAD WO CONTRAST T212026', 'CT HEAD WO CONTRAST'],
    ['XR ABDOMEN AP 1112026', 'XR ABDOMEN AP'],
    ['XR CHEST PORTABLE 819AM', 'XR CHEST PORTABLE'],
  ])('%s', (raw, expected) => {
    expect(normalizeOcrExamTextForMatching(raw)).toBe(expected);
  });

  test('maps clear CT chest abdomen pelvis with contrast to split CPTs', () => {
    expect(getCommonRadiologyMappingCodes('v 8 CTCHEST ABDOMEN PELVIS W CONTRAST')).toEqual(['71260', '74177']);
  });

  test('normalizes contrast and abdomen/pelvis variants consistently', () => {
    const variants = [
      'CTCHEST ABDOMEN PELVIS W CONTRAST',
      'CT CHEST ABD PEL W',
      'CT CHEST ABD PELVIS WITH CONTRAST',
      'CT CHEST ABDOMEN PELVIS W DYE',
    ].map(normalizeRadiologyDescription);

    expect(new Set(variants).size).toBe(1);
  });

  test('keeps modality, body region, and contrast hints for scoring', () => {
    const normalized = normalizeForRadiology('v 8 CTCHEST ABDOMEN PELVIS W CONTRAST');
    expect(normalized.modality).toBe('CT');
    expect(normalized.contrastStatus).toBe('with');
    expect(normalized.bodyParts).toContain('chest');
    expect(normalized.bodyParts).toContain('abdomen');
    expect(normalized.bodyParts).toContain('pelvis');
  });
});
