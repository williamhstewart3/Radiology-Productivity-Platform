/**
 * Search-first CPT lookup and logging workstation.
 *
 * This page is intentionally self-contained: it only reads CPT rows and writes
 * studyLogs using the existing StudyLog shape. No schema/import/watcher paths
 * are involved.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import { buildFingerprint } from '../utils/duplicateDetection';
import { useProfile } from '../hooks/useProfile';
import type { CptRvuRow, Modality, StudyLog } from '../types';
import { MODALITY_LABELS } from '../types';

type BodyRegion =
  | 'HEAD_NECK'
  | 'CHEST'
  | 'ABDOMEN'
  | 'PELVIS'
  | 'SPINE'
  | 'UPPER_EXT'
  | 'LOWER_EXT'
  | 'BREAST';

type ContrastType = 'all' | 'without' | 'with' | 'both';
type ModalityFilter = 'all' | Modality;

interface RegionMeta {
  label: string;
  shortLabel: string;
  ranges: [number, number][];
}

const REGION_META: Record<BodyRegion, RegionMeta> = {
  HEAD_NECK: {
    label: 'Head and Neck',
    shortLabel: 'Head/Neck',
    ranges: [[70010, 70110], [70450, 70498], [70540, 70559], [76506, 76536]],
  },
  CHEST: {
    label: 'Chest',
    shortLabel: 'Chest',
    ranges: [[71045, 71048], [71250, 71275], [71550, 71555], [76604, 76642]],
  },
  ABDOMEN: {
    label: 'Abdomen',
    shortLabel: 'Abdomen',
    ranges: [[74150, 74183], [76700, 76776], [78226, 78227]],
  },
  PELVIS: {
    label: 'Pelvis',
    shortLabel: 'Pelvis',
    ranges: [[72191, 72198], [74176, 74178], [76830, 76857]],
  },
  SPINE: {
    label: 'Spine',
    shortLabel: 'Spine',
    ranges: [[72125, 72159], [72200, 72220]],
  },
  UPPER_EXT: {
    label: 'Upper Extremity',
    shortLabel: 'Upper Ext',
    ranges: [[73000, 73225], [76881, 76882]],
  },
  LOWER_EXT: {
    label: 'Lower Extremity',
    shortLabel: 'Lower Ext',
    ranges: [[73501, 73725], [76881, 76882]],
  },
  BREAST: {
    label: 'Breast',
    shortLabel: 'Breast',
    ranges: [[77046, 77067], [19081, 19086], [76641, 76642]],
  },
};

const ALL_REGIONS = Object.keys(REGION_META) as BodyRegion[];

const MODALITIES_FOR_FILTER: Modality[] = [
  'CT',
  'MRI',
  'US',
  'XR',
  'NM_PET',
  'MAMMO',
  'FLUORO',
  'PROCEDURE',
];

const CONTRAST_OPTIONS: { id: ContrastType; label: string }[] = [
  { id: 'all', label: 'All contrast' },
  { id: 'without', label: 'Non-con' },
  { id: 'with', label: 'Contrast' },
  { id: 'both', label: 'Multi-phase' },
];

const SEARCH_EXPANSIONS: Record<string, string[]> = {
  stroke: ['ct head', 'cta head neck', 'code stroke', 'head without contrast', '70450', '70496', '70498'],
  pe: ['pulmonary embolism', 'cta chest', 'ct angiography chest', '71275'],
  mrcp: ['mri abdomen', 'mr cholangiopancreatography', 'bile duct', '74181', '74183'],
  'cta head neck': ['cta head', 'cta neck', 'ct angiography head neck', '70496', '70498'],
  'liver mri': ['mri abdomen liver', 'abdomen mri with contrast', '74183'],
  'rectal mri': ['mri pelvis rectum', 'pelvis mri', '72195', '72197'],
  'thyroid ultrasound': ['ultrasound thyroid', 'soft tissue head neck', '76536'],
  'breast biopsy': ['mammography biopsy', 'breast bx', 'stereotactic biopsy', 'ultrasound breast biopsy', '19081', '19083'],
};

function codeInRegion(cptCode: string, region: BodyRegion): boolean {
  const num = Number.parseInt(cptCode, 10);
  if (Number.isNaN(num)) return false;
  return REGION_META[region].ranges.some(([lo, hi]) => num >= lo && num <= hi);
}

function detectContrast(description: string): 'without' | 'with' | 'both' | 'unknown' {
  const d = description.toLowerCase();
  if (d.includes('without and with') || d.includes('w/o and w/') || d.includes('w & w/o')) return 'both';
  if (d.includes('without contrast') || d.includes('w/o contrast') || d.endsWith(' w/o')) return 'without';
  if (d.includes('with contrast') || d.includes('w/ contrast') || /\bw\/\s/.test(d) || d.endsWith(' w/')) return 'with';
  return 'unknown';
}

function normalizedText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function expandedSearchTerms(query: string): string[] {
  const normalized = normalizedText(query);
  if (!normalized) return [];

  const terms = new Set<string>([
    normalized,
    normalized.replace(/\bct\s*a\b/g, 'cta'),
    normalized.replace(/\bmr\s*cp\b/g, 'mrcp'),
    normalized.replace(/\bultra\s*sound\b/g, 'ultrasound'),
  ]);

  for (const [key, expansions] of Object.entries(SEARCH_EXPANSIONS)) {
    if (normalized.includes(key)) {
      expansions.forEach((term) => terms.add(normalizedText(term)));
    }
  }

  return [...terms].filter(Boolean);
}

function tokenScore(row: CptRvuRow, query: string): number {
  const terms = expandedSearchTerms(query);
  if (terms.length === 0) return 0;

  const haystack = normalizedText(`${row.cptCode} ${row.description} ${row.modality} ${row.modifier ?? ''}`);
  const code = row.cptCode.toLowerCase();
  let best = 0;

  for (const term of terms) {
    if (code === term) best = Math.max(best, 200);
    if (code.startsWith(term)) best = Math.max(best, 170);
    if (haystack.includes(term)) best = Math.max(best, 130 + term.length);

    const tokens = term.split(' ').filter(Boolean);
    const hits = tokens.filter((token) => haystack.includes(token)).length;
    if (tokens.length > 0) {
      best = Math.max(best, hits * 24 + (hits === tokens.length ? 30 : 0));
    }
  }

  return best;
}

function pickProfessionalRow(rows: CptRvuRow[]): CptRvuRow | null {
  const billableRows = rows.filter(
    (row) => row.pcTcIndicator !== 'technical' && (row.workRvu ?? 0) > 0,
  );
  if (billableRows.length === 0) return null;

  const mod26 = billableRows.find((row) => row.modifier === '26');
  const global = billableRows.find((row) => row.modifier == null);
  return mod26 ?? global ?? billableRows[0];
}

function rowKey(row: CptRvuRow): string {
  return `${row.cptCode}:${row.modifier ?? 'none'}`;
}

function modalityLabel(modality: ModalityFilter): string {
  return modality === 'all' ? 'All modalities' : MODALITY_LABELS[modality];
}

function PillButton({
  active,
  disabled,
  children,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex min-h-8 items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors"
      style={{
        background: active ? 'rgba(91,184,212,0.18)' : 'rgba(255,255,255,0.035)',
        border: active ? '1px solid rgba(91,184,212,0.42)' : '1px solid rgba(255,255,255,0.07)',
        color: disabled ? 'var(--theme-text-disabled)' : active ? '#9be8ff' : 'var(--theme-text-muted)',
        opacity: disabled ? 0.45 : 1,
      }}
    >
      {children}
    </button>
  );
}

function FilterRail({
  selectedModality,
  setSelectedModality,
  contrastFilter,
  setContrastFilter,
  selectedRegion,
  setSelectedRegion,
  regionCounts,
  resetFilters,
}: {
  selectedModality: ModalityFilter;
  setSelectedModality: (value: ModalityFilter) => void;
  contrastFilter: ContrastType;
  setContrastFilter: (value: ContrastType) => void;
  selectedRegion: BodyRegion | null;
  setSelectedRegion: (value: BodyRegion | null) => void;
  regionCounts: Record<BodyRegion, number>;
  resetFilters: () => void;
}) {
  return (
    <aside
      className="flex min-h-0 flex-col gap-3 rounded-lg p-3"
      style={{
        background: 'linear-gradient(180deg, rgba(12,33,59,0.86), rgba(6,16,31,0.86))',
        border: '1px solid rgba(91,184,212,0.12)',
      }}
    >
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold uppercase" style={{ color: 'rgba(155,232,255,0.82)', letterSpacing: 0 }}>
          Filters
        </p>
        <button
          type="button"
          onClick={resetFilters}
          className="rounded-md px-2 py-1 text-xs"
          style={{ color: 'var(--theme-text-disabled)', background: 'rgba(255,255,255,0.04)' }}
        >
          Reset
        </button>
      </div>

      <div className="space-y-1.5">
        <p className="text-[11px] font-semibold" style={{ color: 'var(--theme-text-disabled)' }}>
          Modality
        </p>
        <div className="grid grid-cols-1 gap-1.5">
          <PillButton active={selectedModality === 'all'} onClick={() => setSelectedModality('all')}>
            <span>All</span>
          </PillButton>
          {MODALITIES_FOR_FILTER.map((modality) => (
            <PillButton
              key={modality}
              active={selectedModality === modality}
              onClick={() => setSelectedModality(modality)}
            >
              <span>{modality === 'NM_PET' ? 'NM/PET' : MODALITY_LABELS[modality]}</span>
            </PillButton>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-[11px] font-semibold" style={{ color: 'var(--theme-text-disabled)' }}>
          Contrast
        </p>
        <div className="grid grid-cols-1 gap-1.5">
          {CONTRAST_OPTIONS.map((option) => (
            <PillButton
              key={option.id}
              active={contrastFilter === option.id}
              onClick={() => setContrastFilter(option.id)}
            >
              <span>{option.label}</span>
            </PillButton>
          ))}
        </div>
      </div>

      <div className="min-h-0 space-y-1.5">
        <p className="text-[11px] font-semibold" style={{ color: 'var(--theme-text-disabled)' }}>
          Anatomy
        </p>
        <div className="grid max-h-[34vh] grid-cols-1 gap-1.5 overflow-y-auto pr-1">
          <PillButton active={selectedRegion == null} onClick={() => setSelectedRegion(null)}>
            <span>All anatomy</span>
          </PillButton>
          {ALL_REGIONS.map((region) => (
            <PillButton
              key={region}
              active={selectedRegion === region}
              disabled={regionCounts[region] === 0}
              onClick={() => setSelectedRegion(selectedRegion === region ? null : region)}
            >
              <span>{REGION_META[region].shortLabel}</span>
              <span className="font-mono text-[11px]">{regionCounts[region]}</span>
            </PillButton>
          ))}
        </div>
      </div>
    </aside>
  );
}

function ResultRow({
  row,
  index,
  highlighted,
  inQueue,
  onAdd,
  onRemove,
  onHover,
}: {
  row: CptRvuRow;
  index: number;
  highlighted: boolean;
  inQueue: boolean;
  onAdd: () => void;
  onRemove: () => void;
  onHover: () => void;
}) {
  const contrast = detectContrast(row.description);
  const contrastLabel =
    contrast === 'both' ? 'Multi-phase' :
    contrast === 'with' ? 'Contrast' :
    contrast === 'without' ? 'Non-con' :
    'Unspecified';

  return (
    <button
      type="button"
      onClick={inQueue ? onRemove : onAdd}
      onMouseEnter={onHover}
      className="grid w-full grid-cols-[42px_minmax(0,1fr)_82px_36px] items-center gap-3 border-b px-4 py-3 text-left transition-colors"
      style={{
        borderColor: 'rgba(255,255,255,0.055)',
        background: highlighted
          ? 'rgba(91,184,212,0.11)'
          : inQueue
            ? 'rgba(37,99,168,0.16)'
            : 'transparent',
        boxShadow: highlighted ? 'inset 2px 0 0 #5BB8D4' : inQueue ? 'inset 2px 0 0 rgba(91,184,212,0.55)' : 'none',
      }}
    >
      <div className="font-mono text-[11px]" style={{ color: 'var(--theme-text-disabled)' }}>
        {String(index + 1).padStart(2, '0')}
      </div>

      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className="font-mono text-sm font-bold" style={{ color: '#9be8ff' }}>
            {row.cptCode}{row.modifier ? `-${row.modifier}` : ''}
          </span>
          <span
            className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
            style={{
              background: 'rgba(255,255,255,0.055)',
              color: 'var(--theme-text-muted)',
            }}
          >
            {MODALITY_LABELS[row.modality]}
          </span>
          <span
            className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
            style={{
              background: contrast === 'unknown' ? 'rgba(255,255,255,0.04)' : 'rgba(91,184,212,0.11)',
              color: contrast === 'unknown' ? 'var(--theme-text-disabled)' : '#9be8ff',
            }}
          >
            {contrastLabel}
          </span>
        </div>
        <p className="mt-1 truncate text-xs" style={{ color: 'var(--theme-text-muted)' }}>
          {row.description}
        </p>
      </div>

      <div className="text-right">
        <p className="font-mono text-sm font-bold" style={{ color: 'rgba(220,240,250,0.96)' }}>
          {row.workRvu?.toFixed(2)}
        </p>
        <p className="text-[10px]" style={{ color: 'var(--theme-text-disabled)' }}>
          wRVU
        </p>
      </div>

      <div
        className="flex h-8 w-8 items-center justify-center rounded-md text-sm font-bold"
        style={{
          background: inQueue ? 'rgba(16,185,129,0.18)' : 'rgba(91,184,212,0.08)',
          border: inQueue ? '1px solid rgba(16,185,129,0.36)' : '1px solid rgba(91,184,212,0.16)',
          color: inQueue ? '#6ee7b7' : '#9be8ff',
        }}
      >
        {inQueue ? 'OK' : '+'}
      </div>
    </button>
  );
}

interface LogPanelProps {
  selectedRows: CptRvuRow[];
  onRemove: (id: string) => void;
  onLog: (date: string, notes: string) => Promise<void>;
  logging: boolean;
}

function LogPanel({ selectedRows, onRemove, onLog, logging }: LogPanelProps) {
  const [logDate, setLogDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [success, setSuccess] = useState(false);

  const totalRvu = selectedRows.reduce((sum, row) => sum + (row.workRvu ?? 0), 0);

  const handleLog = async () => {
    await onLog(logDate, notes);
    setNotes('');
    setSuccess(true);
    window.setTimeout(() => setSuccess(false), 2200);
  };

  return (
    <aside
      className="flex min-h-0 flex-col gap-3 rounded-lg p-3"
      style={{
        background: 'linear-gradient(180deg, rgba(10,28,52,0.9), rgba(5,14,28,0.92))',
        border: '1px solid rgba(91,184,212,0.12)',
      }}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-bold uppercase" style={{ color: 'rgba(155,232,255,0.82)', letterSpacing: 0 }}>
            Log Queue
          </p>
          <p className="text-[11px]" style={{ color: 'var(--theme-text-disabled)' }}>
            {selectedRows.length} selected
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-lg font-bold" style={{ color: 'rgba(220,240,250,0.96)' }}>
            {totalRvu.toFixed(2)}
          </p>
          <p className="text-[10px]" style={{ color: 'var(--theme-text-disabled)' }}>
            wRVU
          </p>
        </div>
      </div>

      <div className="min-h-[180px] flex-1 overflow-y-auto rounded-md" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
        {selectedRows.length === 0 ? (
          <div className="flex h-full min-h-[180px] items-center justify-center px-5 text-center">
            <p className="text-xs leading-5" style={{ color: 'var(--theme-text-disabled)' }}>
              Search results can be added here for multi-code logging.
            </p>
          </div>
        ) : (
          selectedRows.map((row) => (
            <div
              key={row.id}
              className="grid grid-cols-[minmax(0,1fr)_28px] gap-2 border-b p-2.5"
              style={{ borderColor: 'rgba(255,255,255,0.055)' }}
            >
              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-xs font-bold" style={{ color: '#9be8ff' }}>
                    {row.cptCode}{row.modifier ? `-${row.modifier}` : ''}
                  </span>
                  <span className="font-mono text-xs" style={{ color: 'rgba(220,240,250,0.86)' }}>
                    {row.workRvu?.toFixed(2)}
                  </span>
                </div>
                <p className="mt-1 truncate text-[11px]" style={{ color: 'var(--theme-text-disabled)' }}>
                  {row.description}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onRemove(row.id)}
                className="h-7 w-7 rounded-md text-xs"
                style={{
                  background: 'rgba(244,63,94,0.08)',
                  border: '1px solid rgba(244,63,94,0.18)',
                  color: '#fda4af',
                }}
              >
                X
              </button>
            </div>
          ))
        )}
      </div>

      <div className="grid gap-2">
        <label className="grid gap-1 text-[11px] font-semibold" style={{ color: 'var(--theme-text-disabled)' }}>
          Study Date
          <input
            type="date"
            value={logDate}
            onChange={(event) => setLogDate(event.target.value)}
            className="h-10 rounded-md px-3 text-sm outline-none"
            style={{
              background: 'rgba(255,255,255,0.045)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: 'var(--theme-text-primary)',
              colorScheme: 'dark',
            }}
          />
        </label>

        <label className="grid gap-1 text-[11px] font-semibold" style={{ color: 'var(--theme-text-disabled)' }}>
          Notes
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={3}
            placeholder="Optional accession, case note, or shift context"
            className="rounded-md px-3 py-2 text-sm outline-none"
            style={{
              background: 'rgba(255,255,255,0.045)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: 'var(--theme-text-primary)',
              resize: 'none',
            }}
          />
        </label>
      </div>

      <button
        type="button"
        onClick={handleLog}
        disabled={selectedRows.length === 0 || logging || !logDate}
        className="h-11 rounded-md text-sm font-bold transition-opacity"
        style={{
          background: success
            ? 'rgba(16,185,129,0.85)'
            : selectedRows.length > 0
              ? 'linear-gradient(135deg, #2563a8, #5BB8D4)'
              : 'rgba(255,255,255,0.045)',
          border: selectedRows.length > 0 ? '1px solid rgba(155,232,255,0.32)' : '1px solid rgba(255,255,255,0.08)',
          color: selectedRows.length > 0 ? 'white' : 'var(--theme-text-disabled)',
          opacity: logging ? 0.65 : 1,
        }}
      >
        {logging ? 'Logging...' : success ? 'Studies logged' : `Log ${selectedRows.length || ''} ${selectedRows.length === 1 ? 'study' : 'studies'}`}
      </button>
    </aside>
  );
}

interface CptExplorerProps {
  onNavigate?: (tab: string) => void;
}

export function CptExplorer({ onNavigate }: CptExplorerProps) {
  const { activeProfile } = useProfile();
  const searchRef = useRef<HTMLInputElement>(null);

  const [selectedModality, setSelectedModality] = useState<ModalityFilter>('all');
  const [contrastFilter, setContrastFilter] = useState<ContrastType>('all');
  const [selectedRegion, setSelectedRegion] = useState<BodyRegion | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [queuedRows, setQueuedRows] = useState<CptRvuRow[]>([]);
  const [logging, setLogging] = useState(false);

  const rawRows = useLiveQuery(
    () =>
      db.cptRvuTable
        .where('statusCategory')
        .equals('active')
        .filter((row) => row.pcTcIndicator !== 'technical' && (row.workRvu ?? 0) > 0)
        .toArray(),
    [],
    [],
  );

  const professionalRows = useMemo(() => {
    const byCode = new Map<string, CptRvuRow[]>();
    for (const row of rawRows) {
      const rows = byCode.get(row.cptCode) ?? [];
      rows.push(row);
      byCode.set(row.cptCode, rows);
    }

    const pickedRows: CptRvuRow[] = [];
    for (const rows of byCode.values()) {
      const picked = pickProfessionalRow(rows);
      if (picked) pickedRows.push(picked);
    }

    return pickedRows;
  }, [rawRows]);

  const filteredRows = useMemo(() => {
    const query = searchQuery.trim();
    const rows = professionalRows
      .filter((row) => selectedModality === 'all' || row.modality === selectedModality)
      .filter((row) => !selectedRegion || codeInRegion(row.cptCode, selectedRegion))
      .filter((row) => {
        if (contrastFilter === 'all') return true;
        const contrast = detectContrast(row.description);
        return contrast === contrastFilter || contrast === 'unknown';
      })
      .map((row) => ({ row, score: query ? tokenScore(row, query) : 1 }))
      .filter(({ score }) => !query || score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return (b.row.workRvu ?? 0) - (a.row.workRvu ?? 0);
      })
      .map(({ row }) => row);

    return rows;
  }, [professionalRows, selectedModality, selectedRegion, contrastFilter, searchQuery]);

  const regionCounts = useMemo(() => {
    const counts = {} as Record<BodyRegion, number>;
    const rows = professionalRows
      .filter((row) => selectedModality === 'all' || row.modality === selectedModality)
      .filter((row) => {
        if (contrastFilter === 'all') return true;
        const contrast = detectContrast(row.description);
        return contrast === contrastFilter || contrast === 'unknown';
      });

    for (const region of ALL_REGIONS) {
      counts[region] = rows.filter((row) => codeInRegion(row.cptCode, region)).length;
    }
    return counts;
  }, [professionalRows, selectedModality, contrastFilter]);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [searchQuery, selectedModality, selectedRegion, contrastFilter]);

  useEffect(() => {
    setHighlightedIndex((index) => Math.min(index, Math.max(0, filteredRows.length - 1)));
  }, [filteredRows.length]);

  const addToQueue = useCallback((row: CptRvuRow) => {
    setQueuedRows((previous) => {
      if (previous.some((queued) => rowKey(queued) === rowKey(row))) return previous;
      return [...previous, row];
    });
  }, []);

  const removeFromQueue = useCallback((id: string) => {
    setQueuedRows((previous) => previous.filter((row) => row.id !== id));
  }, []);

  const resetFilters = useCallback(() => {
    setSelectedModality('all');
    setContrastFilter('all');
    setSelectedRegion(null);
  }, []);

  const clearSearchAndFilters = useCallback(() => {
    setSearchQuery('');
    resetFilters();
  }, [resetFilters]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        clearSearchAndFilters();
        return;
      }

      const activeTag = document.activeElement?.tagName;
      const isTyping = activeTag === 'INPUT' || activeTag === 'TEXTAREA';
      if (!isTyping && event.key.length === 1) return;

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setHighlightedIndex((index) => Math.min(index + 1, Math.max(0, filteredRows.length - 1)));
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setHighlightedIndex((index) => Math.max(index - 1, 0));
        return;
      }

      if (event.key === 'Enter' && filteredRows[highlightedIndex]) {
        event.preventDefault();
        addToQueue(filteredRows[highlightedIndex]);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [addToQueue, clearSearchAndFilters, filteredRows, highlightedIndex]);

  const handleLog = useCallback(
    async (logDate: string, notes: string) => {
      if (queuedRows.length === 0) return;
      setLogging(true);
      try {
        const sessionId = crypto.randomUUID();
        const now = new Date().toISOString();
        for (const row of queuedRows) {
          const examNameRaw = row.description;
          const fp = buildFingerprint(examNameRaw, row.cptCode, logDate, null, null, row.modality);
          const existing = await db.studyLogs.where('studyFingerprint').equals(fp).first();
          if (existing) continue;

          const logRow: StudyLog = {
            id: crypto.randomUUID(),
            profileId: activeProfile?.id ?? null,
            logDate,
            studyDateTime: null,
            studyDate: logDate,
            dateTimeConfidence: 1.0,
            dateTimeSource: 'manual',
            examNameRaw,
            cptCode: row.cptCode,
            modifier: row.modifier,
            workRvu: row.workRvu,
            modality: row.modality,
            matchMethod: 'manual_cpt',
            matchConfidence: 1.0,
            needsReview: false,
            accessionNumber: null,
            sessionId,
            sourceImportId: 'cpt_explorer',
            notes: notes.trim() || null,
            studyFingerprint: fp,
            createdAt: now,
            updatedAt: now,
          };
          await db.studyLogs.add(logRow);
        }
        setQueuedRows([]);
      } finally {
        setLogging(false);
      }
    },
    [queuedRows, activeProfile],
  );

  const currentRow = filteredRows[highlightedIndex] ?? null;
  const totalRvuShown = filteredRows.reduce((sum, row) => sum + (row.workRvu ?? 0), 0);
  const emptyDatabase = professionalRows.length === 0;

  return (
    <div className="flex h-full min-h-[720px] flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--theme-text-primary)', letterSpacing: 0 }}>
            CPT Explorer
          </h1>
          <p className="text-sm" style={{ color: 'var(--theme-text-disabled)' }}>
            Search, select, and log professional-component CPT work RVUs.
          </p>
        </div>

        {emptyDatabase && (
          <div
            className="rounded-md px-3 py-2 text-xs"
            style={{
              background: 'rgba(245,158,11,0.07)',
              border: '1px solid rgba(245,158,11,0.22)',
              color: 'var(--theme-caution)',
            }}
          >
            No billable CPT rows loaded.{' '}
            <button type="button" className="font-semibold underline" onClick={() => onNavigate?.('import')}>
              Import CMS RVU file
            </button>
          </div>
        )}
      </div>

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[220px_minmax(0,1fr)_320px]">
        <FilterRail
          selectedModality={selectedModality}
          setSelectedModality={setSelectedModality}
          contrastFilter={contrastFilter}
          setContrastFilter={setContrastFilter}
          selectedRegion={selectedRegion}
          setSelectedRegion={setSelectedRegion}
          regionCounts={regionCounts}
          resetFilters={resetFilters}
        />

        <main
          className="flex min-h-0 flex-col overflow-hidden rounded-lg"
          style={{
            background: 'linear-gradient(180deg, rgba(8,25,48,0.9), rgba(4,12,24,0.94))',
            border: '1px solid rgba(91,184,212,0.14)',
          }}
        >
          <div className="border-b p-4" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
            <div
              className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-lg px-4 py-3"
              style={{
                background: 'rgba(255,255,255,0.055)',
                border: '1px solid rgba(91,184,212,0.24)',
                boxShadow: '0 0 0 1px rgba(91,184,212,0.04), 0 18px 60px rgba(0,0,0,0.22)',
              }}
            >
              <input
                ref={searchRef}
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search stroke, CTA head neck, PE, MRCP, liver MRI, thyroid ultrasound..."
                className="h-11 min-w-0 bg-transparent text-lg font-semibold outline-none"
                style={{ color: 'var(--theme-text-primary)' }}
                autoComplete="off"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="rounded-md px-2.5 py-1.5 text-xs font-semibold"
                  style={{
                    background: 'rgba(255,255,255,0.06)',
                    color: 'var(--theme-text-muted)',
                  }}
                >
                  Clear
                </button>
              )}
            </div>

            <div className="mt-3 grid gap-2 text-xs md:grid-cols-4" style={{ color: 'var(--theme-text-disabled)' }}>
              <div>
                <span style={{ color: 'var(--theme-text-muted)' }}>{filteredRows.length}</span> results
              </div>
              <div>{modalityLabel(selectedModality)}</div>
              <div>{selectedRegion ? REGION_META[selectedRegion].label : 'All anatomy'}</div>
              <div>
                <span style={{ color: 'var(--theme-text-muted)' }}>{totalRvuShown.toFixed(1)}</span> visible wRVU
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {filteredRows.length === 0 ? (
              <div className="flex h-full min-h-[360px] items-center justify-center px-6 text-center">
                <div>
                  <p className="text-sm font-semibold" style={{ color: 'var(--theme-text-primary)' }}>
                    No CPT rows match the current search.
                  </p>
                  <p className="mt-2 text-xs" style={{ color: 'var(--theme-text-disabled)' }}>
                    Try a modality, CPT code, protocol term, anatomy term, or clear filters.
                  </p>
                </div>
              </div>
            ) : (
              filteredRows.map((row, index) => (
                <ResultRow
                  key={row.id}
                  row={row}
                  index={index}
                  highlighted={index === highlightedIndex}
                  inQueue={queuedRows.some((queued) => rowKey(queued) === rowKey(row))}
                  onAdd={() => addToQueue(row)}
                  onRemove={() => removeFromQueue(row.id)}
                  onHover={() => setHighlightedIndex(index)}
                />
              ))
            )}
          </div>

          <div
            className="grid gap-2 border-t px-4 py-3 text-xs md:grid-cols-[minmax(0,1fr)_auto]"
            style={{ borderColor: 'rgba(255,255,255,0.06)', color: 'var(--theme-text-disabled)' }}
          >
            <div className="truncate">
              {currentRow
                ? `${currentRow.cptCode}${currentRow.modifier ? `-${currentRow.modifier}` : ''} - ${currentRow.description}`
                : 'No highlighted result'}
            </div>
            <div className="font-mono">
              {currentRow?.workRvu != null ? `${currentRow.workRvu.toFixed(2)} wRVU` : ''}
            </div>
          </div>
        </main>

        <LogPanel
          selectedRows={queuedRows}
          onRemove={removeFromQueue}
          onLog={handleLog}
          logging={logging}
        />
      </div>
    </div>
  );
}
