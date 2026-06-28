/**
 * Organizations.tsx
 *
 * CRUD management page for the Org → Practice → Radiologist hierarchy.
 * Left panel: tree view of orgs/practices/radiologists.
 * Right panel: create / edit form for the selected node.
 */

import { useState } from 'react';
import { useOrg } from '../hooks/useOrg';
import { ProfileAvatar } from '../components/OrgSwitcher';
import { theme } from '../lib/theme';
import type { Organization, Practice, RadiologistProfile, ProfileColor } from '../types';

// ─── Types ────────────────────────────────────────────────────────────────────

type NodeType = 'org' | 'practice' | 'radiologist';

interface SelectedNode {
  type: NodeType;
  id: string | null; // null = new
}

// ─── Color options (subset of ProfileColor) ───────────────────────────────────
const COLOR_OPTIONS: ProfileColor[] = ['indigo', 'violet', 'emerald', 'amber', 'rose', 'cyan', 'orange', 'teal'];

// ─── Small helpers ────────────────────────────────────────────────────────────

function ColorDot({ color }: { color: ProfileColor }) {
  const palette: Record<ProfileColor, string> = {
    indigo: '#2563A8', violet: '#5BB8D4', emerald: '#10b981',
    amber: '#f59e0b', rose: '#f43f5e', cyan: '#06b6d4',
    orange: '#f97316', teal: '#14b8a6',
  };
  return (
    <span
      style={{
        display: 'inline-block',
        width: 12, height: 12,
        borderRadius: '50%',
        background: palette[color],
        flexShrink: 0,
      }}
    />
  );
}

// ─── Forms ────────────────────────────────────────────────────────────────────

function OrgForm({
  org,
  onSave,
  onDelete,
  onCancel,
}: {
  org: Organization | null;
  onSave: (data: Omit<Organization, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  onDelete?: () => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(org?.name ?? '');
  const [initials, setInitials] = useState(org?.initials ?? '');
  const [color, setColor] = useState<ProfileColor>(org?.color ?? 'cyan');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    await onSave({ name: name.trim(), initials: (initials || name.slice(0, 2)).toUpperCase().slice(0, 3), color });
    setSaving(false);
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold">
        {org ? 'Edit Organization' : 'New Organization'}
      </p>

      <div>
        <label className="block text-xs text-slate-400 mb-1.5">Name</label>
        <input className="input w-full" value={name} onChange={e => setName(e.target.value)} placeholder="Baptist Medical Group" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-slate-400 mb-1.5">Initials (≤3)</label>
          <input className="input w-full" maxLength={3} value={initials} onChange={e => setInitials(e.target.value.toUpperCase())} placeholder="BMG" />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1.5">Color</label>
          <div className="flex flex-wrap gap-2 mt-1">
            {COLOR_OPTIONS.map(c => (
              <button key={c} onClick={() => setColor(c)} title={c}
                style={{ width: 22, height: 22, borderRadius: '50%', border: color === c ? '2px solid white' : '2px solid transparent' }}>
                <ColorDot color={c} />
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex gap-2 pt-2">
        <button
          onClick={handleSave}
          disabled={!name.trim() || saving}
          className="flex-1 py-2 rounded-xl text-sm font-semibold text-white hover:opacity-90 transition-opacity disabled:opacity-50"
          style={{ background: `linear-gradient(135deg, ${theme.colors.primary}, ${theme.colors.accent})` }}
        >
          {saving ? 'Saving…' : org ? 'Update' : 'Create Organization'}
        </button>
        <button onClick={onCancel} className="px-4 py-2 rounded-xl text-sm text-slate-400 hover:text-white border border-white/10 transition-colors">
          Cancel
        </button>
      </div>

      {org && onDelete && (
        <div className="pt-1 border-t border-white/8">
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <p className="text-xs text-red-400 flex-1">Delete this org and all its data?</p>
              <button onClick={onDelete} className="text-xs px-3 py-1.5 rounded-lg bg-red-500/20 text-red-400 border border-red-500/30">Confirm</button>
              <button onClick={() => setConfirmDelete(false)} className="text-xs px-3 py-1.5 rounded-lg border border-white/10 text-slate-400">Cancel</button>
            </div>
          ) : (
            <button onClick={() => setConfirmDelete(true)} className="text-xs text-red-400 hover:text-red-300 transition-colors">
              Delete organization…
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function PracticeForm({
  practice,
  organizations,
  onSave,
  onDelete,
  onCancel,
}: {
  practice: Practice | null;
  organizations: Organization[];
  onSave: (data: Omit<Practice, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  onDelete?: () => Promise<void>;
  onCancel: () => void;
}) {
  const [orgId, setOrgId] = useState(practice?.organizationId ?? organizations[0]?.id ?? '');
  const [name, setName] = useState(practice?.name ?? '');
  const [city, setCity] = useState(practice?.city ?? '');
  const [color, setColor] = useState<ProfileColor>(practice?.color ?? 'teal');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function handleSave() {
    if (!name.trim() || !orgId) return;
    setSaving(true);
    await onSave({ organizationId: orgId, name: name.trim(), city: city.trim() || null, color });
    setSaving(false);
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold">
        {practice ? 'Edit Practice / Site' : 'New Practice / Site'}
      </p>

      <div>
        <label className="block text-xs text-slate-400 mb-1.5">Organization</label>
        <select className="input w-full" value={orgId} onChange={e => setOrgId(e.target.value)}>
          {organizations.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-slate-400 mb-1.5">Practice Name</label>
          <input className="input w-full" value={name} onChange={e => setName(e.target.value)} placeholder="Memphis" />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1.5">City (optional)</label>
          <input className="input w-full" value={city} onChange={e => setCity(e.target.value)} placeholder="Memphis, TN" />
        </div>
      </div>

      <div>
        <label className="block text-xs text-slate-400 mb-1.5">Color</label>
        <div className="flex flex-wrap gap-2 mt-1">
          {COLOR_OPTIONS.map(c => (
            <button key={c} onClick={() => setColor(c)} title={c}
              style={{ width: 22, height: 22, borderRadius: '50%', border: color === c ? '2px solid white' : '2px solid transparent' }}>
              <ColorDot color={c} />
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-2 pt-2">
        <button
          onClick={handleSave}
          disabled={!name.trim() || !orgId || saving}
          className="flex-1 py-2 rounded-xl text-sm font-semibold text-white hover:opacity-90 transition-opacity disabled:opacity-50"
          style={{ background: `linear-gradient(135deg, ${theme.colors.primary}, ${theme.colors.accent})` }}
        >
          {saving ? 'Saving…' : practice ? 'Update' : 'Create Practice'}
        </button>
        <button onClick={onCancel} className="px-4 py-2 rounded-xl text-sm text-slate-400 hover:text-white border border-white/10 transition-colors">
          Cancel
        </button>
      </div>

      {practice && onDelete && (
        <div className="pt-1 border-t border-white/8">
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <p className="text-xs text-red-400 flex-1">Delete this practice?</p>
              <button onClick={onDelete} className="text-xs px-3 py-1.5 rounded-lg bg-red-500/20 text-red-400 border border-red-500/30">Confirm</button>
              <button onClick={() => setConfirmDelete(false)} className="text-xs px-3 py-1.5 rounded-lg border border-white/10 text-slate-400">Cancel</button>
            </div>
          ) : (
            <button onClick={() => setConfirmDelete(true)} className="text-xs text-red-400 hover:text-red-300 transition-colors">
              Delete practice…
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function RadiologistForm({
  radiologist,
  practices,
  onSave,
  onDelete,
  onCancel,
}: {
  radiologist: RadiologistProfile | null;
  practices: Practice[];
  onSave: (data: Omit<RadiologistProfile, 'id' | 'active' | 'lastUsed' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  onDelete?: () => Promise<void>;
  onCancel: () => void;
}) {
  const [practiceId, setPracticeId] = useState<string>(radiologist?.practiceId ?? practices[0]?.id ?? '');
  const [name, setName] = useState(radiologist?.name ?? '');
  const [initials, setInitials] = useState(radiologist?.initials ?? '');
  const [color, setColor] = useState<ProfileColor>(radiologist?.color ?? 'indigo');
  const [annualGoal, setAnnualGoal] = useState(radiologist?.annualRvuGoal ?? 5000);
  const [dailyGoal, setDailyGoal] = useState(radiologist?.dailyRvuGoal ?? 90);
  const [fiscalMonth, setFiscalMonth] = useState(radiologist?.fiscalYearStartMonth ?? 10);
  const [workStart, setWorkStart] = useState(radiologist?.workdayStart ?? '07:00');
  const [workEnd, setWorkEnd] = useState(radiologist?.workdayEnd ?? '17:00');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    await onSave({
      practiceId: practiceId || null,
      name: name.trim(),
      initials: (initials || name.slice(0, 2)).toUpperCase().slice(0, 3),
      color,
      annualRvuGoal: annualGoal,
      dailyRvuGoal: dailyGoal,
      fiscalYearStartMonth: fiscalMonth,
      workdayStart: workStart,
      workdayEnd: workEnd,
      breakMinutes: radiologist?.breakMinutes ?? 0,
      createdAt: radiologist?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as any);
    setSaving(false);
  }

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold">
        {radiologist ? 'Edit Radiologist' : 'New Radiologist'}
      </p>

      {practices.length > 0 && (
        <div>
          <label className="block text-xs text-slate-400 mb-1.5">Practice</label>
          <select className="input w-full" value={practiceId} onChange={e => setPracticeId(e.target.value)}>
            <option value="">— Unassigned —</option>
            {practices.map(p => <option key={p.id} value={p.id}>{p.name}{p.city ? ` (${p.city})` : ''}</option>)}
          </select>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-slate-400 mb-1.5">Full Name</label>
          <input className="input w-full" value={name} onChange={e => setName(e.target.value)} placeholder="Dr. Will Stewart" />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1.5">Initials (≤3)</label>
          <input className="input w-full" maxLength={3} value={initials} onChange={e => setInitials(e.target.value.toUpperCase())} placeholder="WS" />
        </div>
      </div>

      <div>
        <label className="block text-xs text-slate-400 mb-1.5">Color</label>
        <div className="flex flex-wrap gap-2 mt-1">
          {COLOR_OPTIONS.map(c => (
            <button key={c} onClick={() => setColor(c)} title={c}
              style={{ width: 22, height: 22, borderRadius: '50%', border: color === c ? '2px solid white' : '2px solid transparent' }}>
              <ColorDot color={c} />
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-slate-400 mb-1.5">Annual wRVU Goal</label>
          <input type="number" className="input w-full" value={annualGoal} onChange={e => setAnnualGoal(Number(e.target.value))} min={100} step={100} />
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

      <div className="flex gap-2 pt-2">
        <button
          onClick={handleSave}
          disabled={!name.trim() || saving}
          className="flex-1 py-2 rounded-xl text-sm font-semibold text-white hover:opacity-90 transition-opacity disabled:opacity-50"
          style={{ background: `linear-gradient(135deg, ${theme.colors.primary}, ${theme.colors.accent})` }}
        >
          {saving ? 'Saving…' : radiologist ? 'Update' : 'Create Radiologist'}
        </button>
        <button onClick={onCancel} className="px-4 py-2 rounded-xl text-sm text-slate-400 hover:text-white border border-white/10 transition-colors">
          Cancel
        </button>
      </div>

      {radiologist && onDelete && (
        <div className="pt-1 border-t border-white/8">
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <p className="text-xs text-red-400 flex-1">Delete this radiologist? Study logs are preserved.</p>
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

export function Organizations({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const {
    organizations, practices, radiologists,
    createOrganization, updateOrganization, deleteOrganization,
    createPractice, updatePractice, deletePractice,
    createRadiologist, updateRadiologist, deleteRadiologist,
  } = useOrg();

  const [selected, setSelected] = useState<SelectedNode | null>(null);
  const [expandedOrgs, setExpandedOrgs] = useState<Set<string>>(new Set(organizations.map(o => o.id)));
  const [expandedPractices, setExpandedPractices] = useState<Set<string>>(new Set(practices.map(p => p.id)));

  function toggleOrg(id: string) {
    setExpandedOrgs(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function togglePractice(id: string) {
    setExpandedPractices(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  // ── derive selected entities ──────────────────────────────────────────────
  const selectedOrg = selected?.type === 'org' && selected.id
    ? organizations.find(o => o.id === selected.id) ?? null
    : null;
  const selectedPractice = selected?.type === 'practice' && selected.id
    ? practices.find(p => p.id === selected.id) ?? null
    : null;
  const selectedRadiologist = selected?.type === 'radiologist' && selected.id
    ? radiologists.find(r => r.id === selected.id) ?? null
    : null;

  // ── action wrappers ───────────────────────────────────────────────────────
  async function handleOrgSave(data: Omit<Organization, 'id' | 'createdAt' | 'updatedAt'>) {
    if (selectedOrg) await updateOrganization(selectedOrg.id, data);
    else await createOrganization(data);
    setSelected(null);
  }
  async function handleOrgDelete() {
    if (selectedOrg) { await deleteOrganization(selectedOrg.id); setSelected(null); }
  }
  async function handlePracticeSave(data: Omit<Practice, 'id' | 'createdAt' | 'updatedAt'>) {
    if (selectedPractice) await updatePractice(selectedPractice.id, data);
    else await createPractice(data);
    setSelected(null);
  }
  async function handlePracticeDelete() {
    if (selectedPractice) { await deletePractice(selectedPractice.id); setSelected(null); }
  }
  async function handleRadiologistSave(data: Omit<RadiologistProfile, 'id' | 'active' | 'lastUsed' | 'createdAt' | 'updatedAt'>) {
    if (selectedRadiologist) await updateRadiologist(selectedRadiologist.id, data as any);
    else await createRadiologist(data as any);
    setSelected(null);
  }
  async function handleRadiologistDelete() {
    if (selectedRadiologist) { await deleteRadiologist(selectedRadiologist.id); setSelected(null); }
  }

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Organizations</h1>
          <p className="text-slate-400 text-sm mt-0.5">Manage your org → practice → radiologist hierarchy</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* ── Left: Tree ─────────────────────────────────────────────────── */}
        <div className="lg:col-span-2 card space-y-1 min-h-[300px]">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Structure</p>
            <button
              onClick={() => setSelected({ type: 'org', id: null })}
              className="text-xs px-2.5 py-1 rounded-lg transition-colors"
              style={{ background: 'rgba(37,99,168,0.2)', color: theme.colors.accent }}
            >
              + Org
            </button>
          </div>

          {organizations.length === 0 && (
            <div className="text-center py-8">
              <p className="text-slate-500 text-sm">No organizations yet</p>
              <button
                onClick={() => setSelected({ type: 'org', id: null })}
                className="mt-2 text-xs transition-colors"
                style={{ color: theme.colors.accent }}
              >
                Create your first org →
              </button>
            </div>
          )}

          {organizations.map(org => {
            const orgPractices = practices.filter(p => p.organizationId === org.id);
            const isExpanded = expandedOrgs.has(org.id);
            const isActive = selected?.type === 'org' && selected.id === org.id;
            return (
              <div key={org.id}>
                {/* Org row */}
                <div
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-all"
                  style={isActive ? { background: 'rgba(37,99,168,0.15)' } : {}}
                  onClick={() => setSelected({ type: 'org', id: org.id })}
                >
                  <button
                    onClick={e => { e.stopPropagation(); toggleOrg(org.id); }}
                    className="text-slate-500 hover:text-white transition-colors text-xs w-4"
                  >
                    {isExpanded ? '▾' : '▸'}
                  </button>
                  <ProfileAvatar initials={org.initials} color={org.color} size="xs" />
                  <span className="text-sm font-medium text-white flex-1 truncate">{org.name}</span>
                  <span className="text-xs text-slate-500">{orgPractices.length}p</span>
                </div>

                {/* Practices */}
                {isExpanded && orgPractices.map(practice => {
                  const practiceRads = radiologists.filter(r => r.practiceId === practice.id);
                  const isPracticeExpanded = expandedPractices.has(practice.id);
                  const isPracticeActive = selected?.type === 'practice' && selected.id === practice.id;
                  return (
                    <div key={practice.id} className="ml-6">
                      <div
                        className="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-all"
                        style={isPracticeActive ? { background: 'rgba(37,99,168,0.12)' } : {}}
                        onClick={() => setSelected({ type: 'practice', id: practice.id })}
                      >
                        <button
                          onClick={e => { e.stopPropagation(); togglePractice(practice.id); }}
                          className="text-slate-500 hover:text-white transition-colors text-xs w-4"
                        >
                          {isPracticeExpanded ? '▾' : '▸'}
                        </button>
                        <ColorDot color={practice.color} />
                        <span className="text-sm text-slate-200 flex-1 truncate">{practice.name}</span>
                        {practice.city && <span className="text-xs text-slate-500 hidden sm:inline">{practice.city}</span>}
                        <span className="text-xs text-slate-500">{practiceRads.length}r</span>
                      </div>

                      {/* Radiologists */}
                      {isPracticeExpanded && practiceRads.map(rad => {
                        const isRadActive = selected?.type === 'radiologist' && selected.id === rad.id;
                        return (
                          <div
                            key={rad.id}
                            className="ml-6 flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-all"
                            style={isRadActive ? { background: 'rgba(37,99,168,0.1)' } : {}}
                            onClick={() => setSelected({ type: 'radiologist', id: rad.id })}
                          >
                            <ProfileAvatar initials={rad.initials} color={rad.color} size="xs" />
                            <span className="text-sm text-slate-300 flex-1 truncate">{rad.name}</span>
                            {rad.active && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium" style={{ background: 'rgba(91,184,212,0.2)', color: theme.colors.accent }}>YOU</span>
                            )}
                          </div>
                        );
                      })}

                      {isPracticeExpanded && (
                        <button
                          onClick={() => setSelected({ type: 'radiologist', id: null })}
                          className="ml-6 flex items-center gap-1.5 px-2 py-1 text-xs text-slate-500 hover:text-slate-300 transition-colors"
                        >
                          <span>＋</span> Add radiologist
                        </button>
                      )}
                    </div>
                  );
                })}

                {isExpanded && (
                  <button
                    onClick={() => setSelected({ type: 'practice', id: null })}
                    className="ml-6 flex items-center gap-1.5 px-2 py-1 text-xs text-slate-500 hover:text-slate-300 transition-colors"
                  >
                    <span>＋</span> Add practice
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* ── Right: Form panel ──────────────────────────────────────────── */}
        <div className="lg:col-span-3 card min-h-[300px]">
          {!selected ? (
            <div className="flex flex-col items-center justify-center h-full py-16 gap-4">
              <p className="text-slate-500 text-sm">Select a node to edit, or create a new one</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setSelected({ type: 'org', id: null })}
                  className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-90"
                  style={{ background: `linear-gradient(135deg, ${theme.colors.primary}, ${theme.colors.accent})` }}
                >
                  + New Organization
                </button>
              </div>
            </div>
          ) : selected.type === 'org' ? (
            <OrgForm
              org={selectedOrg}
              onSave={handleOrgSave}
              onDelete={selectedOrg ? handleOrgDelete : undefined}
              onCancel={() => setSelected(null)}
            />
          ) : selected.type === 'practice' ? (
            <PracticeForm
              practice={selectedPractice}
              organizations={organizations}
              onSave={handlePracticeSave}
              onDelete={selectedPractice ? handlePracticeDelete : undefined}
              onCancel={() => setSelected(null)}
            />
          ) : (
            <RadiologistForm
              radiologist={selectedRadiologist}
              practices={practices}
              onSave={handleRadiologistSave}
              onDelete={selectedRadiologist ? handleRadiologistDelete : undefined}
              onCancel={() => setSelected(null)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
