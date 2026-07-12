import { db } from '../db/database';
import { normalizeRadiologyDescription } from './radiologyDescriptionNormalization';
import type { StudyLog } from '../types';

export interface HospitalRow {
  examTitle: string;
  cptCode: string | null;
  modifier: string | null;
  workRvu: number | null;
  quantity: number;
}

export interface HospitalDiscrepancy {
  type: 'missing_local' | 'missing_hospital' | 'cpt_mismatch' | 'modifier_mismatch' | 'wrvu_difference';
  key: string;
  summary: string;
  hospital?: HospitalRow;
  local?: StudyLog;
}

function localTitle(log: StudyLog): string {
  return log.examTitleDisplay?.trim() || log.examNameRaw;
}

export function parseHospitalReport(raw: string): HospitalRow[] {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  const header = lines[0].split(',').map((cell) => cell.trim().toLowerCase());
  const hasHeader = header.some((cell) => ['exam', 'examtitle', 'cpt', 'cptcode', 'wrvu', 'workrvu'].includes(cell.replace(/\s+/g, '')));
  const dataLines = hasHeader ? lines.slice(1) : lines;
  const indexFor = (names: string[], fallback: number) => {
    const index = header.findIndex((cell) => names.includes(cell.replace(/\s+/g, '')));
    return index >= 0 ? index : fallback;
  };
  const examIndex = hasHeader ? indexFor(['exam', 'examtitle', 'description', 'study'], 0) : 0;
  const cptIndex = hasHeader ? indexFor(['cpt', 'cptcode'], 1) : 1;
  const modifierIndex = hasHeader ? indexFor(['modifier', 'mod'], 2) : 2;
  const wrvuIndex = hasHeader ? indexFor(['wrvu', 'workrvu', 'workrvus'], 3) : 3;
  const qtyIndex = hasHeader ? indexFor(['quantity', 'qty', 'count'], 4) : 4;

  return dataLines.map((line) => {
    const cells = line.split(',').map((cell) => cell.trim());
    return {
      examTitle: cells[examIndex] || cells[0] || 'Untitled exam',
      cptCode: cells[cptIndex] || null,
      modifier: cells[modifierIndex] || null,
      workRvu: Number.isFinite(Number(cells[wrvuIndex])) ? Number(cells[wrvuIndex]) : null,
      quantity: Math.max(1, Number.isFinite(Number(cells[qtyIndex])) ? Number(cells[qtyIndex]) : 1),
    };
  });
}

export function compareHospitalRows(rows: HospitalRow[], logs: StudyLog[]): HospitalDiscrepancy[] {
  const localByKey = new Map<string, StudyLog[]>();
  for (const log of logs) {
    const key = `${normalizeRadiologyDescription(localTitle(log))}|${log.cptCode ?? ''}`;
    localByKey.set(key, [...(localByKey.get(key) ?? []), log]);
  }
  const hospitalKeys = new Set<string>();
  const discrepancies: HospitalDiscrepancy[] = [];

  for (const row of rows) {
    const key = `${normalizeRadiologyDescription(row.examTitle)}|${row.cptCode ?? ''}`;
    hospitalKeys.add(key);
    const local = localByKey.get(key)?.[0];
    if (!local) {
      discrepancies.push({ type: 'missing_local', key, summary: `Hospital report has ${row.examTitle} ${row.cptCode ?? ''}, but no matching local log.`, hospital: row });
      continue;
    }
    if ((row.modifier ?? null) !== (local.modifier ?? null)) {
      discrepancies.push({ type: 'modifier_mismatch', key, summary: `Modifier differs for ${row.examTitle}: hospital ${row.modifier ?? 'none'}, local ${local.modifier ?? 'none'}.`, hospital: row, local });
    }
    if (row.workRvu != null && local.workRvu != null && Math.abs(row.workRvu - local.workRvu) > 0.01) {
      discrepancies.push({ type: 'wrvu_difference', key, summary: `wRVU differs for ${row.examTitle}: hospital ${row.workRvu}, local ${local.workRvu}.`, hospital: row, local });
    }
  }

  for (const log of logs) {
    const key = `${normalizeRadiologyDescription(localTitle(log))}|${log.cptCode ?? ''}`;
    if (!hospitalKeys.has(key)) {
      discrepancies.push({ type: 'missing_hospital', key, summary: `Local log ${localTitle(log)} ${log.cptCode ?? ''} is absent from the hospital report.`, local: log });
    }
  }
  return discrepancies;
}

export async function saveHospitalComparisonReport(params: {
  profileId: string | null;
  siteId: string | null;
  reportDate: string;
  filename: string;
  hospitalRows: HospitalRow[];
  logs: StudyLog[];
  discrepancies: HospitalDiscrepancy[];
}): Promise<void> {
  const hospitalTotalWrvu = params.hospitalRows.reduce((sum, row) => sum + (row.workRvu ?? 0) * row.quantity, 0);
  const localTotalWrvu = params.logs.reduce((sum, log) => sum + (log.workRvu ?? 0), 0);
  await db.hospitalComparisonReports.add({
    id: crypto.randomUUID(),
    profileId: params.profileId,
    siteId: params.siteId,
    reportDate: params.reportDate,
    filename: params.filename,
    hospitalTotalWrvu,
    localTotalWrvu,
    hospitalExamCount: params.hospitalRows.reduce((sum, row) => sum + row.quantity, 0),
    localExamCount: params.logs.length,
    discrepanciesJson: JSON.stringify(params.discrepancies),
    createdAt: new Date().toISOString(),
  });
}
