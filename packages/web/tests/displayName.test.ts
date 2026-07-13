import { describe, expect, test } from 'bun:test';
import { cleanFallbackName, looksLikeArtifact, resolveCaptureName, resolveDisplayName } from '../src/web/utils/displayName';

const FILTHY_LINES = [
  'TEND Adult J mi 568 Abdomen APPENDIX Acul ff mA- 370 CT OUTSIDE FILMS mA 507 Abdomen APPEND -None Fact-0 Jf Slice-6.00 L',
  'calcium 75571',
];

describe('looksLikeArtifact', () => {
  test('flags known technique/artifact tokens', () => {
    expect(looksLikeArtifact('mA- 370 CT scan')).toBe(true);
    expect(looksLikeArtifact('Slice-6.00 protocol')).toBe(true);
    expect(looksLikeArtifact('Fact-0 something')).toBe(true);
    expect(looksLikeArtifact('rotated with Tilt correction')).toBe(true);
    expect(looksLikeArtifact('kV-120 exposure')).toBe(true);
  });

  test('flags 3+ standalone numeric tokens as noise', () => {
    expect(looksLikeArtifact('568 Abdomen 370 CT 507')).toBe(true);
  });

  test('flags a bare 4+ digit run (accession/ID leftover) even in an otherwise short line', () => {
    expect(looksLikeArtifact('calcium 75571')).toBe(true);
  });

  test('does not flag a normal clean exam name', () => {
    expect(looksLikeArtifact('CT Abdomen Pelvis with Contrast')).toBe(false);
    expect(looksLikeArtifact('XR Chest 2 View')).toBe(false);
  });

  test('flags empty/whitespace-only text', () => {
    expect(looksLikeArtifact('')).toBe(true);
    expect(looksLikeArtifact('   ')).toBe(true);
  });
});

describe('cleanFallbackName', () => {
  test('strips technique/artifact tokens and title-cases the remainder', () => {
    const cleaned = cleanFallbackName('calcium 75571');
    expect(cleaned).not.toMatch(/\d{2,}/);
    expect(cleaned).toBe('Calcium');
  });

  test('the filthy fixture lines never produce output matching artifact patterns', () => {
    for (const line of FILTHY_LINES) {
      const cleaned = cleanFallbackName(line);
      expect(cleaned).not.toMatch(/\bmA-/i);
      expect(cleaned).not.toMatch(/\bSlice-/i);
      expect(cleaned).not.toMatch(/\bFact-/i);
      const numericTokens = cleaned.match(/\b\d{2,}\b/g) ?? [];
      expect(numericTokens.length).toBeLessThan(3);
    }
  });

  test('truncates to ~60 chars with an ellipsis', () => {
    const longName = 'Abdomen Pelvis Chest Extremity Spine Brain Sinus Orbit Neck Shoulder';
    const cleaned = cleanFallbackName(longName);
    expect(cleaned.length).toBeLessThanOrEqual(60);
    expect(cleaned.endsWith('…')).toBe(true);
  });

  test('preserves short acronyms instead of lowercasing them', () => {
    expect(cleanFallbackName('ct abdomen pelvis')).toBe('Ct Abdomen Pelvis');
    expect(cleanFallbackName('CT ABDOMEN PELVIS')).toBe('CT Abdomen Pelvis');
  });

  test('falls back to a placeholder when nothing survives cleaning', () => {
    expect(cleanFallbackName('mA-370 Slice-6.00 Fact-0')).toBe('Unnamed study');
  });
});

describe('resolveDisplayName', () => {
  test('prefers cmsDescription (the matched CPT-table name) over everything else', () => {
    const resolved = resolveDisplayName({
      cmsDescription: 'CT Abdomen and Pelvis with Contrast',
      examTitleDisplay: 'garbage mA- 370 Slice-6.00',
      examNameRaw: 'garbage mA- 370 Slice-6.00',
    });
    expect(resolved).toEqual({ name: 'CT Abdomen and Pelvis with Contrast', isFallback: false });
  });

  test('uses examTitleDisplay when it does not look like artifact noise (a user rename)', () => {
    const resolved = resolveDisplayName({
      cmsDescription: null,
      examTitleDisplay: 'Trauma Protocol CT Abd/Pelvis',
      examNameRaw: 'raw ocr garbage',
    });
    expect(resolved).toEqual({ name: 'Trauma Protocol CT Abd/Pelvis', isFallback: false });
  });

  test('falls back to a cleaned name, flagged, when examTitleDisplay itself is artifact noise', () => {
    const resolved = resolveDisplayName({
      cmsDescription: null,
      examTitleDisplay: FILTHY_LINES[0],
      examNameRaw: FILTHY_LINES[0],
    });
    expect(resolved.isFallback).toBe(true);
    expect(resolved.name).not.toMatch(/\bmA-/i);
  });

  test('falls back to examNameRaw when examTitleDisplay is missing entirely', () => {
    const resolved = resolveDisplayName({
      cmsDescription: null,
      examTitleDisplay: null,
      examNameRaw: 'calcium 75571',
    });
    expect(resolved).toEqual({ name: 'Calcium', isFallback: true });
  });

  test('the full filthy fixture set never resolves to a name matching artifact patterns', () => {
    for (const line of FILTHY_LINES) {
      const resolved = resolveDisplayName({ cmsDescription: null, examTitleDisplay: null, examNameRaw: line });
      expect(resolved.name).not.toMatch(/\bmA-/i);
      expect(resolved.name).not.toMatch(/\bSlice-/i);
      expect(resolved.name).not.toMatch(/\bFact-/i);
    }
  });

  test('the filthy fixture set is cleaned even when examTitleDisplay echoes the raw line (the real commitPipelineResults shape, where examTitleDisplay falls through to the raw procedure text when nothing cleaner was extracted)', () => {
    for (const line of FILTHY_LINES) {
      const resolved = resolveDisplayName({ cmsDescription: null, examTitleDisplay: line, examNameRaw: line });
      expect(resolved.isFallback).toBe(true);
      expect(resolved.name).not.toBe(line);
      const numericTokens = resolved.name.match(/\b\d{2,}\b/g) ?? [];
      expect(numericTokens.length).toBe(0);
    }
  });
});

describe('resolveCaptureName', () => {
  test('prefers the matched candidate description', () => {
    expect(resolveCaptureName('CT Abdomen and Pelvis with Contrast', 'raw garbage')).toEqual({
      name: 'CT Abdomen and Pelvis with Contrast',
      isFallback: false,
    });
  });

  test('cleans the raw text when there is no candidate description yet', () => {
    const resolved = resolveCaptureName(null, 'calcium 75571');
    expect(resolved).toEqual({ name: 'Calcium', isFallback: true });
  });
});
