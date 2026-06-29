/**
 * Locations.tsx
 *
 * Manage Locations and the Radiologists assigned to them.
 *
 * Hierarchy: Location → Radiologist → StudyLogs
 *
 * Left panel:  flat list of locations + radiologists under each
 * Right panel: create / edit form for selected node
 */

import { useState, useMemo, useEffect } from 'react';
import { useOrg } from '../hooks/useOrg';
import { ProfileAvatar } from '../components/OrgSwitcher';
import { theme } from '../lib/theme';
import type { Practice, RadiologistProfile, ProfileColor } from '../types';

// ─── Color palette ────────────────────────────────────────────────────────────

const COLOR_OPTIONS: ProfileColor[] = ['cyan', 'teal', 'emerald', 'amber', 'rose', 'orange', 'indigo', 'violet'];

const COLOR_HEX: Record<ProfileColor, string> = {
  indigo:  '#2563A8',
  violet:  '#5BB8D4',
  emerald: '#10b981',
  amber:   '#f59e0b',
  rose:    '#f43f5e',
  cyan:    '#06b6d4',
  orange:  '#f97316',
  teal:    '#14b8a6',
};

function ColorSwatch({ color, selected, onClick }: { color: ProfileColor; selected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={color}
      style={{
        width: 22, height: 22,
        borderRadius: '50%',
        background: COLOR_HEX[color],
        border: selected ? '2.5px solid white' : '2px solid transparent',
        boxShadow: selected ? `0 0 0 1px ${COLOR_HEX[color]}` : 'none',
        transform: selected ? 'scale(1.15)' : 'scale(1)',
        transition: 'all 0.15s ease',
        flexShrink: 0,
        cursor: 'pointer',
      }}
    />
  );
}

// ─── Node types ───────────────────────────────────────────────────────────────

type NodeType = 'location' | 'radiologist';

interface SelectedNode {
  type: NodeType;
  id: string | null; // null = new
  parentId?: string; // locationId for new radiologist
}

// ─── Location Form ────────────────────────────────────────────────────────────

function LocationForm({
  location,
  onSave,
  onDelete,
  onCancel,
}: {
  location: Practice | null;
  onSave: (data: { name: string; city: string | null; color: ProfileColor }) => Promise<void>;
  onDelete?: () => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(location?.name ?? '');
  const [code, setCode] = useState(location?.city ?? '');
  const [color, setColor] = useState<ProfileColor>(location?.color ?? 'cyan');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    await onSave({ name: name.trim(), city: code.trim().toUpperCase() || null, color });
    setSaving(false);
  }

  return (
    <div className="space-y-5">
      <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold">
        {location ? 'Edit Location' : 'New Location'}
      </p>

      {/* Preview */}
      <div
        className="flex items-center gap-3 p-3 rounded-xl border"
        style={{ background: 'rgba(91,184,212,0.04)', borderColor: 'rgba(91,184,212,0.15)' }}
      >
        <ProfileAvatar
          initials={(code || name || '?').slice(0, 3).toUpperCase()}
          color={color}
          size="md"
        />
        <div>
          <p className="text-white font-semibold text-sm">{name || 'Location Name'}</p>
          {code && <p className="text-slate-400 text-xs font-mono">{code.toUpperCase()}</p>}
        </div>
      </div>

      <div>
        <label className="block text-xs text-slate-400 mb-1.5">
          Location Name <span className="text-red-400">*</span>
        </label>
        <input
          className="input w-full"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Baptist Memorial Hospital–Memphis"
          autoFocus
        />
      </div>

      <div>
        <label className="block text-xs text-slate-400 mb-1.5">
          Location Code
          <span className="text-slate-500 font-normal ml-1.5">(optional · shown where space is limited)</span>
        </label>
        <input
          className="input w-full font-mono uppercase"
          maxLength={6}
          value={code}
          onChange={e => setCode(e.target.value.toUpperCase())}
          placeholder="MEM"
        />
        <p className="text-xs text-slate-500 mt-1">e.g. BMH-NM · MEM · REMOTE · NIGHTS</p>
      </div>

      <div>
        <label className="block text-xs text-slate-400 mb-2">Color</label>
        <div className="flex flex-wrap gap-2">
          {COLOR_OPTIONS.map(c => (
            <ColorSwatch key={c} color={c} selected={color === c} onClick={() => setColor(c)} />
          ))}
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <button
          onClick={handleSave}
          disabled={!name.trim() || saving}
          className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white hover:opacity-90 transition-opacity disabled:opacity-50"
          style={{ background: `linear-gradient(135deg, ${theme.colors.primary}, ${theme.colors.accent})` }}
        >
          {saving ? 'Saving…' : location ? 'Update Location' : 'Create Location'}
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2.5 rounded-xl text-sm text-slate-400 hover:text-white border border-white/10 transition-colors"
        >
          Cancel
        </button>
      </div>

      {location && onDelete && (
        <div className="pt-2 border-t border-white/8">
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <p className="text-xs text-red-400 flex-1">
                Delete this location? Radiologists will become unassigned.
              </p>
              <button
                onClick={onDelete}
                className="text-xs px-3 py-1.5 rounded-lg bg-red-500/20 text-red-400 border border-red-500/30 whitespace-nowrap"
              >
                Confirm delete
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="text-xs px-3 py-1.5 rounded-lg border border-white/10 text-slate-400"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="text-xs text-red-400 hover:text-red-300 transition-colors"
            >
              Delete location…
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Radiologist Form ─────────────────────────────────────────────────────────

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function RadiologistForm({
  radiologist,
  locations,
  defaultLocationId,
  onSave,
  onDelete,
  onCancel,
}: {
  radiologist: RadiologistProfile | null;
  locations: Practice[];
  defaultLocationId?: string;
  onSave: (data: Omit<RadiologistProfile, 'id' | 'active' | 'lastUsed' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  onDelete?: () => Promise<void>;
  onCancel: () => void;
}) {
  const [locationId, setLocationId] = useState<string>(
    radiologist?.practiceId ?? defaultLocationId ?? locations[0]?.id ?? ''
  );
  const [name, setName] = useState(radiologist?.name ?? '');
  const [initials, setInitials] = useState(radiologist?.initials ?? '');
  const [color, setColor] = useState<ProfileColor>(radiologist?.color ?? 'cyan');
  const [annualGoal, setAnnualGoal] = useState(radiologist?.annualRvuGoal ?? 5000);
  const [dailyGoal, setDailyGoal] = useState(radiologist?.dailyRvuGoal ?? 90);
  const [fiscalMonth, setFiscalMonth] = useState(radiologist?.fiscalYearStartMonth ?? 10);
  const [workStart, setWorkStart] = useState(radiologist?.workdayStart ?? '07:00');
  const [workEnd, setWorkEnd] = useState(radiologist?.workdayEnd ?? '17:00');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [locationSearch, setLocationSearch] = useState('');

  // Auto-generate initials from name
  function handleNameChange(val: string) {
    const auto = val.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
    setName(val);
    if (!initials || initials === name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('')) {
      setInitials(auto);
    }
  }

  const filteredLocations = useMemo(() =>
    locations.filter(l => l.name.toLowerCase().includes(locationSearch.toLowerCase())),
    [locations, locationSearch]
  );

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    await onSave({
      practiceId: locationId || null,
      name: name.trim(),
      initials: (initials || name.slice(0, 2)).toUpperCase().slice(0, 3),
      color,
      annualRvuGoal: annualGoal,
      dailyRvuGoal: dailyGoal,
      fiscalYearStartMonth: fiscalMonth,
      workdayStart: workStart,
      workdayEnd: workEnd,
      breakMinutes: radiologist?.breakMinutes ?? 0,
      powerScribeUsername: radiologist?.powerScribeUsername ?? null,
      powerScribeLastSync: radiologist?.powerScribeLastSync ?? null,
      createdAt: radiologist?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as any);
    setSaving(false);
  }

  return (
    <div className="space-y-5">
      <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold">
        {radiologist ? 'Edit Radiologist' : 'New Radiologist'}
      </p>

      {/* Preview */}
      <div
        className="flex items-center gap-3 p-3 rounded-xl border"
        style={{ background: 'rgba(91,184,212,0.04)', borderColor: 'rgba(91,184,212,0.15)' }}
      >
        <ProfileAvatar initials={initials || '?'} color={color} size="md" />
        <div>
          <p className="text-white font-semibold text-sm">{name || 'Radiologist Name'}</p>
          <p className="text-slate-400 text-xs">
            {dailyGoal} wRVU/day · {annualGoal.toLocaleString()} annual
          </p>
        </div>
      </div>

      {/* Identity */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-slate-400 mb-1.5">Full Name <span className="text-red-400">*</span></label>
          <input
            className="input w-full"
            value={name}
            onChange={e => handleNameChange(e.target.value)}
            placeholder="Dr. Will Stewart"
            autoFocus
          />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1.5">Initials (≤3)</label>
          <input
            className="input w-full font-mono uppercase"
            maxLength={3}
            value={initials}
            onChange={e => setInitials(e.target.value.toUpperCase())}
            placeholder="WS"
          />
        </div>
      </div>

      {/* Default Location — searchable dropdown */}
      <div>
        <label className="block text-xs text-slate-400 mb-1.5">Default Location</label>
        <div className="relative">
          <input
            className="input w-full pr-8"
            placeholder="Search locations…"
            value={locationSearch || (locations.find(l => l.id === locationId)?.name ?? '')}
            onChange={e => { setLocationSearch(e.target.value); setLocationId(''); }}
            onFocus={e => { setLocationSearch(''); e.target.select(); }}
          />
          {locationSearch && (
            <div
              className="absolute top-full left-0 right-0 mt-1 rounded-xl border overflow-hidden z-20"
              style={{ background: theme.colors.bgCard, borderColor: theme.colors.border, boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}
            >
              {filteredLocations.length === 0 ? (
                <p className="text-xs text-slate-500 px-3 py-2">No locations match</p>
              ) : (
                filteredLocations.map(l => (
                  <button
                    key={l.id}
                    onClick={() => { setLocationId(l.id); setLocationSearch(''); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-white/5 transition-colors"
                    style={{ color: theme.colors.textPrimary }}
                  >
                    <span
                      style={{ width: 8, height: 8, borderRadius: '50%', background: COLOR_HEX[l.color], flexShrink: 0 }}
                    />
                    <span className="flex-1">{l.name}</span>
                    {l.city && <span className="text-slate-500 text-xs font-mono">{l.city}</span>}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
        {!locationId && !locationSearch && (
          <p className="text-xs text-slate-500 mt-1">Not assigned to a location</p>
        )}
      </div>

      {/* Color */}
      <div>
        <label className="block text-xs text-slate-400 mb-2">Accent Color</label>
        <div className="flex flex-wrap gap-2">
          {COLOR_OPTIONS.map(c => (
            <ColorSwatch key={c} color={c} selected={color === c} onClick={() => setColor(c)} />
          ))}
        </div>
      </div>

      {/* Goals */}
      <div>
        <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3">Goals & Schedule</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Annual wRVU Goal</label>
            <input type="number" className="input w-full" value={annualGoal} onChange={e => setAnnualGoal(Number(e.target.value))} min={100} step={500} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Daily wRVU Goal</label>
            <input type="number" className="input w-full" value={dailyGoal} onChange={e => setDailyGoal(Number(e.target.value))} min={1} step={5} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Fiscal Year Start</label>
            <select className="input w-full" value={fiscalMonth} onChange={e => setFiscalMonth(Number(e.target.value))}>
              {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Work Hours</label>
            <div className="flex items-center gap-1">
              <input type="time" className="input flex-1 text-xs" value={workStart} onChange={e => setWorkStart(e.target.value)} />
              <span className="text-slate-500 text-xs">–</span>
              <input type="time" className="input flex-1 text-xs" value={workEnd} onChange={e => setWorkEnd(e.target.value)} />
            </div>
          </div>
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <button
          onClick={handleSave}
          disabled={!name.trim() || saving}
          className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white hover:opacity-90 transition-opacity disabled:opacity-50"
          style={{ background: `linear-gradient(135deg, ${theme.colors.primary}, ${theme.colors.accent})` }}
        >
          {saving ? 'Saving…' : radiologist ? 'Update Radiologist' : 'Add Radiologist'}
        </button>
        <button onClick={onCancel} className="px-4 py-2.5 rounded-xl text-sm text-slate-400 hover:text-white border border-white/10 transition-colors">
          Cancel
        </button>
      </div>

      {radiologist && onDelete && (
        <div className="pt-2 border-t border-white/8">
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <p className="text-xs text-red-400 flex-1">Delete? Study logs are preserved.</p>
              <button onClick={onDelete} className="text-xs px-3 py-1.5 rounded-lg bg-red-500/20 text-red-400 border border-red-500/30">Confirm</button>
              <button onClick={() => setConfirmDelete(false)} className="text-xs px-3 py-1.5 rounded-lg border border-white/10 text-slate-400">Cancel</button>
            </div>
          ) : (
            <button onClick={() => setConfirmDelete(true)} className="text-xs text-red-400 hover:text-red-300 transition-colors">
              Delete radiologist…
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function Locations(_props: { onNavigate: (tab: string) => void }) {
  const {
    locations,
    radiologists,
    activeProfile,
    createLocation,
    updateLocation,
    deleteLocation,
    createRadiologist,
    updateRadiologist,
    deleteRadiologist,
  } = useOrg();

  const [selected, setSelected] = useState<SelectedNode | null>(null);
  const [expandedLocations, setExpandedLocations] = useState<Set<string>>(new Set());

  // Auto-expand all locations on first load
  useEffect(() => {
    if (locations.length > 0) {
      setExpandedLocations(new Set(locations.map(l => l.id)));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locations.length]);

  function toggleLocation(id: string) {
    setExpandedLocations(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const selectedLocation = selected?.type === 'location' && selected.id
    ? locations.find(l => l.id === selected.id) ?? null
    : null;

  const selectedRadiologist = selected?.type === 'radiologist' && selected.id
    ? radiologists.find(r => r.id === selected.id) ?? null
    : null;

  const unassigned = radiologists.filter(r => !r.practiceId || !locations.find(l => l.id === r.practiceId));

  // ── Action wrappers ───────────────────────────────────────────────────────

  async function handleLocationSave(data: { name: string; city: string | null; color: ProfileColor }) {
    if (selectedLocation) await updateLocation(selectedLocation.id, data);
    else await createLocation(data);
    setSelected(null);
  }

  async function handleLocationDelete() {
    if (selectedLocation) { await deleteLocation(selectedLocation.id); setSelected(null); }
  }

  async function handleRadiologistSave(data: Omit<RadiologistProfile, 'id' | 'active' | 'lastUsed' | 'createdAt' | 'updatedAt'>) {
    if (selectedRadiologist) await updateRadiologist(selectedRadiologist.id, data as any);
    else await createRadiologist(data as any);
    setSelected(null);
  }

  async function handleRadiologistDelete() {
    if (selectedRadiologist) { await deleteRadiologist(selectedRadiologist.id); setSelected(null); }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Locations</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            Manage your coverage locations and radiologists
          </p>
        </div>
        <button
          onClick={() => setSelected({ type: 'location', id: null })}
          className="px-4 py-2 rounded-xl text-white text-sm font-semibold hover:opacity-90 transition-opacity shadow-lg"
          style={{
            background: `linear-gradient(135deg, ${theme.colors.primary}, ${theme.colors.accent})`,
            boxShadow: `0 4px 14px rgba(37,99,168,0.35)`,
          }}
        >
          + New Location
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* ── Left: Location tree ────────────────────────────────────── */}
        <div className="lg:col-span-2 card min-h-[300px]">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
            {locations.length} Location{locations.length !== 1 ? 's' : ''} · {radiologists.length} Radiologist{radiologists.length !== 1 ? 's' : ''}
          </p>

          {locations.length === 0 && (
            <div className="text-center py-10">
              <div className="text-3xl mb-3">📍</div>
              <p className="text-slate-400 text-sm font-medium">No locations yet</p>
              <p className="text-slate-500 text-xs mt-1 mb-4">
                Create a location to organize your radiologists
              </p>
              <button
                onClick={() => setSelected({ type: 'location', id: null })}
                className="text-sm px-4 py-2 rounded-xl font-medium text-white hover:opacity-90 transition-opacity"
                style={{ background: `linear-gradient(135deg, ${theme.colors.primary}, ${theme.colors.accent})` }}
              >
                Create first location
              </button>
            </div>
          )}

          <div className="space-y-0.5">
            {locations.map(loc => {
              const locRads = radiologists.filter(r => r.practiceId === loc.id);
              const isExpanded = expandedLocations.has(loc.id);
              const isActive = selected?.type === 'location' && selected.id === loc.id;

              return (
                <div key={loc.id}>
                  {/* Location row */}
                  <div
                    className="flex items-center gap-2 px-2 py-2 rounded-lg cursor-pointer transition-all group"
                    style={isActive
                      ? { background: 'rgba(37,99,168,0.18)', borderLeft: `2px solid ${COLOR_HEX[loc.color]}`, paddingLeft: 6 }
                      : { borderLeft: '2px solid transparent', paddingLeft: 6 }
                    }
                    onClick={() => setSelected({ type: 'location', id: loc.id })}
                  >
                    <button
                      onClick={e => { e.stopPropagation(); toggleLocation(loc.id); }}
                      className="text-slate-500 hover:text-white transition-colors text-xs w-4 shrink-0"
                    >
                      {isExpanded ? '▾' : '▸'}
                    </button>
                    <span
                      style={{ width: 8, height: 8, borderRadius: '50%', background: COLOR_HEX[loc.color], flexShrink: 0 }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">{loc.name}</p>
                      {loc.city && (
                        <p className="text-[10px] text-slate-500 font-mono leading-none">{loc.city}</p>
                      )}
                    </div>
                    <span className="text-xs text-slate-500 shrink-0">{locRads.length}r</span>
                  </div>

                  {/* Radiologists under location */}
                  {isExpanded && (
                    <div className="ml-6 space-y-0.5 mt-0.5 mb-1">
                      {locRads.map(rad => {
                        const isRadActive = selected?.type === 'radiologist' && selected.id === rad.id;
                        return (
                          <div
                            key={rad.id}
                            className="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-all"
                            style={isRadActive ? { background: 'rgba(37,99,168,0.12)' } : {}}
                            onClick={() => setSelected({ type: 'radiologist', id: rad.id })}
                          >
                            <ProfileAvatar initials={rad.initials} color={rad.color} size="xs" />
                            <span className="text-sm text-slate-300 flex-1 truncate">{rad.name}</span>
                            {rad.id === activeProfile?.id && (
                              <span
                                className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold"
                                style={{ background: 'rgba(91,184,212,0.2)', color: theme.colors.accent }}
                              >
                                YOU
                              </span>
                            )}
                          </div>
                        );
                      })}
                      <button
                        onClick={() => setSelected({ type: 'radiologist', id: null, parentId: loc.id })}
                        className="flex items-center gap-1.5 px-2 py-1 text-xs text-slate-500 hover:text-slate-300 transition-colors w-full"
                      >
                        <span>＋</span> Add radiologist
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Unassigned radiologists */}
            {unassigned.length > 0 && (
              <div className="mt-3 pt-3 border-t border-white/8">
                <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold px-2 mb-1">
                  Unassigned
                </p>
                {unassigned.map(rad => {
                  const isRadActive = selected?.type === 'radiologist' && selected.id === rad.id;
                  return (
                    <div
                      key={rad.id}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-all"
                      style={isRadActive ? { background: 'rgba(37,99,168,0.12)' } : {}}
                      onClick={() => setSelected({ type: 'radiologist', id: rad.id })}
                    >
                      <ProfileAvatar initials={rad.initials} color={rad.color} size="xs" />
                      <span className="text-sm text-slate-400 flex-1 truncate">{rad.name}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── Right: Form panel ─────────────────────────────────────── */}
        <div className="lg:col-span-3 card min-h-[300px]">
          {!selected ? (
            <div className="flex flex-col items-center justify-center h-full py-16 gap-3 text-center">
              <div
                className="w-12 h-12 rounded-2xl flex items-center justify-center text-xl"
                style={{ background: 'rgba(37,99,168,0.12)', border: '1px solid rgba(91,184,212,0.2)' }}
              >
                📍
              </div>
              <div>
                <p className="text-slate-300 text-sm font-medium">Select a location or radiologist to edit</p>
                <p className="text-slate-500 text-xs mt-0.5">or create something new</p>
              </div>
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => setSelected({ type: 'location', id: null })}
                  className="px-4 py-2 rounded-xl text-sm font-medium text-white hover:opacity-90 transition-opacity"
                  style={{ background: `linear-gradient(135deg, ${theme.colors.primary}, ${theme.colors.accent})` }}
                >
                  + New Location
                </button>
                <button
                  onClick={() => setSelected({ type: 'radiologist', id: null })}
                  className="px-4 py-2 rounded-xl text-sm font-medium border border-white/15 text-slate-300 hover:border-white/30 hover:text-white transition-colors"
                >
                  + New Radiologist
                </button>
              </div>
            </div>
          ) : selected.type === 'location' ? (
            <LocationForm
              location={selectedLocation}
              onSave={handleLocationSave}
              onDelete={selectedLocation ? handleLocationDelete : undefined}
              onCancel={() => setSelected(null)}
            />
          ) : (
            <RadiologistForm
              radiologist={selectedRadiologist}
              locations={locations}
              defaultLocationId={selected.parentId}
              onSave={handleRadiologistSave}
              onDelete={selectedRadiologist ? handleRadiologistDelete : undefined}
              onCancel={() => setSelected(null)}
            />
          )}
        </div>
      </div>

      {/* Setup guide — shown when empty */}
      {locations.length === 0 && radiologists.length === 0 && (
        <div
          className="p-5 rounded-2xl border space-y-3"
          style={{ background: 'rgba(37,99,168,0.06)', borderColor: 'rgba(91,184,212,0.15)' }}
        >
          <p className="text-sm font-semibold text-white">Quick setup</p>
          <div className="grid sm:grid-cols-3 gap-3 text-xs text-slate-400">
            {[
              ['1', 'Create one or more Locations', 'e.g. Baptist Memorial Hospital–Memphis'],
              ['2', 'Add Radiologists', 'Assign each to a default location'],
              ['3', 'Start logging studies', 'Or import from PowerScribe / CSV'],
            ].map(([n, title, sub]) => (
              <div key={n} className="flex gap-2.5">
                <span
                  className="w-5 h-5 rounded-full text-xs font-bold shrink-0 flex items-center justify-center mt-0.5"
                  style={{ background: theme.colors.primary, color: 'white' }}
                >
                  {n}
                </span>
                <div>
                  <p className="text-slate-300 font-medium">{title}</p>
                  <p className="text-slate-500">{sub}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
