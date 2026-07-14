import { describe, expect, test } from 'bun:test';
import type { CptRvuRow, ExamDictionaryEntry, Modality } from '../src/web/types';
import type { ImportedStudy } from '../src/web/types/importProvider';
import { __testInstitutionMappingReviewReason, __testProcedureNameFor } from '../src/web/pipeline/importPipeline';
import {
  __testAutoMatchRowsFor,
  __testDeterministicCptCodesFor,
  __testHasClinicallyMeaningfulInstitutionDifference,
  __testParseModalityFirst,
  __testShouldSuppressMergedProcedureMatching,
  resolveInstitutionProcedure,
} from '../src/web/utils/matching';

function cptRow(cptCode: string, description: string, modality: Modality, includeInAutoMatch = true): CptRvuRow {
  return {
    id: `test_${cptCode}_${description}`,
    cptCode,
    modifier: '26',
    description,
    workRvu: 1,
    nonFacilityPeRvu: null,
    facilityPeRvu: null,
    malpracticeRvu: null,
    totalRvuNonFacility: null,
    totalRvuFacility: null,
    statusCode: 'A',
    statusCategory: 'active',
    globalDays: null,
    pcTcIndicator: 'professional',
    modality,
    rvuFileVersion: 'TEST',
    effectiveDate: '2026-01-01',
    includeInAutoMatch,
    autoMatchSource: includeInAutoMatch ? 'test active set' : null,
    isUserVerified: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function institutionEntry(procedureType: string, cptCodes: string[], modality: Modality = 'XR'): ExamDictionaryEntry {
  return {
    id: `institution_${procedureType.replace(/\W+/g, '_').toLowerCase()}`,
    canonicalDisplayName: procedureType,
    normalizedKey: procedureType,
    commonSynonyms: [procedureType],
    hospitalAliases: [procedureType],
    powerScribeNames: [procedureType],
    cmsDescription: null,
    cptCodes,
    modifier26Wrvu: null,
    modality,
    bodyRegion: null,
    typicalCombinations: [],
    timesUsed: 0,
    source: 'institution',
    institutionSheet: modality === 'MRI' ? 'MR' : modality,
    institutionProcedureName: procedureType,
    sourceFileName: 'CPT Codes for Procedures.xlsx',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('modality-first CPT matching', () => {
  test('strips junk before the first modality token', () => {
    expect(__testParseModalityFirst('$ 15 XR CHEST PORTABLE F/212026 2026').cleanedProcedure)
      .toBe('XR CHEST PORTABLE');
    expect(__testParseModalityFirst('$9 26 CTANGIOGRAM HEAD NECK W WO CONTRAST').cleanedProcedure)
      .toBe('CT ANGIOGRAM HEAD NECK W WO CONTRAST');
    expect(__testParseModalityFirst('v10 CTCHEST WCONTRAST').cleanedProcedure)
      .toBe('CT CHEST W CONTRAST');
    expect(__testParseModalityFirst('ARUREST FURTABLE ... $12 XRWRIST RIGHT PA LATERAL AND OBLIQUE').cleanedProcedure)
      .toBe('XR WRIST RIGHT 3 VIEWS');
  });

  test('keeps anatomy and protocol words that legitimately precede the modality token', () => {
    expect(__testParseModalityFirst('CAROTID DUPLEX US BILATERAL')).toMatchObject({
      lane: 'US',
      cleanedProcedure: 'CAROTID DUPLEX US BILATERAL',
    });
    expect(__testParseModalityFirst('OB US LIMITED')).toMatchObject({
      lane: 'US',
      cleanedProcedure: 'OB US LIMITED',
    });
    expect(__testParseModalityFirst('SPECT/CT SINGLE AREA')).toMatchObject({
      lane: 'NM_PET',
      cleanedProcedure: 'SPECT/CT SINGLE AREA',
    });
  });

  test('routes exact and uniquely modality-omitted Orbit titles deterministically', () => {
    expect(__testDeterministicCptCodesFor('CAROTID DUPLEX US BILATERAL')).toEqual(['93880']);
    expect(__testDeterministicCptCodesFor('OB US LIMITED')).toEqual(['76815']);
    expect(__testDeterministicCptCodesFor('ABDOMEN COMPLETE')).toEqual(['76700']);
  });

  test('normalizes XR views and deterministic plain film aliases', () => {
    expect(__testParseModalityFirst('XR CHEST PA AND LATERAL').cleanedProcedure).toBe('XR CHEST 2 VIEWS');
    expect(__testDeterministicCptCodesFor('XR CHEST PORTABLE')).toEqual(['71045']);
    expect(__testDeterministicCptCodesFor('XR CHEST PA AND LATERAL')).toEqual(['71046']);
    expect(__testDeterministicCptCodesFor('XR ABDOMEN AP')).toEqual(['74018']);
    expect(__testDeterministicCptCodesFor('XR WRIST RIGHT PA LATERAL AND OBLIQUE')).toEqual(['73110']);
    expect(__testDeterministicCptCodesFor('XR TIBIA FIBULA LEFT AP AND LATERAL')).toEqual(['73590']);
  });

  test('keeps tibia/fibula out of the heel X-ray lane', () => {
    const rows = [
      cptRow('73590', 'Radiologic examination, tibia and fibula; 2 views', 'XR'),
      cptRow('73650', 'Radiologic examination, calcaneus; minimum 2 views', 'XR'),
    ];

    const candidates = __testAutoMatchRowsFor('XR TIBIA FIBULA LEFT AP AND LATERAL', rows);
    expect(candidates.map((row) => row.cptCode)).toEqual(['73590']);
  });

  test.each([
    'XRCHESTFORTABLE',
    'XRCHESTPORTABLE',
    'XR CHEST FORTABLE',
    'XR CHEST PORTBLE',
    'XR CHESTPORTABLE',
    'XRCHEST PORTABLE',
    'XR CHEST-PORTABLE',
  ])('maps portable chest OCR variant %s to 71045 deterministically', (raw) => {
    const parsed = __testParseModalityFirst(raw);
    expect(parsed.cleanedProcedure).toBe('XR CHEST PORTABLE');
    expect(__testDeterministicCptCodesFor(raw)).toEqual(['71045']);
  });

  test('keeps XR wrist auto-match candidates in the XR/plain-film lane', () => {
    const rows = [
      cptRow('73110', 'X-ray wrist 3+ views', 'XR'),
      cptRow('10005', 'FNA biopsy with ultrasound guidance first lesion', 'PROCEDURE'),
      cptRow('78582', 'Ventilation perfusion lung scan', 'NM_PET'),
      cptRow('70450', 'CT head without contrast', 'CT'),
      cptRow('77012', 'CT guidance biopsy', 'PROCEDURE'),
      cptRow('99999', 'Fake wrist broad CMS row', 'XR', false),
    ];

    const candidates = __testAutoMatchRowsFor('ARUREST FURTABLE ... $12 XRWRIST RIGHT PA LATERAL AND OBLIQUE', rows);
    expect(candidates.map((row) => row.cptCode)).toEqual(['73110']);
  });

  test('keeps XR chest portable on the 71045 golden path', () => {
    const rows = [
      cptRow('71045', 'XR Chest 1 View', 'XR'),
      cptRow('71046', 'XR Chest 2 Views', 'XR'),
      cptRow('71047', 'XR Chest 3 Views', 'XR'),
      cptRow('71048', 'XR Chest 4+ Views', 'XR'),
      cptRow('71101', 'XR Ribs Unilateral with Chest', 'XR'),
      cptRow('71260', 'CT Chest with Contrast', 'CT'),
    ];

    const candidates = __testAutoMatchRowsFor('XRCHESTFORTABLE', rows);
    expect(candidates.map((row) => row.cptCode)).toEqual(['71045']);
  });

  test('suppresses full-string matching for contaminated merged procedure rows', () => {
    expect(__testShouldSuppressMergedProcedureMatching(
      'CTCHESTABDUOMEN PELVIS W CONTRAST v 28 CT CARDIAC SCORING 08',
    )).toBe(true);
  });

  test('keeps CT cardiac scoring out of the cardiac MRI lane', () => {
    const rows = [
      cptRow('75571', 'CT calcium score', 'CT'),
      cptRow('75557', 'Cardiac MRI morphology without contrast', 'MRI'),
    ];

    const candidates = __testAutoMatchRowsFor('CT CARDIAC SCORING', rows);
    expect(candidates.map((row) => row.cptCode)).toEqual(['75571']);
    expect(__testDeterministicCptCodesFor('CT CARDIAC SCORE SPECIAL')).toEqual(['75571']);
  });

  test('maps CT renal stone protocol deterministically', () => {
    expect(__testDeterministicCptCodesFor('CT RENAL STONE PROTOCOL')).toEqual(['74176']);
  });

  test('maps MRI wrist contrast variants and bilateral leg venous ultrasound deterministically', () => {
    expect(__testDeterministicCptCodesFor('MRI WRIST WO CONTRAST')).toEqual(['73221']);
    expect(__testDeterministicCptCodesFor('MRI WRIST W CONTRAST')).toEqual(['73222']);
    expect(__testDeterministicCptCodesFor('MRI WRIST W WO CONTRAST')).toEqual(['73223']);
    expect(__testDeterministicCptCodesFor('US LE VENOUS LOWER EXTREMITY BILATERAL')).toEqual(['93970']);
  });

  test('import pipeline supplies procedureName without exam or read dates', () => {
    const study = {
      source: 'ocr',
      examTitle: 'CT CHEST ABDOMEN PELVIS W CONTRAST 7/2/2026 8:20 AM 7/2/2026 9:24 AM',
      procedureName: 'CT CHEST ABDOMEN PELVIS W CONTRAST',
      cleanedExamName: 'CT CHEST ABDOMEN PELVIS W CONTRAST',
      cleanedText: 'CT CHEST ABDOMEN PELVIS W CONTRAST',
    } as ImportedStudy;

    expect(__testProcedureNameFor(study)).toBe('CT CHEST ABDOMEN PELVIS W CONTRAST');
  });

  test('exact institution multi-CPT mapping is not treated as generic CPT ambiguity', () => {
    const candidates = [
      {
        cptCode: '71275',
        modifier: '26',
        description: 'CTA chest',
        workRvu: 1,
        modality: 'CT' as Modality,
        confidence: 0.985,
        method: 'radiology_match' as const,
        explanation: { rawText: 'CTA CHEST ABDOMEN PELVIS', normalizedText: 'cta chest abdomen pelvis', source: 'Institution procedure dictionary', detail: 'institution exact' },
      },
      {
        cptCode: '74174',
        modifier: '26',
        description: 'CTA abdomen pelvis',
        workRvu: 1,
        modality: 'CT' as Modality,
        confidence: 0.985,
        method: 'radiology_match' as const,
        explanation: { rawText: 'CTA CHEST ABDOMEN PELVIS', normalizedText: 'cta chest abdomen pelvis', source: 'Institution procedure dictionary', detail: 'institution exact' },
      },
    ];

    expect(__testInstitutionMappingReviewReason(candidates)).toBeNull();
  });

  test('near institution matches and extra plausible candidates still require review', () => {
    const nearInstitution = [{
      cptCode: '70450',
      modifier: '26',
      description: 'CT head without contrast',
      workRvu: 1,
      modality: 'CT' as Modality,
      confidence: 0.9,
      method: 'radiology_match' as const,
      explanation: { rawText: 'CT HEAD WO', normalizedText: 'ct head wo', source: 'Institution procedure dictionary', detail: 'near institution' },
    }];
    const exactWithExtra = [
      { ...nearInstitution[0], confidence: 0.985, explanation: { ...nearInstitution[0].explanation, detail: 'institution exact' } },
      {
        cptCode: '70460',
        modifier: '26',
        description: 'CT head with contrast',
        workRvu: 1,
        modality: 'CT' as Modality,
        confidence: 0.8,
        method: 'radiology_match' as const,
        explanation: { rawText: 'CT HEAD WO', normalizedText: 'ct head wo', source: 'ACR-active CMS fuzzy match', detail: 'cms fuzzy' },
      },
    ];

    expect(__testInstitutionMappingReviewReason(nearInstitution)).toBe('Low confidence match');
    expect(__testInstitutionMappingReviewReason(exactWithExtra)).toBe('Multiple possible CPT matches');
  });

  test('institution dictionary OCR corrections allow spelling and spacing repairs', () => {
    expect(__testHasClinicallyMeaningfulInstitutionDifference('XRCHESTPORTABLE', 'XR CHEST PORTABLE')).toBe(false);
    expect(__testHasClinicallyMeaningfulInstitutionDifference('XRCHESTFORTABLE', 'XR CHEST PORTABLE')).toBe(false);
    expect(__testHasClinicallyMeaningfulInstitutionDifference('XR WRIST OBLIGUE', 'XR WRIST OBLIQUE')).toBe(false);
    expect(__testHasClinicallyMeaningfulInstitutionDifference('CT ABDCOMEN WCONTRAST', 'CT ABDOMEN W CONTRAST')).toBe(false);
  });

  test.each([
    'XRCHESTPORFABLE',
    'XRCHESTFORTABLE',
    'XRCHESTPORTABLE',
    'XR CHEST PORTBLE',
    'XR CHESTPORTABLE',
  ])('institution resolver maps %s to XR CHEST PORTABLE', (raw) => {
    const result = resolveInstitutionProcedure(raw, [
      institutionEntry('XR CHEST PORTABLE', ['71045']),
    ]);

    expect(['exact_institution_match', 'ocr_tolerant_institution_match']).toContain(result.matchType);
    expect(result.candidates[0].procedureType).toBe('XR CHEST PORTABLE');
    expect(result.candidates[0].entry.cptCodes).toEqual(['71045']);
  });

  test('institution resolver repairs supported OCR spelling in known procedure titles', () => {
    const result = resolveInstitutionProcedure('XR WRIST RIGHT PA LATERAL AND OBLIGUE', [
      institutionEntry('XR WRIST RIGHT PA LATERAL AND OBLIQUE', ['73110']),
    ]);

    expect(['exact_institution_match', 'ocr_tolerant_institution_match']).toContain(result.matchType);
    expect(result.candidates[0].procedureType).toBe('XR WRIST RIGHT PA LATERAL AND OBLIQUE');
  });

  test('institution resolver treats appendix protocol as known local procedure', () => {
    const entries = [institutionEntry('CT APPENDIX PROTOCOL', ['74177'], 'CT')];

    for (const raw of ['CT APPENDIX PROTOCOL', 'CTAPPENDIXPROTOCOL', 'CT APPENDX PROTOCOL', 'CT APPENDIX PROT0COL', 'CT APPENDIX PROTOCOL 22']) {
      const result = resolveInstitutionProcedure(raw, entries);
      expect(['exact_institution_match', 'ocr_tolerant_institution_match']).toContain(result.matchType);
      expect(result.candidates[0].procedureType).toBe('CT APPENDIX PROTOCOL');
      expect(result.candidates[0].entry.cptCodes).toEqual(['74177']);
    }
  });

  test('ambiguous institution resolver output stays explicit for review', () => {
    const result = resolveInstitutionProcedure('XR WRIST RIGHT PA LATERAL OBLIQUE', [
      institutionEntry('XR WRIST RIGHT PA LATERAL AND OBLIQUE', ['73110']),
      institutionEntry('XR WRIST RIGHT PA LATERAL OBLIQUE WITH SCAPHOID', ['73110']),
    ]);

    expect(result.matchType).toBe('ambiguous_institution_match');
    expect(result.candidates.length).toBeGreaterThan(1);
  });

  test('resolves a unique ellipsis-truncated institutional title as exact', () => {
    const entries = [
      institutionEntry('MAMMO BREAST BIOPSY DEVICE PLACE STEREOTACTIC 1ST LESION', ['19081'], 'MAMMO'),
      institutionEntry('MAMMO DIAGNOSTIC BILATERAL', ['77066'], 'MAMMO'),
    ];
    const result = resolveInstitutionProcedure('MAMMO BREAST BIOPSY DEVICE PLACE STEREOTACTIC 1ST…', entries);

    expect(result.matchType).toBe('exact_institution_match');
    expect(result.candidates[0]?.procedureType).toBe('MAMMO BREAST BIOPSY DEVICE PLACE STEREOTACTIC 1ST LESION');
    expect(result.candidates[0]?.truncatedPrefix).toBe(true);
  });

  test('keeps a shared truncated prefix ambiguous instead of fuzzy guessing', () => {
    const entries = [
      institutionEntry('MAMMO BREAST BIOPSY DEVICE PLACE STEREOTACTIC 1ST LESION', ['19081'], 'MAMMO'),
      institutionEntry('MAMMO BREAST BIOPSY DEVICE PLACE STEREOTACTIC 1ST AND EACH ADDITIONAL LESION', ['19081'], 'MAMMO'),
    ];
    const result = resolveInstitutionProcedure('MAMMO BREAST BIOPSY DEVICE PLACE STEREOTACTIC 1ST…', entries);

    expect(result.matchType).toBe('ambiguous_institution_match');
    expect(result.candidates).toHaveLength(2);
  });

  test('resolves an institutional display name even before it has a CPT mapping', () => {
    const result = resolveInstitutionProcedure('CT ANGIOGRAM CORONARY', [
      institutionEntry('CT ANGIOGRAM CORONARY', [], 'CT'),
    ]);

    expect(result.matchType).toBe('exact_institution_match');
    expect(result.candidates[0]?.procedureType).toBe('CT ANGIOGRAM CORONARY');
    expect(result.candidates[0]?.entry.cptCodes).toEqual([]);
  });

  test('institution dictionary near matches do not cross clinical safety boundaries', () => {
    expect(__testHasClinicallyMeaningfulInstitutionDifference('CT CHEST W CONTRAST', 'CT CHEST WO CONTRAST')).toBe(true);
    expect(__testHasClinicallyMeaningfulInstitutionDifference('CT CHEST WO CONTRAST', 'CT CHEST W CONTRAST')).toBe(true);
    expect(__testHasClinicallyMeaningfulInstitutionDifference('US ABDOMEN LIMITED', 'US ABDOMEN COMPLETE')).toBe(true);
    expect(__testHasClinicallyMeaningfulInstitutionDifference('XR WRIST LEFT 3 VIEWS', 'XR WRIST RIGHT 3 VIEWS')).toBe(true);
    expect(__testHasClinicallyMeaningfulInstitutionDifference('US LEG UNILATERAL', 'US LEG BILATERAL')).toBe(true);
    expect(__testHasClinicallyMeaningfulInstitutionDifference('XR CHEST 1 VIEW', 'XR CHEST 2 VIEWS')).toBe(true);
    expect(__testHasClinicallyMeaningfulInstitutionDifference('CT CHEST', 'CTA CHEST')).toBe(true);
    expect(__testHasClinicallyMeaningfulInstitutionDifference('MRI BRAIN', 'MRA BRAIN')).toBe(true);
    expect(__testHasClinicallyMeaningfulInstitutionDifference('US LEG ARTERIAL', 'US LEG VENOUS')).toBe(true);
    expect(__testHasClinicallyMeaningfulInstitutionDifference('XR CHEST PORTABLE', 'XR CHEST PA AND LATERAL')).toBe(true);
  });

  test('institution resolver does not resolve across hard clinical distinctions', () => {
    const contrast = resolveInstitutionProcedure('CT CHEST W CONTRAST', [
      institutionEntry('CT CHEST WO CONTRAST', ['71250'], 'CT'),
    ]);
    const limited = resolveInstitutionProcedure('US ABDOMEN LIMITED', [
      institutionEntry('US ABDOMEN COMPLETE', ['76700'], 'US'),
    ]);
    const views = resolveInstitutionProcedure('XR CHEST PORTABLE', [
      institutionEntry('XR CHEST PA AND LATERAL', ['71046'], 'XR'),
    ]);

    expect(contrast.matchType).toBe('no_institution_match');
    expect(limited.matchType).toBe('no_institution_match');
    expect(views.matchType).toBe('no_institution_match');
  });
});
