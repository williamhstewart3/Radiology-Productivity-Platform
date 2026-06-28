/**
 * CptExplorer.tsx
 *
 * Interactive CPT code explorer with anatomical body map, modality / contrast
 * filters, CPT list, and direct study logging.
 *
 * Layout (desktop): [CPT List 280px] | [Body Map 400px] | [Log Panel 320px]
 * Layout (mobile):  stacked, body map first
 */

import { useState, useCallback, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';
import { buildFingerprint } from '../utils/duplicateDetection';
import { useProfile } from '../hooks/useProfile';
import type { CptRvuRow, Modality, StudyLog } from '../types';
import { MODALITY_LABELS } from '../types';

// ─── Body region taxonomy ─────────────────────────────────────────────────────

type BodyRegion =
  | 'HEAD_NECK'
  | 'CHEST'
  | 'ABDOMEN'
  | 'PELVIS'
  | 'SPINE'
  | 'UPPER_EXT'
  | 'LOWER_EXT'
  | 'BREAST';

interface RegionMeta {
  label: string;
  ranges: [number, number][];
}

const REGION_META: Record<BodyRegion, RegionMeta> = {
  HEAD_NECK: {
    label: 'Head & Neck',
    ranges: [
      [70450, 70498],
      [70540, 70559],
      [70010, 70110],
    ],
  },
  CHEST: {
    label: 'Chest',
    ranges: [
      [71250, 71275],
      [71550, 71555],
      [71045, 71048],
    ],
  },
  ABDOMEN: {
    label: 'Abdomen',
    ranges: [
      [74150, 74178],
      [74181, 74183],
      [76700, 76776],
    ],
  },
  PELVIS: {
    label: 'Pelvis',
    ranges: [
      [72191, 72194],
      [72195, 72198],
    ],
  },
  SPINE: {
    label: 'Spine',
    ranges: [
      [72125, 72133],
      [72141, 72159],
    ],
  },
  UPPER_EXT: {
    label: 'Upper Extremity',
    ranges: [
      [73200, 73225],
      [73218, 73225],
    ],
  },
  LOWER_EXT: {
    label: 'Lower Extremity',
    ranges: [
      [73700, 73725],
      [73718, 73725],
    ],
  },
  BREAST: {
    label: 'Breast',
    ranges: [[77046, 77067]],
  },
};

const ALL_REGIONS = Object.keys(REGION_META) as BodyRegion[];

function codeInRegion(cptCode: string, region: BodyRegion): boolean {
  const num = parseInt(cptCode, 10);
  if (isNaN(num)) return false;
  return REGION_META[region].ranges.some(([lo, hi]) => num >= lo && num <= hi);
}

// ─── Contrast detection from description ─────────────────────────────────────

type ContrastType = 'all' | 'without' | 'with' | 'both';

function detectContrast(description: string): 'without' | 'with' | 'both' | 'unknown' {
  const d = description.toLowerCase();
  if (d.includes('w/o and w/') || d.includes('without and with') || d.includes('w & w/o')) return 'both';
  if (d.includes('w/o contrast') || d.includes('without contrast')) return 'without';
  if (d.includes('w/ contrast') || d.includes('with contrast') || d.match(/\bw\/ /)) return 'with';
  if (d.endsWith(' w/o')) return 'without';
  if (d.endsWith(' w/')) return 'with';
  return 'unknown';
}

// ─── Professional row preference ─────────────────────────────────────────────

/**
 * Given all rows for a CPT code, return the single "best professional" row.
 * Prefer modifier='26', fall back to global if no '26' row.
 * Filter out technical-only rows.
 */
function pickProfessionalRow(rows: CptRvuRow[]): CptRvuRow | null {
  const nonTech = rows.filter((r) => r.pcTcIndicator !== 'technical');
  if (nonTech.length === 0) return null;
  const mod26 = nonTech.find((r) => r.modifier === '26');
  return mod26 ?? nonTech[0];
}

// ─── SVG Body Map ─────────────────────────────────────────────────────────────

interface BodyMapProps {
  selectedRegion: BodyRegion | null;
  onSelect: (region: BodyRegion) => void;
  regionCounts: Record<BodyRegion, number>;
}

// Each region gets a clickable overlay path/rect
function BodyMap({ selectedRegion, onSelect, regionCounts }: BodyMapProps) {
  const hasData = (r: BodyRegion) => regionCounts[r] > 0;
  const isSelected = (r: BodyRegion) => selectedRegion === r;

  const regionFill = (r: BodyRegion) => {
    if (isSelected(r)) return 'rgba(37,99,168,0.55)';
    if (hasData(r)) return 'rgba(91,184,212,0.15)';
    return 'rgba(91,184,212,0.04)';
  };

  const regionStroke = (r: BodyRegion) => {
    if (isSelected(r)) return '#2563A8';
    if (hasData(r)) return 'rgba(91,184,212,0.5)';
    return 'rgba(91,184,212,0.15)';
  };

  return (
    <svg
      viewBox="0 0 200 480"
      width="200"
      height="480"
      style={{ display: 'block', margin: '0 auto' }}
    >
      {/* ── Silhouette body outline ── */}
      {/* Head */}
      <ellipse cx="100" cy="34" rx="22" ry="26" fill="rgba(91,184,212,0.07)" stroke="rgba(91,184,212,0.25)" strokeWidth="1.2" />
      {/* Neck */}
      <rect x="91" y="58" width="18" height="14" rx="4" fill="rgba(91,184,212,0.07)" stroke="rgba(91,184,212,0.2)" strokeWidth="1" />
      {/* Torso */}
      <path d="M62,72 Q58,90 56,130 L56,240 Q58,250 100,252 Q142,250 144,240 L144,130 Q142,90 138,72 Z"
        fill="rgba(91,184,212,0.07)" stroke="rgba(91,184,212,0.2)" strokeWidth="1.2" />
      {/* Left arm */}
      <path d="M62,78 Q44,100 40,150 Q38,170 42,185 Q46,195 54,188 Q58,175 60,155 Q62,130 64,108 Z"
        fill="rgba(91,184,212,0.07)" stroke="rgba(91,184,212,0.2)" strokeWidth="1" />
      {/* Right arm */}
      <path d="M138,78 Q156,100 160,150 Q162,170 158,185 Q154,195 146,188 Q142,175 140,155 Q138,130 136,108 Z"
        fill="rgba(91,184,212,0.07)" stroke="rgba(91,184,212,0.2)" strokeWidth="1" />
      {/* Left leg */}
      <path d="M72,250 Q68,290 66,340 Q64,370 66,400 Q68,415 76,415 Q84,415 86,400 Q88,370 88,340 Q88,290 88,250 Z"
        fill="rgba(91,184,212,0.07)" stroke="rgba(91,184,212,0.2)" strokeWidth="1" />
      {/* Right leg */}
      <path d="M128,250 Q132,290 134,340 Q136,370 134,400 Q132,415 124,415 Q116,415 114,400 Q112,370 112,340 Q112,290 112,250 Z"
        fill="rgba(91,184,212,0.07)" stroke="rgba(91,184,212,0.2)" strokeWidth="1" />

      {/* ── Clickable region overlays ── */}

      {/* HEAD_NECK */}
      <g onClick={() => onSelect('HEAD_NECK')} style={{ cursor: 'pointer' }}>
        <ellipse cx="100" cy="34" rx="22" ry="26"
          fill={regionFill('HEAD_NECK')} stroke={regionStroke('HEAD_NECK')} strokeWidth={isSelected('HEAD_NECK') ? 2 : 1.2} />
        <rect x="91" y="58" width="18" height="14" rx="4"
          fill={regionFill('HEAD_NECK')} stroke={regionStroke('HEAD_NECK')} strokeWidth={isSelected('HEAD_NECK') ? 2 : 1} />
        {hasData('HEAD_NECK') && (
          <circle cx="118" cy="14" r="8" fill="var(--theme-accent)" opacity="0.9" />
        )}
        {hasData('HEAD_NECK') && (
          <text x="118" y="18" textAnchor="middle" fontSize="8" fill="white" fontWeight="bold">
            {regionCounts['HEAD_NECK']}
          </text>
        )}
      </g>

      {/* CHEST */}
      <g onClick={() => onSelect('CHEST')} style={{ cursor: 'pointer' }}>
        <rect x="58" y="72" width="84" height="52" rx="4"
          fill={regionFill('CHEST')} stroke={regionStroke('CHEST')} strokeWidth={isSelected('CHEST') ? 2 : 1} />
        {hasData('CHEST') && (
          <circle cx="148" cy="76" r="8" fill="var(--theme-accent)" opacity="0.9" />
        )}
        {hasData('CHEST') && (
          <text x="148" y="80" textAnchor="middle" fontSize="8" fill="white" fontWeight="bold">
            {regionCounts['CHEST']}
          </text>
        )}
      </g>

      {/* ABDOMEN */}
      <g onClick={() => onSelect('ABDOMEN')} style={{ cursor: 'pointer' }}>
        <rect x="58" y="126" width="84" height="64" rx="4"
          fill={regionFill('ABDOMEN')} stroke={regionStroke('ABDOMEN')} strokeWidth={isSelected('ABDOMEN') ? 2 : 1} />
        {hasData('ABDOMEN') && (
          <circle cx="148" cy="130" r="8" fill="var(--theme-accent)" opacity="0.9" />
        )}
        {hasData('ABDOMEN') && (
          <text x="148" y="134" textAnchor="middle" fontSize="8" fill="white" fontWeight="bold">
            {regionCounts['ABDOMEN']}
          </text>
        )}
      </g>

      {/* PELVIS */}
      <g onClick={() => onSelect('PELVIS')} style={{ cursor: 'pointer' }}>
        <rect x="58" y="192" width="84" height="50" rx="4"
          fill={regionFill('PELVIS')} stroke={regionStroke('PELVIS')} strokeWidth={isSelected('PELVIS') ? 2 : 1} />
        {hasData('PELVIS') && (
          <circle cx="148" cy="196" r="8" fill="var(--theme-accent)" opacity="0.9" />
        )}
        {hasData('PELVIS') && (
          <text x="148" y="200" textAnchor="middle" fontSize="8" fill="white" fontWeight="bold">
            {regionCounts['PELVIS']}
          </text>
        )}
      </g>

      {/* SPINE (behind torso — draw on left side) */}
      <g onClick={() => onSelect('SPINE')} style={{ cursor: 'pointer' }}>
        <rect x="38" y="80" width="18" height="170" rx="5"
          fill={regionFill('SPINE')} stroke={regionStroke('SPINE')} strokeWidth={isSelected('SPINE') ? 2 : 1} />
        {hasData('SPINE') && (
          <circle cx="30" cy="84" r="8" fill="var(--theme-accent)" opacity="0.9" />
        )}
        {hasData('SPINE') && (
          <text x="30" y="88" textAnchor="middle" fontSize="8" fill="white" fontWeight="bold">
            {regionCounts['SPINE']}
          </text>
        )}
        <text x="47" y="170" textAnchor="middle" fontSize="7" fill="rgba(91,184,212,0.5)" style={{ pointerEvents: 'none' }}>
          SP
        </text>
      </g>

      {/* UPPER_EXT (arms) */}
      <g onClick={() => onSelect('UPPER_EXT')} style={{ cursor: 'pointer' }}>
        <path d="M40,90 Q38,110 38,150 Q40,170 46,180 Q52,188 56,182 Q54,165 54,145 Q52,115 50,90 Z"
          fill={regionFill('UPPER_EXT')} stroke={regionStroke('UPPER_EXT')} strokeWidth={isSelected('UPPER_EXT') ? 2 : 1} />
        <path d="M160,90 Q162,110 162,150 Q160,170 154,180 Q148,188 144,182 Q146,165 146,145 Q148,115 150,90 Z"
          fill={regionFill('UPPER_EXT')} stroke={regionStroke('UPPER_EXT')} strokeWidth={isSelected('UPPER_EXT') ? 2 : 1} />
        {hasData('UPPER_EXT') && (
          <circle cx="170" cy="110" r="8" fill="var(--theme-accent)" opacity="0.9" />
        )}
        {hasData('UPPER_EXT') && (
          <text x="170" y="114" textAnchor="middle" fontSize="8" fill="white" fontWeight="bold">
            {regionCounts['UPPER_EXT']}
          </text>
        )}
      </g>

      {/* LOWER_EXT (legs) */}
      <g onClick={() => onSelect('LOWER_EXT')} style={{ cursor: 'pointer' }}>
        <path d="M68,252 Q64,300 64,350 Q64,380 68,410 Q72,420 80,418 Q88,416 88,405 Q88,375 88,345 Q88,295 90,252 Z"
          fill={regionFill('LOWER_EXT')} stroke={regionStroke('LOWER_EXT')} strokeWidth={isSelected('LOWER_EXT') ? 2 : 1} />
        <path d="M132,252 Q136,300 136,350 Q136,380 132,410 Q128,420 120,418 Q112,416 112,405 Q112,375 112,345 Q112,295 110,252 Z"
          fill={regionFill('LOWER_EXT')} stroke={regionStroke('LOWER_EXT')} strokeWidth={isSelected('LOWER_EXT') ? 2 : 1} />
        {hasData('LOWER_EXT') && (
          <circle cx="148" cy="258" r="8" fill="var(--theme-accent)" opacity="0.9" />
        )}
        {hasData('LOWER_EXT') && (
          <text x="148" y="262" textAnchor="middle" fontSize="8" fill="white" fontWeight="bold">
            {regionCounts['LOWER_EXT']}
          </text>
        )}
      </g>

      {/* BREAST (small overlay on chest) */}
      <g onClick={() => onSelect('BREAST')} style={{ cursor: 'pointer' }}>
        <ellipse cx="86" cy="110" rx="12" ry="10"
          fill={regionFill('BREAST')} stroke={regionStroke('BREAST')} strokeWidth={isSelected('BREAST') ? 2 : 1} />
        <ellipse cx="114" cy="110" rx="12" ry="10"
          fill={regionFill('BREAST')} stroke={regionStroke('BREAST')} strokeWidth={isSelected('BREAST') ? 2 : 1} />
        {hasData('BREAST') && (
          <circle cx="55" cy="108" r="8" fill="var(--theme-accent)" opacity="0.9" />
        )}
        {hasData('BREAST') && (
          <text x="55" y="112" textAnchor="middle" fontSize="8" fill="white" fontWeight="bold">
            {regionCounts['BREAST']}
          </text>
        )}
      </g>

      {/* Region labels */}
      <text x="100" y="34" textAnchor="middle" fontSize="6.5" fill="rgba(91,184,212,0.45)" style={{ pointerEvents: 'none' }}>Head</text>
      <text x="100" y="103" textAnchor="middle" fontSize="6.5" fill="rgba(91,184,212,0.45)" style={{ pointerEvents: 'none' }}>Chest</text>
      <text x="100" y="162" textAnchor="middle" fontSize="6.5" fill="rgba(91,184,212,0.45)" style={{ pointerEvents: 'none' }}>Abdomen</text>
      <text x="100" y="220" textAnchor="middle" fontSize="6.5" fill="rgba(91,184,212,0.45)" style={{ pointerEvents: 'none' }}>Pelvis</text>
      <text x="80" y="340" textAnchor="middle" fontSize="6.5" fill="rgba(91,184,212,0.45)" style={{ pointerEvents: 'none' }}>Leg</text>
      <text x="120" y="340" textAnchor="middle" fontSize="6.5" fill="rgba(91,184,212,0.45)" style={{ pointerEvents: 'none' }}>Leg</text>
    </svg>
  );
}

// ─── Log Panel ────────────────────────────────────────────────────────────────

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

  const totalRvu = selectedRows.reduce((sum, r) => sum + (r.workRvu ?? 0), 0);

  const handleLog = async () => {
    await onLog(logDate, notes);
    setNotes('');
    setSuccess(true);
    setTimeout(() => setSuccess(false), 2500);
  };

  return (
    <div className="flex flex-col h-full gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--theme-text-muted)' }}>
          Log Queue
        </p>
        {selectedRows.length > 0 && (
          <span className="text-xs font-bold px-2 py-0.5 rounded-full"
            style={{ background: 'rgba(37,99,168,0.2)', color: 'var(--theme-accent)' }}>
            {selectedRows.length} study{selectedRows.length > 1 ? 'ies' : ''}
          </span>
        )}
      </div>

      {/* Queue list */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-2" style={{ maxHeight: '280px' }}>
        {selectedRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 gap-2">
            <div className="text-3xl opacity-30">📋</div>
            <p className="text-xs text-center" style={{ color: 'var(--theme-text-disabled)' }}>
              Click + next to a CPT code<br />to add it here
            </p>
          </div>
        ) : (
          selectedRows.map((row) => (
            <div
              key={row.id}
              className="flex items-start gap-2 p-2 rounded-lg"
              style={{ background: 'var(--theme-bg-card)', border: '1px solid var(--theme-border)' }}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-mono font-bold" style={{ color: 'var(--theme-accent)' }}>
                    {row.cptCode}{row.modifier ? `-${row.modifier}` : ''}
                  </span>
                  <span className="text-xs font-semibold" style={{ color: 'var(--theme-normal)' }}>
                    {row.workRvu?.toFixed(2) ?? '—'} wRVU
                  </span>
                </div>
                <p className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--theme-text-muted)' }}>
                  {row.description}
                </p>
              </div>
              <button
                onClick={() => onRemove(row.id)}
                className="text-xs px-1.5 py-0.5 rounded transition-colors shrink-0"
                style={{ color: 'var(--theme-text-disabled)', background: 'transparent' }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--theme-behind)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--theme-text-disabled)'; }}
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>

      {/* Total */}
      {selectedRows.length > 0 && (
        <div className="flex items-center justify-between px-2 py-1.5 rounded-lg"
          style={{ background: 'rgba(37,99,168,0.12)', border: '1px solid rgba(37,99,168,0.2)' }}>
          <span className="text-xs font-semibold" style={{ color: 'var(--theme-text-muted)' }}>
            Total wRVU
          </span>
          <span className="text-sm font-bold" style={{ color: 'var(--theme-normal)' }}>
            {totalRvu.toFixed(2)}
          </span>
        </div>
      )}

      {/* Date + notes */}
      <div className="space-y-2">
        <div>
          <label className="text-xs font-medium block mb-1" style={{ color: 'var(--theme-text-muted)' }}>
            Study Date
          </label>
          <input
            type="date"
            value={logDate}
            onChange={(e) => setLogDate(e.target.value)}
            className="w-full text-sm px-2.5 py-1.5 rounded-lg outline-none"
            style={{
              background: 'var(--theme-bg-input)',
              border: '1px solid var(--theme-border)',
              color: 'var(--theme-text-primary)',
            }}
          />
        </div>
        <div>
          <label className="text-xs font-medium block mb-1" style={{ color: 'var(--theme-text-muted)' }}>
            Notes <span style={{ color: 'var(--theme-text-disabled)' }}>(optional)</span>
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="e.g. Accession 12345"
            className="w-full text-sm px-2.5 py-1.5 rounded-lg outline-none resize-none"
            style={{
              background: 'var(--theme-bg-input)',
              border: '1px solid var(--theme-border)',
              color: 'var(--theme-text-primary)',
            }}
          />
        </div>
      </div>

      {/* Log button */}
      <button
        onClick={handleLog}
        disabled={selectedRows.length === 0 || logging || !logDate}
        className="w-full py-2.5 rounded-xl text-sm font-semibold transition-all"
        style={{
          background: success
            ? 'var(--theme-normal)'
            : selectedRows.length > 0
              ? 'var(--theme-accent)'
              : 'var(--theme-bg-card)',
          color: selectedRows.length > 0 ? 'white' : 'var(--theme-text-disabled)',
          border: 'none',
          opacity: logging ? 0.6 : 1,
        }}
      >
        {logging ? 'Logging…' : success ? '✓ Logged!' : `Log ${selectedRows.length > 0 ? selectedRows.length : ''} Stud${selectedRows.length === 1 ? 'y' : 'ies'}`}
      </button>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

interface CptExplorerProps {
  onNavigate?: (tab: string) => void;
}

const MODALITIES_FOR_FILTER: Modality[] = ['CT', 'MRI', 'US', 'XR', 'NM_PET', 'MAMMO', 'FLUORO'];
const CONTRAST_OPTIONS: { id: ContrastType; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'without', label: 'w/o' },
  { id: 'with', label: 'w/' },
  { id: 'both', label: 'w/ & w/o' },
];

export function CptExplorer({ onNavigate }: CptExplorerProps) {
  const { activeProfile } = useProfile();

  const [selectedModality, setSelectedModality] = useState<Modality>('CT');
  const [contrastFilter, setContrastFilter] = useState<ContrastType>('all');
  const [selectedRegion, setSelectedRegion] = useState<BodyRegion | null>(null);
  const [queuedRows, setQueuedRows] = useState<CptRvuRow[]>([]);
  const [logging, setLogging] = useState(false);

  // Live query — all rows for the selected modality
  const rawRows = useLiveQuery(
    () =>
      db.cptRvuTable
        .where('modality')
        .equals(selectedModality)
        .filter((r) => r.pcTcIndicator !== 'technical' && r.statusCategory === 'active')
        .toArray(),
    [selectedModality],
    [],
  );

  // Deduplicate: keep one professional row per CPT code
  const dedupedRows = useMemo(() => {
    const byCode = new Map<string, CptRvuRow[]>();
    for (const row of rawRows) {
      const arr = byCode.get(row.cptCode) ?? [];
      arr.push(row);
      byCode.set(row.cptCode, arr);
    }
    const result: CptRvuRow[] = [];
    for (const rows of byCode.values()) {
      const picked = pickProfessionalRow(rows);
      if (picked) result.push(picked);
    }
    return result.sort((a, b) => (b.workRvu ?? 0) - (a.workRvu ?? 0));
  }, [rawRows]);

  // Apply contrast filter
  const contrastFiltered = useMemo(() => {
    if (contrastFilter === 'all') return dedupedRows;
    return dedupedRows.filter((r) => {
      const c = detectContrast(r.description);
      return c === contrastFilter || c === 'unknown';
    });
  }, [dedupedRows, contrastFilter]);

  // Apply region filter
  const regionFiltered = useMemo(() => {
    if (!selectedRegion) return contrastFiltered;
    return contrastFiltered.filter((r) => codeInRegion(r.cptCode, selectedRegion));
  }, [contrastFiltered, selectedRegion]);

  // Count per region (for badge display on body map)
  const regionCounts = useMemo(() => {
    const counts = {} as Record<BodyRegion, number>;
    for (const region of ALL_REGIONS) {
      counts[region] = contrastFiltered.filter((r) => codeInRegion(r.cptCode, region)).length;
    }
    return counts;
  }, [contrastFiltered]);

  const addToQueue = useCallback((row: CptRvuRow) => {
    setQueuedRows((prev) => {
      if (prev.find((r) => r.id === row.id)) return prev;
      return [...prev, row];
    });
  }, []);

  const removeFromQueue = useCallback((id: string) => {
    setQueuedRows((prev) => prev.filter((r) => r.id !== id));
  }, []);

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

          // Dupe check
          const existing = await db.studyLogs
            .where('studyFingerprint')
            .equals(fp)
            .first();
          if (existing) continue; // skip exact dupe

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

  const totalInDb = dedupedRows.length;

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--theme-text-primary)' }}>
            CPT Explorer
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--theme-text-muted)' }}>
            Browse codes by body region, filter by modality & contrast, log studies directly.
          </p>
        </div>
        {totalInDb === 0 && (
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
            style={{
              background: 'rgba(245,158,11,0.08)',
              border: '1px solid rgba(245,158,11,0.25)',
              color: 'var(--theme-caution)',
            }}
          >
            <span>⚠</span>
            <span>
              No {MODALITY_LABELS[selectedModality]} codes found.{' '}
              <button
                className="underline font-medium"
                onClick={() => onNavigate?.('import')}
              >
                Import CMS RVU file
              </button>{' '}
              in Settings to populate.
            </span>
          </div>
        )}
      </div>

      {/* ── Filter bar ── */}
      <div className="flex flex-wrap gap-3 items-center">
        {/* Modality pills */}
        <div className="flex flex-wrap gap-1.5">
          {MODALITIES_FOR_FILTER.map((m) => (
            <button
              key={m}
              onClick={() => setSelectedModality(m)}
              className="px-3 py-1 rounded-full text-xs font-medium transition-all"
              style={{
                background: selectedModality === m ? 'var(--theme-accent)' : 'var(--theme-bg-card)',
                color: selectedModality === m ? 'white' : 'var(--theme-text-muted)',
                border: selectedModality === m
                  ? '1px solid var(--theme-accent)'
                  : '1px solid var(--theme-border)',
              }}
            >
              {m}
            </button>
          ))}
        </div>

        <div style={{ width: '1px', height: '20px', background: 'var(--theme-border)' }} />

        {/* Contrast pills */}
        <div className="flex gap-1.5">
          {CONTRAST_OPTIONS.map((c) => (
            <button
              key={c.id}
              onClick={() => setContrastFilter(c.id)}
              className="px-2.5 py-1 rounded-full text-xs font-medium transition-all"
              style={{
                background: contrastFilter === c.id ? 'rgba(91,184,212,0.18)' : 'var(--theme-bg-card)',
                color: contrastFilter === c.id ? 'var(--theme-accent)' : 'var(--theme-text-muted)',
                border: contrastFilter === c.id
                  ? '1px solid rgba(91,184,212,0.4)'
                  : '1px solid var(--theme-border)',
              }}
            >
              {c.label}
            </button>
          ))}
        </div>

        <span className="text-xs ml-auto" style={{ color: 'var(--theme-text-disabled)' }}>
          {regionFiltered.length} code{regionFiltered.length !== 1 ? 's' : ''}
          {selectedRegion ? ` in ${REGION_META[selectedRegion].label}` : ''}
        </span>
      </div>

      {/* ── Three-column layout ── */}
      <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(260px,280px) 1fr minmax(280px,320px)' }}>

        {/* ── LEFT: CPT list ── */}
        <div
          className="rounded-xl overflow-hidden"
          style={{
            background: 'var(--theme-bg-card)',
            border: '1px solid var(--theme-border)',
          }}
        >
          {/* Region quick-jump */}
          <div className="px-3 pt-3 pb-2 border-b" style={{ borderColor: 'var(--theme-border)' }}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--theme-text-muted)' }}>
                {selectedRegion ? REGION_META[selectedRegion].label : 'All Regions'}
              </p>
              {selectedRegion && (
                <button
                  onClick={() => setSelectedRegion(null)}
                  className="text-xs"
                  style={{ color: 'var(--theme-text-disabled)' }}
                >
                  Clear
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1">
              {ALL_REGIONS.map((r) => (
                <button
                  key={r}
                  onClick={() => setSelectedRegion(selectedRegion === r ? null : r)}
                  className="text-[10px] px-1.5 py-0.5 rounded-md transition-all"
                  style={{
                    background: selectedRegion === r ? 'var(--theme-accent)' : 'rgba(91,184,212,0.07)',
                    color: selectedRegion === r ? 'white' : regionCounts[r] > 0 ? 'var(--theme-text-muted)' : 'var(--theme-text-disabled)',
                    border: '1px solid transparent',
                  }}
                >
                  {REGION_META[r].label.split(' ')[0]}
                  {regionCounts[r] > 0 && (
                    <span className="ml-0.5 opacity-70">{regionCounts[r]}</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Code list */}
          <div className="overflow-y-auto" style={{ maxHeight: '520px' }}>
            {regionFiltered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3 px-4 text-center">
                <div className="text-3xl opacity-30">🔍</div>
                <p className="text-sm" style={{ color: 'var(--theme-text-muted)' }}>
                  {totalInDb === 0
                    ? `No ${MODALITY_LABELS[selectedModality]} codes in database`
                    : `No codes match current filters`}
                </p>
                {totalInDb === 0 && (
                  <button
                    onClick={() => onNavigate?.('import')}
                    className="text-xs underline"
                    style={{ color: 'var(--theme-accent)' }}
                  >
                    Import RVU file →
                  </button>
                )}
              </div>
            ) : (
              regionFiltered.map((row) => {
                const inQueue = queuedRows.some((r) => r.id === row.id);
                const contrast = detectContrast(row.description);
                return (
                  <div
                    key={row.id}
                    className="flex items-center gap-2 px-3 py-2.5 border-b transition-colors"
                    style={{
                      borderColor: 'var(--theme-border)',
                      background: inQueue ? 'rgba(37,99,168,0.08)' : 'transparent',
                    }}
                    onMouseEnter={(e) => {
                      if (!inQueue) (e.currentTarget as HTMLElement).style.background = 'rgba(91,184,212,0.04)';
                    }}
                    onMouseLeave={(e) => {
                      if (!inQueue) (e.currentTarget as HTMLElement).style.background = 'transparent';
                    }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-mono font-bold" style={{ color: 'var(--theme-accent)' }}>
                          {row.cptCode}
                          {row.modifier ? (
                            <span style={{ color: 'var(--theme-text-disabled)' }}>-{row.modifier}</span>
                          ) : null}
                        </span>
                        {contrast !== 'unknown' && (
                          <span
                            className="text-[9px] px-1 py-0.5 rounded font-medium"
                            style={{
                              background:
                                contrast === 'both'
                                  ? 'rgba(168,85,247,0.12)'
                                  : contrast === 'with'
                                    ? 'rgba(59,130,246,0.12)'
                                    : 'rgba(107,114,128,0.12)',
                              color:
                                contrast === 'both'
                                  ? '#a855f7'
                                  : contrast === 'with'
                                    ? '#60a5fa'
                                    : 'var(--theme-text-disabled)',
                            }}
                          >
                            {contrast === 'both' ? 'w/ & w/o' : contrast === 'with' ? 'w/' : 'w/o'}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] mt-0.5 leading-tight truncate" style={{ color: 'var(--theme-text-muted)' }}>
                        {row.description}
                      </p>
                      <span className="text-[10px] font-semibold" style={{ color: 'var(--theme-normal)' }}>
                        {row.workRvu?.toFixed(2) ?? '—'} wRVU
                      </span>
                    </div>
                    <button
                      onClick={() => (inQueue ? removeFromQueue(row.id) : addToQueue(row))}
                      title={inQueue ? 'Remove from queue' : 'Add to log queue'}
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-sm shrink-0 transition-all"
                      style={{
                        background: inQueue ? 'rgba(37,99,168,0.25)' : 'rgba(91,184,212,0.08)',
                        color: inQueue ? 'var(--theme-accent)' : 'var(--theme-text-muted)',
                        border: '1px solid transparent',
                      }}
                    >
                      {inQueue ? '✓' : '+'}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ── CENTER: Body map ── */}
        <div
          className="rounded-xl flex flex-col items-center py-4 px-2"
          style={{
            background: 'var(--theme-bg-card)',
            border: '1px solid var(--theme-border)',
          }}
        >
          <p className="text-xs font-semibold uppercase tracking-wider mb-3 self-start ml-2"
            style={{ color: 'var(--theme-text-muted)' }}>
            Anatomy Map
          </p>
          <BodyMap
            selectedRegion={selectedRegion}
            onSelect={(r) => setSelectedRegion(selectedRegion === r ? null : r)}
            regionCounts={regionCounts}
          />
          <p className="text-[10px] mt-3 text-center" style={{ color: 'var(--theme-text-disabled)' }}>
            Click a region to filter codes
          </p>

          {/* Region legend */}
          <div className="mt-4 w-full px-2 grid grid-cols-2 gap-1">
            {ALL_REGIONS.map((r) => (
              <button
                key={r}
                onClick={() => setSelectedRegion(selectedRegion === r ? null : r)}
                className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] transition-all text-left"
                style={{
                  background: selectedRegion === r ? 'rgba(37,99,168,0.15)' : 'transparent',
                  color: selectedRegion === r ? 'var(--theme-accent)' : 'var(--theme-text-muted)',
                }}
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{
                    background: regionCounts[r] > 0 ? 'var(--theme-accent)' : 'var(--theme-border)',
                  }}
                />
                {REGION_META[r].label}
                {regionCounts[r] > 0 && (
                  <span className="ml-auto font-semibold" style={{ color: 'var(--theme-text-disabled)' }}>
                    {regionCounts[r]}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* ── RIGHT: Log panel ── */}
        <div
          className="rounded-xl p-4"
          style={{
            background: 'var(--theme-bg-card)',
            border: '1px solid var(--theme-border)',
          }}
        >
          <LogPanel
            selectedRows={queuedRows}
            onRemove={removeFromQueue}
            onLog={handleLog}
            logging={logging}
          />
        </div>
      </div>
    </div>
  );
}
