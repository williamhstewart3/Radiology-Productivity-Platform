import type { CptRvuRow } from '../types';

export function normalizeCptModifier(modifier: string | null | undefined): string {
  return modifier?.trim() ?? '';
}

export function cptRvuUniqueKey(row: Pick<CptRvuRow, 'cptCode' | 'modifier'>): string {
  return `${row.cptCode.trim().toUpperCase()}::${normalizeCptModifier(row.modifier)}`;
}

function completenessScore(row: CptRvuRow): number {
  let score = 0;
  if (row.workRvu != null) score += 8;
  if (row.description.trim()) score += Math.min(6, Math.ceil(row.description.trim().length / 24));
  if (row.statusCode.trim()) score += 2;
  if (row.statusCategory !== 'unknown') score += 2;
  if (row.modality !== 'OTHER') score += 2;
  if (row.pcTcIndicator !== 'na') score += 2;
  if (row.effectiveDate.trim()) score += 1;
  if (row.rvuFileVersion.trim()) score += 1;
  if (row.isUserVerified) score += 1;
  return score;
}

function normalizeRow(row: CptRvuRow): CptRvuRow {
  const cptCode = row.cptCode.trim().toUpperCase();
  const modifier = normalizeCptModifier(row.modifier);
  return {
    ...row,
    id: row.id || `cpt_${cptCode}_${modifier || 'none'}`,
    cptCode,
    modifier,
  };
}

export function dedupeCptRvuRowsForBulkPut(rows: CptRvuRow[], sourceLabel: string): CptRvuRow[] {
  const byKey = new Map<string, CptRvuRow>();
  const duplicateKeys = new Set<string>();

  for (const rawRow of rows) {
    const row = normalizeRow(rawRow);
    const key = cptRvuUniqueKey(row);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, row);
      continue;
    }

    duplicateKeys.add(key);
    if (completenessScore(row) > completenessScore(existing)) {
      byKey.set(key, row);
    }
  }

  if (duplicateKeys.size > 0 && import.meta.env.DEV) {
    console.warn(
      `[${sourceLabel}] Deduplicated ${duplicateKeys.size} duplicate CPT/modifier keys before cptRvuTable.bulkPut():`,
      Array.from(duplicateKeys).sort(),
    );
  }

  return Array.from(byKey.values());
}
