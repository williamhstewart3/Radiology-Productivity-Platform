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

export interface PowerScribeVisionRow {
  procedureName: string;
  examDateTime: string | null;
  modifiedDateTime: string | null;
  rawProcedureText: string;
  rawExamDateText: string;
  rawModifiedText: string;
  rowIndex: string | null;
  confidence: number;
  needsReview: boolean;
  reviewReason: string | null;
}
