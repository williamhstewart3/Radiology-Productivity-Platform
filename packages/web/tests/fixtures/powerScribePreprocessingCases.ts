export interface PowerScribeCharacterRegressionCase {
  name: string;
  field: 'procedure' | 'examDate' | 'modifiedDate';
  expected: string;
  plausibleOcrFailure: string;
  sourceCondition: 'thin-arial' | 'tight-spacing' | 'date-punctuation' | 'character-shape';
}

export const POWERSCRIBE_CHARACTER_REGRESSION_CASES: PowerScribeCharacterRegressionCase[] = [
  {
    name: 'OBLIGUE to OBLIQUE',
    field: 'procedure',
    expected: 'XR WRIST RIGHT PA LATERAL AND OBLIQUE',
    plausibleOcrFailure: 'XR WRIST RIGHT PA LATERAL AND OBLIGUE',
    sourceCondition: 'character-shape',
  },
  {
    name: 'P and F remain distinct',
    field: 'procedure',
    expected: 'CT PERFUSION BRAIN',
    plausibleOcrFailure: 'CT FERFUSION BRAIN',
    sourceCondition: 'thin-arial',
  },
  {
    name: 'B and 8 remain distinct',
    field: 'procedure',
    expected: 'XR BONE SURVEY',
    plausibleOcrFailure: 'XR 8ONE SURVEY',
    sourceCondition: 'character-shape',
  },
  {
    name: 'O and zero remain distinct',
    field: 'procedure',
    expected: 'US OB LIMITED',
    plausibleOcrFailure: 'US 0B LIMITED',
    sourceCondition: 'character-shape',
  },
  {
    name: 'I and one remain distinct',
    field: 'procedure',
    expected: 'MRI IAC W WO CONTRAST',
    plausibleOcrFailure: 'MRI 1AC W WO CONTRAST',
    sourceCondition: 'thin-arial',
  },
  {
    name: 'C and G remain distinct',
    field: 'procedure',
    expected: 'CT CERVICAL SPINE',
    plausibleOcrFailure: 'CT GERVICAL SPINE',
    sourceCondition: 'thin-arial',
  },
  {
    name: 'U and V remain distinct in tight text',
    field: 'procedure',
    expected: 'US VENOUS LOWER EXTREMITY',
    plausibleOcrFailure: 'VS VENOUS LOWER EXTREMITY',
    sourceCondition: 'tight-spacing',
  },
  {
    name: 'RN and M remain distinct in tight text',
    field: 'procedure',
    expected: 'MRI BRAIN W WO CONTRAST',
    plausibleOcrFailure: 'MRI BMAIM W WO CONTRAST',
    sourceCondition: 'tight-spacing',
  },
  {
    name: 'Exam Date retains its colon',
    field: 'examDate',
    expected: '7/16/26 8:15 AM',
    plausibleOcrFailure: '7/16/26 815 AM',
    sourceCondition: 'date-punctuation',
  },
  {
    name: 'Modified retains every date digit and its time',
    field: 'modifiedDate',
    expected: '7/16/26 11:08 AM',
    plausibleOcrFailure: '7/16/26 11:O8 AM',
    sourceCondition: 'date-punctuation',
  },
];

export const POWERSCRIBE_REPEATED_STUDY_ROWS = [
  {
    procedure: 'CT CHEST ABDOMEN PELVIS W CONTRAST',
    examDate: '7/16/26 8:15 AM',
    modifiedDate: '7/16/26 8:42 AM',
  },
  {
    procedure: 'CT CHEST ABDOMEN PELVIS W CONTRAST',
    examDate: '7/16/26 9:05 AM',
    modifiedDate: '7/16/26 9:31 AM',
  },
] as const;
