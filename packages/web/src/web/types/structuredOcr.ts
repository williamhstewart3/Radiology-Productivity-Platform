export interface PowerScribeStructuredOcrRow {
  procedureName: string;
  examDateTime: string | null;
  modifiedDateTime: string | null;
  rawProcedureText: string;
  rawExamDateText: string;
  rawModifiedText: string;
  confidence: number;
  needsReview: boolean;
  reviewReason: string | null;
}

export interface PowerScribeOcrAccounting {
  cropMethod: string | null;
  anchorCount: number;
  procedureLineCount: number;
  examLineCount: number;
  modifiedLineCount: number;
  bandCount: number;
  suspectedMissedRows: number;
  inkProjectionRowEstimate: number;
}

export interface PowerScribeStructuredOcrResult {
  rows: PowerScribeStructuredOcrRow[];
  accounting: PowerScribeOcrAccounting | null;
}
