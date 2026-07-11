export interface WordBox {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  centerY: number;
  height: number;
}

export interface HeaderAnchors {
  found: boolean;
  headerBottom?: number;
  procX0?: number;
  examX0?: number;
  modX0?: number;
}

export interface AnchoredTableRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
  columns: {
    procedure: { x0: number; x1: number };
    examDate: { x0: number; x1: number };
    modifiedDate: { x0: number; x1: number };
  };
}

const PROCEDURE_PATTERN = /^Procedure$/i;
const EXAM_PATTERN = /^Exam$/i;
const MODIFIED_PATTERN = /^Modif(?:ied|led|ted)$/i;

export function findPowerScribeHeaderAnchors(words: WordBox[]): HeaderAnchors {
  const procedureCandidates = words.filter((word) => PROCEDURE_PATTERN.test(word.text));

  for (const proc of procedureCandidates) {
    const rowTolerance = proc.height * 0.7;
    const examCandidate = words
      .filter((word) => EXAM_PATTERN.test(word.text) && Math.abs(word.centerY - proc.centerY) <= rowTolerance && word.x0 > proc.x1)
      .sort((a, b) => a.x0 - b.x0)[0];
    if (!examCandidate) continue;

    const modifiedCandidate = words
      .filter((word) => MODIFIED_PATTERN.test(word.text) && Math.abs(word.centerY - proc.centerY) <= rowTolerance && word.x0 > examCandidate.x1)
      .sort((a, b) => a.x0 - b.x0)[0];
    if (!modifiedCandidate) continue;

    const heightPad = proc.height;
    const bottomPad = proc.height * 0.5;
    const headerBottom = Math.max(proc.y1, examCandidate.y1, modifiedCandidate.y1) + bottomPad;

    return {
      found: true,
      headerBottom,
      procX0: Math.max(0, proc.x0 - heightPad),
      examX0: Math.max(0, examCandidate.x0 - heightPad),
      modX0: Math.max(0, modifiedCandidate.x0 - heightPad),
    };
  }

  return { found: false };
}

function isDateShapeWord(text: string): boolean {
  if (/^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(text)) return true;
  if (/^\d{1,2}:\d{2}$/.test(text)) return true;
  if (/^(?:AM|PM)$/i.test(text)) return true;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return true;
  return false;
}

export function getTableRectFromAnchors(words: WordBox[], anchors: HeaderAnchors): AnchoredTableRect | null {
  if (!anchors.found || anchors.headerBottom == null || anchors.procX0 == null || anchors.examX0 == null || anchors.modX0 == null) {
    return null;
  }

  const dateWords = words.filter((word) => word.y0 > anchors.headerBottom! && word.x0 >= anchors.examX0! - 4 && isDateShapeWord(word.text));
  if (dateWords.length === 0) return null;

  const avgRowHeight = dateWords.reduce((sum, word) => sum + word.height, 0) / dateWords.length;
  const maxY1 = Math.max(...dateWords.map((word) => word.y1));
  const maxX1 = Math.max(...dateWords.map((word) => word.x1));
  const tableBottom = maxY1 + avgRowHeight * 0.7;
  const tableRight = maxX1 + avgRowHeight;

  return {
    top: anchors.headerBottom,
    bottom: tableBottom,
    left: anchors.procX0,
    right: tableRight,
    columns: {
      procedure: { x0: anchors.procX0, x1: anchors.examX0 - 6 },
      examDate: { x0: anchors.examX0, x1: anchors.modX0 - 6 },
      modifiedDate: { x0: anchors.modX0, x1: tableRight },
    },
  };
}
