import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { parseInstitutionProcedureWorkbook } from '../src/web/utils/institutionProcedureMappingImporter';

function inlineCell(ref: string, value: string): string {
  return `<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`;
}

function valueCell(ref: string, value: string): string {
  return `<c r="${ref}"><v>${value}</v></c>`;
}

function sheetXml(rows: string[][]): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
${rows.map((row, rowIndex) => {
  const number = rowIndex + 1;
  return `<row r="${number}">${row.map((value, colIndex) => {
    const ref = `${String.fromCharCode(65 + colIndex)}${number}`;
    return /^\d{5}$/.test(value) ? valueCell(ref, value) : inlineCell(ref, value);
  }).join('')}</row>`;
}).join('')}
</sheetData></worksheet>`;
}

function workbookFixture(): ArrayBuffer {
  const files: Record<string, Uint8Array> = {
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="MR" sheetId="1" r:id="rId1"/>
    <sheet name="US" sheetId="2" r:id="rId2"/>
    <sheet name="CT" sheetId="3" r:id="rId3"/>
  </sheets>
</workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/>
</Relationships>`),
    'xl/worksheets/sheet1.xml': strToU8(sheetXml([
      ['Procedure Type', 'CPT Code'],
      ['MRI BRAIN W WO CONTRAST', '70553'],
    ])),
    'xl/worksheets/sheet2.xml': strToU8(sheetXml([
      ['Procedure Type', 'CPT Code'],
      ['US ABDOMEN LIMITED', '76705'],
      ['US REFERENCE ONLY', ''],
    ])),
    'xl/worksheets/sheet3.xml': strToU8(sheetXml([
      ['Procedure Type', 'CPT Code'],
      ['CT HEAD WO CONTRAST', '70450'],
      ['CTA CHEST ABDOMEN PELVIS', '71275/74174'],
      ['CTA CHEST PLUS PELVIS', '71275 + 72191'],
      ['CTA CHEST SPACE PELVIS', '71275 72191'],
    ])),
  };
  return zipSync(files).buffer as ArrayBuffer;
}

describe('institution procedure mapping workbook parsing', () => {
  test('imports CT single CPT rows and slash-separated multi-CPT rows', () => {
    const { rows, summary } = parseInstitutionProcedureWorkbook(workbookFixture());

    const ctHead = rows.find((row) => row.procedureType === 'CT HEAD WO CONTRAST');
    const cta = rows.find((row) => row.procedureType === 'CTA CHEST ABDOMEN PELVIS');
    const plus = rows.find((row) => row.procedureType === 'CTA CHEST PLUS PELVIS');
    const space = rows.find((row) => row.procedureType === 'CTA CHEST SPACE PELVIS');

    expect(ctHead?.modality).toBe('CT');
    expect(ctHead?.cptCodes).toEqual(['70450']);
    expect(cta?.cptCodes).toEqual(['71275', '74174']);
    expect(plus?.cptCodes).toEqual(['71275', '72191']);
    expect(space?.cptCodes).toEqual(['71275', '72191']);
    expect(summary.multiCptRows).toBe(3);
  });

  test('maps MR and US sheets to application modalities', () => {
    const { rows, summary } = parseInstitutionProcedureWorkbook(workbookFixture());

    expect(rows.find((row) => row.procedureType === 'MRI BRAIN W WO CONTRAST')?.modality).toBe('MRI');
    expect(rows.find((row) => row.procedureType === 'US ABDOMEN LIMITED')?.modality).toBe('US');
    expect(summary.modalityCounts).toMatchObject({ MRI: 1, US: 2, CT: 4 });
  });

  test('keeps blank CPT rows as reference-only mappings', () => {
    const { rows, summary } = parseInstitutionProcedureWorkbook(workbookFixture());
    const blank = rows.find((row) => row.procedureType === 'US REFERENCE ONLY');

    expect(blank?.cptCodes).toEqual([]);
    expect(summary.skippedBlankCptRows).toBe(1);
    expect(summary.mappedRows).toBe(6);
  });
});
