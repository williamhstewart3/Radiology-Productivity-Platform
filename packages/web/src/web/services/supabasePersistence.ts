import { db } from '../db/database';
import type { CptRvuRow, StudyLog } from '../types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export interface RvuDatasetMetadata {
  id: string;
  year: number;
  filename: string;
  sourceFilename: string | null;
  uploadedAt: string;
  rowCount: number;
  active: boolean;
}

export interface RemoteImportSummary {
  dataset: RvuDatasetMetadata;
  rowsImported: number;
}

function configured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

function headers(extra?: HeadersInit): HeadersInit {
  return {
    apikey: SUPABASE_ANON_KEY ?? '',
    Authorization: `Bearer ${SUPABASE_ANON_KEY ?? ''}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
    ...extra,
  };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!configured()) {
    throw new Error('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Vercel.');
  }

  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: headers(init.headers),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Supabase request failed (${response.status}): ${body || response.statusText}`);
  }

  const body = await response.text();
  if (!body) return undefined as T;
  return JSON.parse(body) as T;
}

function toDbDataset(row: Record<string, any>): RvuDatasetMetadata {
  return {
    id: row.id,
    year: Number(row.year),
    filename: row.filename,
    sourceFilename: row.source_filename ?? null,
    uploadedAt: row.uploaded_at,
    rowCount: Number(row.row_count ?? 0),
    active: Boolean(row.active),
  };
}

function toRemoteRvuRow(row: CptRvuRow, datasetId: string): Record<string, any> {
  return {
    dataset_id: datasetId,
    cpt_code: row.cptCode,
    modifier: row.modifier,
    description: row.description,
    work_rvu: row.workRvu,
    non_facility_pe_rvu: row.nonFacilityPeRvu,
    facility_pe_rvu: row.facilityPeRvu,
    malpractice_rvu: row.malpracticeRvu,
    total_rvu_non_facility: row.totalRvuNonFacility,
    total_rvu_facility: row.totalRvuFacility,
    status_code: row.statusCode,
    status_category: row.statusCategory,
    global_days: row.globalDays,
    pc_tc_indicator: row.pcTcIndicator,
    modality: row.modality,
    rvu_file_version: row.rvuFileVersion,
    effective_date: row.effectiveDate,
    is_user_verified: row.isUserVerified,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

function toLocalRvuRow(row: Record<string, any>): CptRvuRow {
  return {
    id: row.id,
    cptCode: row.cpt_code,
    modifier: row.modifier,
    description: row.description ?? '',
    workRvu: row.work_rvu == null ? null : Number(row.work_rvu),
    nonFacilityPeRvu: row.non_facility_pe_rvu == null ? null : Number(row.non_facility_pe_rvu),
    facilityPeRvu: row.facility_pe_rvu == null ? null : Number(row.facility_pe_rvu),
    malpracticeRvu: row.malpractice_rvu == null ? null : Number(row.malpractice_rvu),
    totalRvuNonFacility: row.total_rvu_non_facility == null ? null : Number(row.total_rvu_non_facility),
    totalRvuFacility: row.total_rvu_facility == null ? null : Number(row.total_rvu_facility),
    statusCode: row.status_code ?? 'A',
    statusCategory: row.status_category ?? 'unknown',
    globalDays: row.global_days ?? null,
    pcTcIndicator: row.pc_tc_indicator ?? 'na',
    modality: row.modality ?? 'OTHER',
    rvuFileVersion: row.rvu_file_version ?? 'remote',
    effectiveDate: row.effective_date ?? new Date().toISOString().slice(0, 10),
    isUserVerified: Boolean(row.is_user_verified),
    createdAt: row.created_at ?? new Date().toISOString(),
    updatedAt: row.updated_at ?? new Date().toISOString(),
  };
}

function toRemoteStudyLog(log: StudyLog, uploadDayId: string | null): Record<string, any> {
  const cptCodes = [{
    cptCode: log.cptCode,
    modifier: log.modifier,
    workRvu: log.workRvu,
    cmsDescription: log.cmsDescription,
  }].filter((code) => code.cptCode);

  return {
    upload_day_id: uploadDayId,
    local_log_id: log.id,
    profile_id: log.profileId,
    log_date: log.logDate,
    study_date: log.studyDate,
    study_datetime: log.studyDateTime,
    exam_name_raw: log.examNameRaw,
    exam_title_normalized: log.examTitleNormalized,
    exam_title_display: log.examTitleDisplay ?? log.examNameRaw,
    cms_description: log.cmsDescription,
    accession_number: log.accessionNumber,
    modality: log.modality,
    cpt_codes: cptCodes,
    modifier_26_wrvu: log.modifier === '26' && (log.workRvu ?? 0) > 0 ? log.workRvu : 0,
    match_method: log.matchMethod,
    match_confidence: log.matchConfidence,
    not_productivity_relevant: (log.workRvu ?? 0) <= 0 || log.modifier !== '26',
    notes: log.notes,
    deleted_at: (log as any).deletedAt ?? null,
    source_import_id: log.sourceImportId,
    session_id: log.sessionId,
    study_fingerprint: log.studyFingerprint,
    created_at: log.createdAt,
    updated_at: log.updatedAt,
  };
}

export const supabasePersistence = {
  isConfigured: configured,

  async getActiveRvuDataset(): Promise<RvuDatasetMetadata | null> {
    if (!configured()) return null;
    const rows = await request<Record<string, any>[]>('rvu_datasets?active=eq.true&select=*&limit=1');
    return rows[0] ? toDbDataset(rows[0]) : null;
  },

  async replaceActiveRvuDataset(params: {
    year: number;
    filename: string;
    sourceFilename: string;
    rows: CptRvuRow[];
  }): Promise<RemoteImportSummary> {
    if (!configured()) {
      throw new Error('Supabase is not configured. RVU imports need VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
    }

    await request('rvu_datasets?active=eq.true', {
      method: 'PATCH',
      body: JSON.stringify({ active: false }),
    });

    const [datasetRow] = await request<Record<string, any>[]>('rvu_datasets', {
      method: 'POST',
      body: JSON.stringify({
        year: params.year,
        filename: params.filename,
        source_filename: params.sourceFilename,
        row_count: params.rows.length,
        active: true,
        uploaded_at: new Date().toISOString(),
      }),
    });

    const dataset = toDbDataset(datasetRow);
    const batchSize = 500;
    for (let i = 0; i < params.rows.length; i += batchSize) {
      const batch = params.rows.slice(i, i + batchSize).map((row) => toRemoteRvuRow(row, dataset.id));
      await request('cpt_rvu_rows', {
        method: 'POST',
        body: JSON.stringify(batch),
        headers: { Prefer: 'return=minimal' },
      });
    }

    return { dataset, rowsImported: params.rows.length };
  },

  async hydrateActiveRvuRowsIntoDexie(): Promise<RvuDatasetMetadata | null> {
    if (!configured()) return null;
    const dataset = await this.getActiveRvuDataset();
    if (!dataset) return null;

    let offset = 0;
    const pageSize = 1000;
    const localRows: CptRvuRow[] = [];

    while (true) {
      const rows = await request<Record<string, any>[]>(
        `cpt_rvu_rows?dataset_id=eq.${dataset.id}&select=*&order=cpt_code.asc&limit=${pageSize}&offset=${offset}`,
      );
      localRows.push(...rows.map(toLocalRvuRow));
      if (rows.length < pageSize) break;
      offset += pageSize;
    }

    if (localRows.length > 0) {
      await db.transaction('rw', db.cptRvuTable, db.userSettings, async () => {
        await db.cptRvuTable.clear();
        await db.cptRvuTable.bulkPut(localRows);
        const settings = await db.userSettings.get('default');
        if (settings) {
          await db.userSettings.put({
            ...settings,
            activeRvuFileVersion: `${dataset.year}`,
            updatedAt: new Date().toISOString(),
          });
        }
      });
    }

    return { ...dataset, rowCount: localRows.length || dataset.rowCount };
  },

  async createUploadDay(params: {
    readingDate: string;
    profileId: string | null;
    radiologistName?: string | null;
    siteId?: string | null;
    siteName?: string | null;
    rawExamText?: string | null;
    totalDailyWrvu: number;
  }): Promise<string | null> {
    if (!configured()) return null;
    const [row] = await request<Record<string, any>[]>('productivity_upload_days', {
      method: 'POST',
      body: JSON.stringify({
        upload_date: new Date().toISOString().slice(0, 10),
        reading_date: params.readingDate,
        profile_id: params.profileId,
        radiologist_name: params.radiologistName ?? null,
        site_id: params.siteId ?? null,
        site_name: params.siteName ?? null,
        raw_exam_text: params.rawExamText ?? null,
        total_daily_wrvu: params.totalDailyWrvu,
        import_timestamp: new Date().toISOString(),
      }),
    });
    return row.id;
  },

  async saveStudyLogs(logs: StudyLog[], uploadDayId: string | null): Promise<void> {
    if (!configured() || logs.length === 0) return;
    const rows = logs.map((log) => toRemoteStudyLog(log, uploadDayId));
    await request('productivity_exam_rows?on_conflict=local_log_id', {
      method: 'POST',
      body: JSON.stringify(rows),
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    });
  },

  async updateStudyLogDisplayTitle(localIds: string[], displayTitle: string, normalizedTitle: string): Promise<void> {
    if (!configured() || localIds.length === 0) return;
    const encoded = localIds.map((id) => `"${id}"`).join(',');
    await request(`productivity_exam_rows?local_log_id=in.(${encoded})`, {
      method: 'PATCH',
      body: JSON.stringify({
        exam_title_display: displayTitle,
        exam_title_normalized: normalizedTitle,
        updated_at: new Date().toISOString(),
      }),
      headers: { Prefer: 'return=minimal' },
    });
  },

  async softDeleteStudyLogs(localIds: string[]): Promise<void> {
    if (!configured() || localIds.length === 0) return;
    const encoded = localIds.map((id) => `"${id}"`).join(',');
    await request(`productivity_exam_rows?local_log_id=in.(${encoded})`, {
      method: 'PATCH',
      body: JSON.stringify({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
      headers: { Prefer: 'return=minimal' },
    });
  },
};
