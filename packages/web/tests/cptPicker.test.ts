import { describe, expect, test } from 'bun:test';
import { candidateKey, cptRowToCandidate, professionalCptRows, searchCptRows, searchKnownTitleCandidates } from '../src/web/utils/cptPicker';
import { tokenScore } from '../src/web/pages/CptExplorer';
import type { CptRvuRow, ExamDictionaryEntry } from '../src/web/types';

function row(overrides: Partial<CptRvuRow>): CptRvuRow {
  return {
    id: overrides.cptCode ?? 'row',
    cptCode: '00000',
    modifier: '26',
    description: 'Test procedure',
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
    modality: 'CT',
    rvuFileVersion: '2026',
    effectiveDate: '2026-01-01',
    isUserVerified: false,
    ...overrides,
  } as CptRvuRow;
}

describe('professionalCptRows', () => {
  test('drops technical and zero/undefined-wRVU rows', () => {
    const rows = [
      row({ cptCode: '1', pcTcIndicator: 'technical' }),
      row({ cptCode: '2', workRvu: 0 }),
      row({ cptCode: '3', workRvu: null }),
      row({ cptCode: '4', workRvu: 2.5 }),
    ];
    expect(professionalCptRows(rows).map((r) => r.cptCode)).toEqual(['4']);
  });

  test('picks one professional row per CPT code, preferring modifier 26', () => {
    const rows = [
      row({ cptCode: '74177', modifier: null, workRvu: 5 }),
      row({ cptCode: '74177', modifier: '26', workRvu: 3.15 }),
    ];
    const picked = professionalCptRows(rows);
    expect(picked).toHaveLength(1);
    expect(picked[0].modifier).toBe('26');
  });
});

describe('searchCptRows — identical scoring to Codes.tsx/CommandPalette (same tokenScore import, not a reimplementation)', () => {
  const rows = [
    row({ id: 'a', cptCode: '74177', description: 'CT Abdomen and Pelvis with Contrast', workRvu: 3.15 }),
    row({ id: 'b', cptCode: '71046', description: 'Radiologic Exam Chest 2 Views', workRvu: 0.22 }),
    row({ id: 'c', cptCode: '70450', description: 'CT Head without Contrast', workRvu: 0.83 }),
  ];

  test('empty query returns no results', () => {
    expect(searchCptRows(rows, '')).toEqual([]);
    expect(searchCptRows(rows, '   ')).toEqual([]);
  });

  test('an exact code match ranks first', () => {
    const results = searchCptRows(rows, '74177');
    expect(results[0].cptCode).toBe('74177');
  });

  test('applies the same >=60 score floor Codes.tsx uses -- weak fuzzy hits are excluded', () => {
    const results = searchCptRows(rows, 'chest');
    expect(results.every((r) => tokenScore(r, 'chest') >= 60)).toBe(true);
  });

  test('results are sorted by descending score, matching the shared ranking function exactly', () => {
    const results = searchCptRows(rows, 'CT');
    const scores = results.map((r) => tokenScore(r, 'CT'));
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  test('respects the result limit', () => {
    const manyRows = Array.from({ length: 50 }, (_, i) => row({ id: `r${i}`, cptCode: `7${String(i).padStart(4, '0')}`, description: 'CT Abdomen scan' }));
    expect(searchCptRows(manyRows, 'CT abdomen', 10)).toHaveLength(10);
  });
});

describe('layered CPT title search', () => {
  test('finds CMS upper-extremity joint MRI rows from a plain MRI wrist query', () => {
    const wristRows = [
      row({ cptCode: '73221', description: 'Mri joint upr extrem w/o dye', modality: 'MRI' }),
      row({ cptCode: '73222', description: 'Mri joint upr extrem w/dye', modality: 'MRI' }),
      row({ cptCode: '73223', description: 'Mri joint upr extrem w/o & w/dye', modality: 'MRI' }),
    ];
    expect(searchCptRows(wristRows, 'MRI wrist').map((item) => item.cptCode)).toEqual(['73221', '73222', '73223']);
  });

  test('resolves an institutional MRI wrist title above the generic CMS descriptor', () => {
    const entry: ExamDictionaryEntry = {
      id: 'mri_wrist_wo',
      canonicalDisplayName: 'MRI WRIST WO CONTRAST',
      normalizedKey: 'mri wrist wo contrast',
      commonSynonyms: ['MR WRIST WITHOUT CONTRAST'],
      hospitalAliases: [],
      powerScribeNames: ['MRI WRIST WO CONTRAST'],
      cmsDescription: 'Mri joint upr extrem w/o dye',
      cptCodes: ['73221'],
      modifier26Wrvu: 1.32,
      modality: 'MRI',
      bodyRegion: 'WRIST',
      typicalCombinations: [],
      timesUsed: 0,
      source: 'institution',
      institutionSheet: 'MR',
      institutionProcedureName: 'MRI WRIST WO CONTRAST',
      sourceFileName: 'institution.xlsx',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const candidates = searchKnownTitleCandidates(
      [entry],
      [row({ cptCode: '73221', description: 'Mri joint upr extrem w/o dye', modality: 'MRI', workRvu: 1.32 })],
      'MRI wrist',
    );
    expect(candidates[0]).toMatchObject({ cptCode: '73221', description: 'MRI WRIST WO CONTRAST', method: 'manual_name_match' });
  });
});

describe('cptRowToCandidate', () => {
  test('maps a CptRvuRow into a manual_cpt MatchCandidate at full confidence', () => {
    const r = row({ cptCode: '74177', description: 'CT Abdomen Pelvis', workRvu: 3.15, modality: 'CT' });
    expect(cptRowToCandidate(r)).toEqual({
      cptCode: '74177', modifier: '26', description: 'CT Abdomen Pelvis', workRvu: 3.15, modality: 'CT', confidence: 1, method: 'manual_cpt',
    });
  });
});

describe('candidateKey', () => {
  test('keys by cptCode + modifier, treating null modifier as its own bucket', () => {
    expect(candidateKey({ cptCode: '74177', modifier: '26' })).toBe('74177:26');
    expect(candidateKey({ cptCode: '74177', modifier: null })).toBe('74177:none');
    expect(candidateKey({ cptCode: '74177', modifier: '26' })).not.toBe(candidateKey({ cptCode: '74177', modifier: null }));
  });
});
