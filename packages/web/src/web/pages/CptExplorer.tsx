/**
 * CptExplorer.tsx — Premium redesign
 *
 * Radiology workstation aesthetic: dark glass panels, cyan/blue glow,
 * smooth anatomical silhouette with region overlays, Bloomberg-style data.
 *
 * Layout (desktop): [CPT List 300px] | [Body Map flex] | [Log Panel 300px]
 */

import { useState, useCallback, useMemo, useRef } from 'react';
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
  shortLabel: string;
  ranges: [number, number][];
}

const REGION_META: Record<BodyRegion, RegionMeta> = {
  HEAD_NECK: {
    label: 'Head & Neck',
    shortLabel: 'Head/Neck',
    ranges: [[70450, 70498], [70540, 70559], [70010, 70110]],
  },
  CHEST: {
    label: 'Chest',
    shortLabel: 'Chest',
    ranges: [[71250, 71275], [71550, 71555], [71045, 71048]],
  },
  ABDOMEN: {
    label: 'Abdomen',
    shortLabel: 'Abdomen',
    ranges: [[74150, 74178], [74181, 74183], [76700, 76776]],
  },
  PELVIS: {
    label: 'Pelvis',
    shortLabel: 'Pelvis',
    ranges: [[72191, 72194], [72195, 72198]],
  },
  SPINE: {
    label: 'Spine',
    shortLabel: 'Spine',
    ranges: [[72125, 72133], [72141, 72159]],
  },
  UPPER_EXT: {
    label: 'Upper Extremity',
    shortLabel: 'Upper Ext',
    ranges: [[73200, 73225], [73218, 73225]],
  },
  LOWER_EXT: {
    label: 'Lower Extremity',
    shortLabel: 'Lower Ext',
    ranges: [[73700, 73725], [73718, 73725]],
  },
  BREAST: {
    label: 'Breast',
    shortLabel: 'Breast',
    ranges: [[77046, 77067]],
  },
};

const ALL_REGIONS = Object.keys(REGION_META) as BodyRegion[];

function codeInRegion(cptCode: string, region: BodyRegion): boolean {
  const num = parseInt(cptCode, 10);
  if (isNaN(num)) return false;
  return REGION_META[region].ranges.some(([lo, hi]) => num >= lo && num <= hi);
}

// ─── Contrast detection ───────────────────────────────────────────────────────

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

// ─── Professional row picker ──────────────────────────────────────────────────

function pickProfessionalRow(rows: CptRvuRow[]): CptRvuRow | null {
  const nonTech = rows.filter((r) => r.pcTcIndicator !== 'technical');
  if (nonTech.length === 0) return null;
  const mod26 = nonTech.find((r) => r.modifier === '26');
  return mod26 ?? nonTech[0];
}

// ─── Premium Anatomical Body Map ──────────────────────────────────────────────

interface BodyMapProps {
  selectedRegion: BodyRegion | null;
  hoveredRegion: BodyRegion | null;
  onSelect: (region: BodyRegion) => void;
  onHover: (region: BodyRegion | null) => void;
  regionCounts: Record<BodyRegion, number>;
}

function PremiumBodyMap({ selectedRegion, hoveredRegion, onSelect, onHover, regionCounts }: BodyMapProps) {
  const isActive = (r: BodyRegion) => selectedRegion === r;
  const isHovered = (r: BodyRegion) => hoveredRegion === r && selectedRegion !== r;
  const hasData = (r: BodyRegion) => regionCounts[r] > 0;

  const getRegionOpacity = (r: BodyRegion) => {
    if (isActive(r)) return 1;
    if (isHovered(r)) return 0.75;
    if (hasData(r)) return 0.35;
    return 0.12;
  };

  const getRegionGlow = (r: BodyRegion) => {
    if (isActive(r)) return 'drop-shadow(0 0 8px rgba(91,184,212,0.85))';
    if (isHovered(r)) return 'drop-shadow(0 0 5px rgba(91,184,212,0.5))';
    return 'none';
  };

  // Region overlay definitions — smooth anatomical paths
  // ViewBox: 0 0 240 560
  const regionDefs: Record<BodyRegion, React.ReactNode> = {
    HEAD_NECK: (
      <g>
        {/* Head */}
        <ellipse cx="120" cy="44" rx="32" ry="38" />
        {/* Neck */}
        <path d="M108,80 Q107,100 108,108 L132,108 Q133,100 132,80 Z" />
      </g>
    ),
    CHEST: (
      <path d="M80,110 Q72,118 70,140 L70,182 Q85,188 120,190 Q155,188 170,182 L170,140 Q168,118 160,110 Q145,108 120,108 Q95,108 80,110 Z" />
    ),
    ABDOMEN: (
      <path d="M72,184 Q70,196 70,220 L70,258 Q85,264 120,266 Q155,264 170,258 L170,220 Q170,196 168,184 Q155,186 120,188 Q85,186 72,184 Z" />
    ),
    PELVIS: (
      <path d="M73,260 Q68,272 68,292 Q72,310 86,316 Q100,320 120,320 Q140,320 154,316 Q168,310 172,292 Q172,272 167,260 Q155,262 120,264 Q85,262 73,260 Z" />
    ),
    SPINE: (
      <path d="M113,112 Q111,115 111,118 L111,316 Q114,318 120,318 Q126,318 129,316 L129,118 Q129,115 127,112 Q124,110 120,110 Q116,110 113,112 Z" />
    ),
    UPPER_EXT: (
      <g>
        {/* Left arm */}
        <path d="M70,114 Q54,120 46,148 Q40,168 42,196 Q46,210 54,212 Q62,210 66,196 Q68,172 70,154 Q72,136 74,118 Z" />
        {/* Right arm */}
        <path d="M170,114 Q186,120 194,148 Q200,168 198,196 Q194,210 186,212 Q178,210 174,196 Q172,172 170,154 Q168,136 166,118 Z" />
      </g>
    ),
    LOWER_EXT: (
      <g>
        {/* Left leg */}
        <path d="M84,320 Q76,352 74,392 Q72,428 74,460 Q76,476 86,480 Q96,482 100,468 Q104,452 104,420 Q104,382 104,346 Q100,330 92,322 Z" />
        {/* Right leg */}
        <path d="M156,320 Q164,352 166,392 Q168,428 166,460 Q164,476 154,480 Q144,482 140,468 Q136,452 136,420 Q136,382 136,346 Q140,330 148,322 Z" />
      </g>
    ),
    BREAST: (
      <g>
        <ellipse cx="103" cy="152" rx="16" ry="14" />
        <ellipse cx="137" cy="152" rx="16" ry="14" />
      </g>
    ),
  };

  // Label positions for each region
  const regionLabels: Record<BodyRegion, { x: number; y: number; dx?: number }> = {
    HEAD_NECK: { x: 166, y: 44 },
    CHEST: { x: 190, y: 148 },
    ABDOMEN: { x: 192, y: 224 },
    PELVIS: { x: 192, y: 290 },
    SPINE: { x: 30, y: 212 },
    UPPER_EXT: { x: 200, y: 164 },
    LOWER_EXT: { x: 192, y: 400 },
    BREAST: { x: 30, y: 148 },
  };

  return (
    <svg
      viewBox="0 0 240 510"
      width="220"
      height="467"
      style={{ display: 'block', margin: '0 auto', overflow: 'visible' }}
    >
      <defs>
        {/* Base silhouette gradient */}
        <linearGradient id="silhouetteGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#1e4a7a" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#0d2744" stopOpacity="0.4" />
        </linearGradient>
        {/* Active glow filter */}
        <filter id="activeGlow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        {/* Subtle inner glow */}
        <filter id="softGlow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        {/* Clip to body shape */}
        <clipPath id="bodyClip">
          <path d="
            M120,8
            Q152,8 152,44 Q152,72 140,82
            L162,108 Q180,120 186,148 Q194,180 194,210
            Q194,228 186,236 Q178,240 170,238
            L168,300 Q172,315 166,332
            Q162,348 160,380 Q158,416 160,454 Q162,472 154,482 Q144,490 134,484
            Q128,478 126,462 L122,380 L118,462
            Q116,478 110,484 Q100,490 86,482
            Q78,472 80,454 Q82,416 80,380
            Q78,348 74,332 Q68,315 72,300
            L70,238 Q62,240 54,236 Q46,228 46,210
            Q46,180 54,148 Q60,120 78,108
            L100,82 Q88,72 88,44 Q88,8 120,8 Z
          " />
        </clipPath>

        {/* Scan-line pattern for background texture */}
        <pattern id="scanlines" x="0" y="0" width="4" height="4" patternUnits="userSpaceOnUse">
          <line x1="0" y1="0" x2="4" y2="0" stroke="rgba(91,184,212,0.04)" strokeWidth="0.5" />
        </pattern>
      </defs>

      {/* ── Background silhouette ── */}
      {/* Outer glow ring */}
      <path
        d="
          M120,8
          Q152,8 152,44 Q152,72 140,82
          L162,108 Q180,120 186,148 Q194,180 194,210
          Q194,228 186,236 Q178,240 170,238
          L168,300 Q172,315 166,332
          Q162,348 160,380 Q158,416 160,454 Q162,472 154,482 Q144,490 134,484
          Q128,478 126,462 L122,380 L118,462
          Q116,478 110,484 Q100,490 86,482
          Q78,472 80,454 Q82,416 80,380
          Q78,348 74,332 Q68,315 72,300
          L70,238 Q62,240 54,236 Q46,228 46,210
          Q46,180 54,148 Q60,120 78,108
          L100,82 Q88,72 88,44 Q88,8 120,8 Z
        "
        fill="none"
        stroke="rgba(91,184,212,0.08)"
        strokeWidth="12"
      />
      {/* Filled silhouette */}
      <path
        d="
          M120,8
          Q152,8 152,44 Q152,72 140,82
          L162,108 Q180,120 186,148 Q194,180 194,210
          Q194,228 186,236 Q178,240 170,238
          L168,300 Q172,315 166,332
          Q162,348 160,380 Q158,416 160,454 Q162,472 154,482 Q144,490 134,484
          Q128,478 126,462 L122,380 L118,462
          Q116,478 110,484 Q100,490 86,482
          Q78,472 80,454 Q82,416 80,380
          Q78,348 74,332 Q68,315 72,300
          L70,238 Q62,240 54,236 Q46,228 46,210
          Q46,180 54,148 Q60,120 78,108
          L100,82 Q88,72 88,44 Q88,8 120,8 Z
        "
        fill="url(#silhouetteGrad)"
        stroke="rgba(91,184,212,0.22)"
        strokeWidth="1.2"
      />
      {/* Scanline texture overlay */}
      <path
        d="
          M120,8
          Q152,8 152,44 Q152,72 140,82
          L162,108 Q180,120 186,148 Q194,180 194,210
          Q194,228 186,236 Q178,240 170,238
          L168,300 Q172,315 166,332
          Q162,348 160,380 Q158,416 160,454 Q162,472 154,482 Q144,490 134,484
          Q128,478 126,462 L122,380 L118,462
          Q116,478 110,484 Q100,490 86,482
          Q78,472 80,454 Q82,416 80,380
          Q78,348 74,332 Q68,315 72,300
          L70,238 Q62,240 54,236 Q46,228 46,210
          Q46,180 54,148 Q60,120 78,108
          L100,82 Q88,72 88,44 Q88,8 120,8 Z
        "
        fill="url(#scanlines)"
      />

      {/* ── Subtle body structure lines (ribs, etc.) ── */}
      {/* Clavicles */}
      <path d="M96,110 Q108,106 120,106 Q132,106 144,110" fill="none" stroke="rgba(91,184,212,0.1)" strokeWidth="0.8" />
      {/* Rib hints */}
      <path d="M80,130 Q100,126 120,126 Q140,126 160,130" fill="none" stroke="rgba(91,184,212,0.06)" strokeWidth="0.6" />
      <path d="M76,148 Q98,144 120,144 Q142,144 164,148" fill="none" stroke="rgba(91,184,212,0.06)" strokeWidth="0.6" />
      <path d="M74,166 Q97,162 120,162 Q143,162 166,166" fill="none" stroke="rgba(91,184,212,0.06)" strokeWidth="0.6" />
      {/* Pelvis arc */}
      <path d="M85,286 Q102,280 120,280 Q138,280 155,286 Q162,296 160,306 Q142,312 120,312 Q98,312 80,306 Q78,296 85,286 Z"
        fill="none" stroke="rgba(91,184,212,0.08)" strokeWidth="0.8" />
      {/* Spine center line */}
      <line x1="120" y1="106" x2="120" y2="314" stroke="rgba(91,184,212,0.07)" strokeWidth="0.7" strokeDasharray="3,4" />
      {/* Knee indicators */}
      <circle cx="88" cy="398" r="6" fill="none" stroke="rgba(91,184,212,0.08)" strokeWidth="0.8" />
      <circle cx="152" cy="398" r="6" fill="none" stroke="rgba(91,184,212,0.08)" strokeWidth="0.8" />

      {/* ── Clickable region overlays ── */}
      {(ALL_REGIONS as BodyRegion[]).filter(r => r !== 'BREAST').map((region) => (
        <g
          key={region}
          onClick={() => onSelect(region)}
          onMouseEnter={() => onHover(region)}
          onMouseLeave={() => onHover(null)}
          style={{ cursor: 'pointer' }}
          opacity={getRegionOpacity(region)}
          filter={isActive(region) || isHovered(region) ? 'url(#activeGlow)' : undefined}
        >
          <g
            fill={isActive(region) ? 'rgba(91,184,212,0.45)' : isHovered(region) ? 'rgba(91,184,212,0.3)' : hasData(region) ? 'rgba(91,184,212,0.15)' : 'rgba(91,184,212,0.06)'}
            stroke={isActive(region) ? '#5BB8D4' : isHovered(region) ? 'rgba(91,184,212,0.7)' : 'rgba(91,184,212,0.3)'}
            strokeWidth={isActive(region) ? 1.5 : 0.8}
          >
            {regionDefs[region]}
          </g>
        </g>
      ))}

      {/* BREAST is separate so it renders on top of CHEST with distinct styling */}
      <g
        onClick={() => onSelect('BREAST')}
        onMouseEnter={() => onHover('BREAST')}
        onMouseLeave={() => onHover(null)}
        style={{ cursor: 'pointer' }}
        opacity={getRegionOpacity('BREAST')}
        filter={isActive('BREAST') || isHovered('BREAST') ? 'url(#softGlow)' : undefined}
      >
        <g
          fill={isActive('BREAST') ? 'rgba(168,85,247,0.35)' : isHovered('BREAST') ? 'rgba(168,85,247,0.2)' : hasData('BREAST') ? 'rgba(168,85,247,0.12)' : 'rgba(168,85,247,0.04)'}
          stroke={isActive('BREAST') ? 'rgba(168,85,247,0.8)' : 'rgba(168,85,247,0.3)'}
          strokeWidth={isActive('BREAST') ? 1.5 : 0.8}
        >
          {regionDefs['BREAST']}
        </g>
      </g>

      {/* ── Region indicator lines + labels ── */}
      {ALL_REGIONS.map((region) => {
        const pos = regionLabels[region];
        const active = isActive(region);
        const hovered = isHovered(region);
        const dataExists = hasData(region);
        const count = regionCounts[region];
        const isLeft = pos.x < 120;

        if (!active && !hovered && !dataExists) return null;

        return (
          <g key={`label-${region}`} style={{ pointerEvents: 'none' }} opacity={active ? 1 : hovered ? 0.8 : 0.55}>
            {/* Connector line */}
            <line
              x1={isLeft ? 80 : 160}
              y1={pos.y}
              x2={pos.x - (isLeft ? -8 : 8)}
              y2={pos.y}
              stroke={active ? 'rgba(91,184,212,0.7)' : 'rgba(91,184,212,0.25)'}
              strokeWidth="0.6"
              strokeDasharray={active ? 'none' : '2,2'}
            />
            {/* Count badge */}
            {dataExists && (
              <g transform={`translate(${pos.x}, ${pos.y})`}>
                <rect
                  x={isLeft ? -28 : -8}
                  y="-8"
                  width="16"
                  height="16"
                  rx="4"
                  fill={active ? 'rgba(91,184,212,0.25)' : 'rgba(27,58,107,0.6)'}
                  stroke={active ? 'rgba(91,184,212,0.7)' : 'rgba(91,184,212,0.2)'}
                  strokeWidth="0.8"
                />
                <text
                  x={isLeft ? -20 : 0}
                  y="4"
                  textAnchor="middle"
                  fontSize="7"
                  fill={active ? '#5BB8D4' : 'rgba(91,184,212,0.7)'}
                  fontWeight="600"
                  fontFamily="monospace"
                >
                  {count}
                </text>
              </g>
            )}
          </g>
        );
      })}

      {/* ── Active region pulse ring ── */}
      {selectedRegion && (() => {
        const pulsePositions: Record<BodyRegion, { cx: number; cy: number; rx: number; ry: number }> = {
          HEAD_NECK: { cx: 120, cy: 52, rx: 36, ry: 50 },
          CHEST: { cx: 120, cy: 150, rx: 55, ry: 44 },
          ABDOMEN: { cx: 120, cy: 224, rx: 53, ry: 44 },
          PELVIS: { cx: 120, cy: 290, rx: 55, ry: 32 },
          SPINE: { cx: 120, cy: 214, rx: 12, ry: 106 },
          UPPER_EXT: { cx: 120, cy: 164, rx: 82, ry: 52 },
          LOWER_EXT: { cx: 120, cy: 402, rx: 46, ry: 90 },
          BREAST: { cx: 120, cy: 152, rx: 38, ry: 20 },
        };
        const p = pulsePositions[selectedRegion];
        return (
          <ellipse
            cx={p.cx} cy={p.cy} rx={p.rx} ry={p.ry}
            fill="none"
            stroke="rgba(91,184,212,0.4)"
            strokeWidth="1"
            strokeDasharray="4,3"
          >
            <animate attributeName="stroke-opacity" values="0.4;0.8;0.4" dur="2s" repeatCount="indefinite" />
          </ellipse>
        );
      })()}
    </svg>
  );
}

// ─── Modality Segmented Control ───────────────────────────────────────────────

const MODALITIES_FOR_FILTER: Modality[] = ['CT', 'MRI', 'US', 'XR', 'NM_PET', 'MAMMO', 'FLUORO'];

function ModalityControl({ value, onChange }: { value: Modality; onChange: (m: Modality) => void }) {
  return (
    <div
      className="flex gap-0.5 p-0.5 rounded-lg"
      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}
    >
      {MODALITIES_FOR_FILTER.map((m) => (
        <button
          key={m}
          onClick={() => onChange(m)}
          className="px-3 py-1.5 rounded-md text-xs font-semibold transition-all"
          style={{
            background: value === m ? 'var(--theme-accent)' : 'transparent',
            color: value === m ? 'white' : 'var(--theme-text-muted)',
            letterSpacing: '0.02em',
          }}
        >
          {m === 'NM_PET' ? 'NM/PET' : m}
        </button>
      ))}
    </div>
  );
}

// ─── Contrast Segmented Control ───────────────────────────────────────────────

const CONTRAST_OPTIONS: { id: ContrastType; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'without', label: 'Non-con' },
  { id: 'with', label: 'Contrast' },
  { id: 'both', label: 'Multi-phase' },
];

function ContrastControl({ value, onChange }: { value: ContrastType; onChange: (c: ContrastType) => void }) {
  return (
    <div
      className="flex gap-0.5 p-0.5 rounded-lg"
      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}
    >
      {CONTRAST_OPTIONS.map((c) => (
        <button
          key={c.id}
          onClick={() => onChange(c.id)}
          className="px-2.5 py-1.5 rounded-md text-xs font-medium transition-all"
          style={{
            background: value === c.id ? 'rgba(91,184,212,0.2)' : 'transparent',
            color: value === c.id ? '#5BB8D4' : 'var(--theme-text-muted)',
          }}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}

// ─── CPT Row Item ─────────────────────────────────────────────────────────────

function CptRow({
  row,
  inQueue,
  onAdd,
  onRemove,
}: {
  row: CptRvuRow;
  inQueue: boolean;
  onAdd: () => void;
  onRemove: () => void;
}) {
  const contrast = detectContrast(row.description);
  const [hovered, setHovered] = useState(false);

  const contrastColor = contrast === 'both' ? '#a855f7' : contrast === 'with' ? '#60a5fa' : 'rgba(120,130,150,0.8)';
  const contrastLabel = contrast === 'both' ? 'Multi' : contrast === 'with' ? 'Con+' : contrast === 'without' ? 'Non' : null;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="flex items-center gap-3 px-4 py-3 transition-all border-b"
      style={{
        borderColor: 'rgba(255,255,255,0.04)',
        background: inQueue
          ? 'rgba(37,99,168,0.12)'
          : hovered
            ? 'rgba(91,184,212,0.04)'
            : 'transparent',
        borderLeft: inQueue ? '2px solid var(--theme-accent)' : '2px solid transparent',
      }}
    >
      {/* CPT code + wRVU */}
      <div style={{ minWidth: '86px' }}>
        <div className="font-mono font-bold text-sm" style={{ color: 'var(--theme-accent)', letterSpacing: '0.04em' }}>
          {row.cptCode}
          {row.modifier && (
            <span style={{ color: 'rgba(91,184,212,0.45)', fontSize: '11px' }}> -{row.modifier}</span>
          )}
        </div>
        <div className="text-xs font-semibold mt-0.5" style={{ color: 'rgba(180,210,230,0.9)' }}>
          {row.workRvu != null ? row.workRvu.toFixed(2) : '—'}
          <span className="font-normal ml-0.5" style={{ color: 'var(--theme-text-disabled)', fontSize: '10px' }}>wRVU</span>
        </div>
      </div>

      {/* Description */}
      <div className="flex-1 min-w-0">
        <p className="text-xs leading-tight" style={{ color: 'var(--theme-text-muted)' }}>
          {row.description}
        </p>
        {contrastLabel && (
          <span
            className="inline-block mt-1 text-[9px] font-semibold px-1.5 py-0.5 rounded"
            style={{ background: `${contrastColor}14`, color: contrastColor, letterSpacing: '0.06em' }}
          >
            {contrastLabel}
          </span>
        )}
      </div>

      {/* Add/remove button */}
      <button
        onClick={inQueue ? onRemove : onAdd}
        className="w-7 h-7 rounded-lg flex items-center justify-center text-sm shrink-0 transition-all font-bold"
        style={{
          background: inQueue ? 'rgba(37,99,168,0.3)' : hovered ? 'rgba(91,184,212,0.12)' : 'rgba(91,184,212,0.06)',
          color: inQueue ? '#5BB8D4' : 'var(--theme-text-muted)',
          border: inQueue ? '1px solid rgba(37,99,168,0.4)' : '1px solid rgba(91,184,212,0.12)',
        }}
      >
        {inQueue ? '✓' : '+'}
      </button>
    </div>
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
    <div className="flex flex-col h-full" style={{ gap: '16px' }}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'rgba(91,184,212,0.6)', letterSpacing: '0.12em' }}>
            Log Queue
          </p>
        </div>
        {selectedRows.length > 0 && (
          <div
            className="text-xs font-bold px-2 py-0.5 rounded-full"
            style={{ background: 'rgba(37,99,168,0.25)', color: '#5BB8D4', border: '1px solid rgba(91,184,212,0.2)' }}
          >
            {selectedRows.length}
          </div>
        )}
      </div>

      {/* Queue list */}
      <div className="flex-1 min-h-0 overflow-y-auto" style={{ maxHeight: '260px' }}>
        {selectedRows.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center rounded-xl"
            style={{
              padding: '32px 16px',
              background: 'rgba(255,255,255,0.02)',
              border: '1px dashed rgba(91,184,212,0.12)',
              minHeight: '120px',
            }}
          >
            <div style={{ fontSize: '20px', opacity: 0.3, marginBottom: '8px' }}>⊕</div>
            <p className="text-xs text-center" style={{ color: 'var(--theme-text-disabled)', lineHeight: 1.5 }}>
              Click + on any code<br />to add to queue
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {selectedRows.map((row) => (
              <div
                key={row.id}
                className="flex items-start gap-2.5 p-2.5 rounded-lg"
                style={{
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(91,184,212,0.1)',
                }}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono font-bold text-xs" style={{ color: '#5BB8D4' }}>
                      {row.cptCode}
                    </span>
                    <span className="text-xs font-semibold" style={{ color: 'rgba(180,210,230,0.85)' }}>
                      {row.workRvu?.toFixed(2)} <span style={{ color: 'var(--theme-text-disabled)', fontWeight: 400 }}>wRVU</span>
                    </span>
                  </div>
                  <p className="text-[10px] mt-0.5 truncate" style={{ color: 'var(--theme-text-disabled)' }}>
                    {row.description}
                  </p>
                </div>
                <button
                  onClick={() => onRemove(row.id)}
                  className="text-xs w-5 h-5 flex items-center justify-center rounded transition-colors shrink-0 mt-0.5"
                  style={{ color: 'rgba(255,80,80,0.4)', background: 'transparent' }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,80,80,0.8)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,80,80,0.4)'; }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Total wRVU */}
      {selectedRows.length > 0 && (
        <div
          className="flex items-center justify-between px-3 py-2 rounded-lg"
          style={{
            background: 'rgba(37,99,168,0.1)',
            border: '1px solid rgba(37,99,168,0.2)',
          }}
        >
          <span className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>Total</span>
          <div className="flex items-baseline gap-1.5">
            <span className="text-base font-bold" style={{ color: 'rgba(180,210,230,1)', fontVariantNumeric: 'tabular-nums' }}>
              {totalRvu.toFixed(2)}
            </span>
            <span className="text-xs" style={{ color: 'var(--theme-text-disabled)' }}>wRVU</span>
          </div>
        </div>
      )}

      {/* Divider */}
      <div style={{ height: '1px', background: 'rgba(255,255,255,0.05)' }} />

      {/* Date input */}
      <div>
        <label className="text-[10px] font-semibold uppercase tracking-wider block mb-1.5" style={{ color: 'rgba(91,184,212,0.5)' }}>
          Study Date
        </label>
        <input
          type="date"
          value={logDate}
          onChange={(e) => setLogDate(e.target.value)}
          className="w-full text-sm px-3 py-2 rounded-lg outline-none"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            color: 'var(--theme-text-primary)',
            colorScheme: 'dark',
          }}
        />
      </div>

      {/* Notes */}
      <div>
        <label className="text-[10px] font-semibold uppercase tracking-wider block mb-1.5" style={{ color: 'rgba(91,184,212,0.5)' }}>
          Notes <span style={{ color: 'var(--theme-text-disabled)', textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Accession #, patient ref…"
          className="w-full text-sm px-3 py-2 rounded-lg outline-none resize-none"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            color: 'var(--theme-text-primary)',
          }}
        />
      </div>

      {/* Log button */}
      <button
        onClick={handleLog}
        disabled={selectedRows.length === 0 || logging || !logDate}
        className="w-full py-2.5 rounded-xl text-sm font-semibold transition-all"
        style={{
          background: success
            ? 'rgba(16,185,129,0.8)'
            : selectedRows.length > 0
              ? 'var(--theme-accent)'
              : 'rgba(255,255,255,0.04)',
          color: selectedRows.length > 0 ? 'white' : 'var(--theme-text-disabled)',
          border: selectedRows.length > 0 ? 'none' : '1px solid rgba(255,255,255,0.06)',
          opacity: logging ? 0.6 : 1,
          letterSpacing: '0.02em',
        }}
      >
        {logging ? 'Logging…' : success ? '✓ Studies Logged' : `Log ${selectedRows.length > 0 ? `${selectedRows.length} ` : ''}Stud${selectedRows.length === 1 ? 'y' : 'ies'}`}
      </button>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

interface CptExplorerProps {
  onNavigate?: (tab: string) => void;
}

export function CptExplorer({ onNavigate }: CptExplorerProps) {
  const { activeProfile } = useProfile();

  const [selectedModality, setSelectedModality] = useState<Modality>('CT');
  const [contrastFilter, setContrastFilter] = useState<ContrastType>('all');
  const [selectedRegion, setSelectedRegion] = useState<BodyRegion | null>(null);
  const [hoveredRegion, setHoveredRegion] = useState<BodyRegion | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [queuedRows, setQueuedRows] = useState<CptRvuRow[]>([]);
  const [logging, setLogging] = useState(false);

  // Live query
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

  // Deduplicate
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

  // Contrast filter
  const contrastFiltered = useMemo(() => {
    if (contrastFilter === 'all') return dedupedRows;
    return dedupedRows.filter((r) => {
      const c = detectContrast(r.description);
      return c === contrastFilter || c === 'unknown';
    });
  }, [dedupedRows, contrastFilter]);

  // Region filter
  const regionFiltered = useMemo(() => {
    if (!selectedRegion) return contrastFiltered;
    return contrastFiltered.filter((r) => codeInRegion(r.cptCode, selectedRegion));
  }, [contrastFiltered, selectedRegion]);

  // Search filter
  const displayRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return regionFiltered;
    return regionFiltered.filter(
      (r) =>
        r.cptCode.includes(q) ||
        r.description.toLowerCase().includes(q),
    );
  }, [regionFiltered, searchQuery]);

  // Region counts
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

  const totalInDb = dedupedRows.length;

  return (
    <div className="flex flex-col gap-5" style={{ height: '100%' }}>
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1
            className="text-xl font-bold tracking-tight"
            style={{ color: 'var(--theme-text-primary)', letterSpacing: '-0.02em' }}
          >
            CPT Explorer
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--theme-text-disabled)' }}>
            Browse by anatomy · filter by modality & contrast · log directly
          </p>
        </div>
        {totalInDb === 0 && (
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
            style={{
              background: 'rgba(245,158,11,0.06)',
              border: '1px solid rgba(245,158,11,0.18)',
              color: 'var(--theme-caution)',
            }}
          >
            <span>⚠</span>
            <span>
              No {MODALITY_LABELS[selectedModality]} codes.{' '}
              <button className="underline font-medium" onClick={() => onNavigate?.('import')}>
                Import CMS RVU file
              </button>
            </span>
          </div>
        )}
      </div>

      {/* ── Filter bar ── */}
      <div
        className="flex flex-wrap items-center gap-3 px-4 py-3 rounded-xl"
        style={{
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.05)',
        }}
      >
        <ModalityControl value={selectedModality} onChange={setSelectedModality} />
        <div style={{ width: '1px', height: '24px', background: 'rgba(255,255,255,0.07)' }} />
        <ContrastControl value={contrastFilter} onChange={setContrastFilter} />
        <div className="flex-1" />
        <span className="text-xs tabular-nums" style={{ color: 'var(--theme-text-disabled)' }}>
          {displayRows.length} code{displayRows.length !== 1 ? 's' : ''}
          {selectedRegion ? ` · ${REGION_META[selectedRegion].shortLabel}` : ''}
        </span>
      </div>

      {/* ── Three-column layout ── */}
      <div
        className="flex gap-4 flex-1 min-h-0"
        style={{ display: 'grid', gridTemplateColumns: '300px 1fr 300px', alignItems: 'stretch' }}
      >

        {/* ── LEFT: CPT code list ── */}
        <div
          className="rounded-xl flex flex-col overflow-hidden"
          style={{
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(255,255,255,0.06)',
            backdropFilter: 'blur(12px)',
          }}
        >
          {/* Search */}
          <div className="px-3 pt-3 pb-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <div className="relative">
              <div
                className="absolute inset-y-0 left-2.5 flex items-center"
                style={{ pointerEvents: 'none', color: 'rgba(91,184,212,0.35)' }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.35-4.35" />
                </svg>
              </div>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search CPT, exam name…"
                className="w-full text-xs pl-7 pr-3 py-2 rounded-lg outline-none"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.07)',
                  color: 'var(--theme-text-primary)',
                }}
              />
            </div>

            {/* Region chips */}
            <div className="flex flex-wrap gap-1 mt-2">
              <button
                onClick={() => setSelectedRegion(null)}
                className="text-[9px] px-2 py-0.5 rounded-md font-semibold transition-all uppercase tracking-wide"
                style={{
                  background: !selectedRegion ? 'rgba(37,99,168,0.4)' : 'rgba(255,255,255,0.04)',
                  color: !selectedRegion ? '#5BB8D4' : 'var(--theme-text-disabled)',
                  border: !selectedRegion ? '1px solid rgba(91,184,212,0.3)' : '1px solid transparent',
                }}
              >
                All
              </button>
              {ALL_REGIONS.map((r) => (
                <button
                  key={r}
                  onClick={() => setSelectedRegion(selectedRegion === r ? null : r)}
                  className="text-[9px] px-2 py-0.5 rounded-md font-semibold transition-all uppercase tracking-wide"
                  style={{
                    background: selectedRegion === r ? 'rgba(37,99,168,0.35)' : 'rgba(255,255,255,0.04)',
                    color: selectedRegion === r ? '#5BB8D4' : regionCounts[r] > 0 ? 'var(--theme-text-muted)' : 'var(--theme-text-disabled)',
                    border: selectedRegion === r ? '1px solid rgba(91,184,212,0.25)' : '1px solid transparent',
                  }}
                >
                  {REGION_META[r].shortLabel}
                  {regionCounts[r] > 0 && (
                    <span className="ml-1" style={{ opacity: 0.6 }}>{regionCounts[r]}</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Codes */}
          <div className="flex-1 overflow-y-auto">
            {displayRows.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 px-4 py-12 text-center">
                <div style={{ fontSize: '28px', opacity: 0.2 }}>◎</div>
                <p className="text-xs" style={{ color: 'var(--theme-text-disabled)' }}>
                  {totalInDb === 0
                    ? `No ${MODALITY_LABELS[selectedModality]} codes in database`
                    : 'No codes match current filters'}
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
              displayRows.map((row) => (
                <CptRow
                  key={row.id}
                  row={row}
                  inQueue={queuedRows.some((r) => r.id === row.id)}
                  onAdd={() => addToQueue(row)}
                  onRemove={() => removeFromQueue(row.id)}
                />
              ))
            )}
          </div>
        </div>

        {/* ── CENTER: Body map ── */}
        <div
          className="rounded-xl flex flex-col items-center py-5 px-4"
          style={{
            background: 'rgba(10,20,40,0.6)',
            border: '1px solid rgba(91,184,212,0.1)',
            backdropFilter: 'blur(20px)',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {/* Background radial glow */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'radial-gradient(ellipse 60% 50% at 50% 40%, rgba(37,99,168,0.08) 0%, transparent 70%)',
              pointerEvents: 'none',
            }}
          />

          {/* Header */}
          <div className="flex items-center justify-between w-full mb-4" style={{ position: 'relative', zIndex: 1 }}>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'rgba(91,184,212,0.5)', letterSpacing: '0.14em' }}>
                Anatomy Map
              </p>
              {selectedRegion && (
                <p className="text-sm font-semibold mt-0.5" style={{ color: '#5BB8D4' }}>
                  {REGION_META[selectedRegion].label}
                </p>
              )}
            </div>
            {selectedRegion && (
              <button
                onClick={() => setSelectedRegion(null)}
                className="text-xs px-2.5 py-1 rounded-lg transition-colors"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  color: 'var(--theme-text-disabled)',
                  border: '1px solid rgba(255,255,255,0.06)',
                }}
              >
                Clear
              </button>
            )}
          </div>

          {/* Body SVG */}
          <div style={{ position: 'relative', zIndex: 1, flex: 1, display: 'flex', alignItems: 'center' }}>
            <PremiumBodyMap
              selectedRegion={selectedRegion}
              hoveredRegion={hoveredRegion}
              onSelect={(r) => setSelectedRegion(selectedRegion === r ? null : r)}
              onHover={setHoveredRegion}
              regionCounts={regionCounts}
            />
          </div>

          {/* Region legend grid */}
          <div
            className="w-full grid grid-cols-2 gap-1 mt-4"
            style={{ position: 'relative', zIndex: 1, borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '12px' }}
          >
            {ALL_REGIONS.map((r) => (
              <button
                key={r}
                onClick={() => setSelectedRegion(selectedRegion === r ? null : r)}
                onMouseEnter={() => setHoveredRegion(r)}
                onMouseLeave={() => setHoveredRegion(null)}
                className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] transition-all text-left"
                style={{
                  background: selectedRegion === r ? 'rgba(37,99,168,0.2)' : hoveredRegion === r ? 'rgba(91,184,212,0.05)' : 'transparent',
                  color: selectedRegion === r ? '#5BB8D4' : regionCounts[r] > 0 ? 'var(--theme-text-muted)' : 'var(--theme-text-disabled)',
                }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{
                    background: selectedRegion === r
                      ? '#5BB8D4'
                      : regionCounts[r] > 0
                        ? 'rgba(91,184,212,0.5)'
                        : 'rgba(255,255,255,0.1)',
                    boxShadow: selectedRegion === r ? '0 0 4px rgba(91,184,212,0.8)' : 'none',
                  }}
                />
                <span>{REGION_META[r].shortLabel}</span>
                {regionCounts[r] > 0 && (
                  <span className="ml-auto font-mono" style={{ color: 'var(--theme-text-disabled)', fontSize: '9px' }}>
                    {regionCounts[r]}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Hover tooltip */}
          {hoveredRegion && (
            <div
              className="absolute bottom-4 left-1/2 text-xs px-3 py-1.5 rounded-lg font-medium"
              style={{
                transform: 'translateX(-50%)',
                background: 'rgba(10,20,40,0.9)',
                border: '1px solid rgba(91,184,212,0.2)',
                color: '#5BB8D4',
                pointerEvents: 'none',
                zIndex: 10,
                whiteSpace: 'nowrap',
                backdropFilter: 'blur(8px)',
              }}
            >
              {REGION_META[hoveredRegion].label} · {regionCounts[hoveredRegion]} code{regionCounts[hoveredRegion] !== 1 ? 's' : ''}
            </div>
          )}
        </div>

        {/* ── RIGHT: Log panel ── */}
        <div
          className="rounded-xl p-4 flex flex-col"
          style={{
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(255,255,255,0.06)',
            backdropFilter: 'blur(12px)',
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
