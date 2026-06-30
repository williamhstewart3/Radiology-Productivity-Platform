-- Supabase schema for deployed RVU/productivity persistence.
-- Run this in the Supabase SQL editor before enabling VITE_SUPABASE_URL and
-- VITE_SUPABASE_ANON_KEY in Vercel.

create table if not exists public.rvu_datasets (
  id uuid primary key default gen_random_uuid(),
  year integer not null,
  filename text not null,
  source_filename text,
  row_count integer not null default 0,
  active boolean not null default false,
  uploaded_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists rvu_datasets_one_active
  on public.rvu_datasets (active)
  where active;

create table if not exists public.cpt_rvu_rows (
  id uuid primary key default gen_random_uuid(),
  dataset_id uuid references public.rvu_datasets(id) on delete cascade,
  cpt_code text not null,
  modifier text,
  description text not null default '',
  work_rvu numeric,
  non_facility_pe_rvu numeric,
  facility_pe_rvu numeric,
  malpractice_rvu numeric,
  total_rvu_non_facility numeric,
  total_rvu_facility numeric,
  status_code text not null default 'A',
  status_category text not null default 'unknown',
  global_days text,
  pc_tc_indicator text not null default 'na',
  modality text not null default 'OTHER',
  rvu_file_version text not null,
  effective_date date not null default current_date,
  is_user_verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cpt_rvu_rows_dataset_code_modifier unique (dataset_id, cpt_code, modifier)
);

create index if not exists cpt_rvu_rows_active_lookup
  on public.cpt_rvu_rows (cpt_code, modifier, work_rvu);

create index if not exists cpt_rvu_rows_description_idx
  on public.cpt_rvu_rows using gin (to_tsvector('english', description));

create table if not exists public.productivity_upload_days (
  id uuid primary key default gen_random_uuid(),
  upload_date date not null default current_date,
  reading_date date not null,
  profile_id text,
  radiologist_name text,
  site_id text,
  site_name text,
  raw_exam_text text,
  total_daily_wrvu numeric not null default 0,
  import_timestamp timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.productivity_exam_rows (
  id uuid primary key default gen_random_uuid(),
  upload_day_id uuid references public.productivity_upload_days(id) on delete cascade,
  local_log_id text unique,
  profile_id text,
  log_date date not null,
  study_date date,
  study_datetime timestamptz,
  exam_name_raw text not null,
  exam_title_normalized text,
  exam_title_display text,
  cms_description text,
  accession_number text,
  modality text,
  cpt_codes jsonb not null default '[]'::jsonb,
  modifier_26_wrvu numeric not null default 0,
  match_method text,
  match_confidence numeric,
  not_productivity_relevant boolean not null default false,
  notes text,
  deleted_at timestamptz,
  source_import_id text,
  session_id text,
  study_fingerprint text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.productivity_exam_rows
  add column if not exists exam_title_normalized text,
  add column if not exists exam_title_display text,
  add column if not exists cms_description text;

create index if not exists productivity_exam_rows_date_idx
  on public.productivity_exam_rows (log_date, profile_id, deleted_at);

create index if not exists productivity_exam_rows_upload_idx
  on public.productivity_exam_rows (upload_day_id);

create index if not exists productivity_exam_rows_title_idx
  on public.productivity_exam_rows (exam_title_normalized);

alter table public.rvu_datasets enable row level security;
alter table public.cpt_rvu_rows enable row level security;
alter table public.productivity_upload_days enable row level security;
alter table public.productivity_exam_rows enable row level security;

-- Single-user deployment policy. Tighten these policies before sharing the app
-- broadly or adding authentication.
do $$ begin
  create policy "anon read rvu datasets" on public.rvu_datasets for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "anon write rvu datasets" on public.rvu_datasets for all using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "anon read cpt rows" on public.cpt_rvu_rows for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "anon write cpt rows" on public.cpt_rvu_rows for all using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "anon read productivity days" on public.productivity_upload_days for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "anon write productivity days" on public.productivity_upload_days for all using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "anon read productivity exams" on public.productivity_exam_rows for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "anon write productivity exams" on public.productivity_exam_rows for all using (true) with check (true);
exception when duplicate_object then null; end $$;
