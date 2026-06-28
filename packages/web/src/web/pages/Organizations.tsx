/**
 * Organizations.tsx
 *
 * Full CRUD management page for the Org → Practice → Radiologist hierarchy.
 *
 * Layout:
 *   Left panel  — tree view (orgs → practices → radiologists)
 *   Right panel — context-sensitive form (create / edit any of the three types)
 */

import { useState, useCallback } from 'react';
import { useOrg } from '../hooks/useOrg';
import { ProfileAvatar } from '../components/OrgSwitcher';
import type {
  Organization,
  Practice,
  RadiologistProfile,
  ProfileColor,
} from '../types';

// ─── Constants ─────────────────────────────────────────────────────────────────

const COLORS: { value: ProfileColor; label: string; dot: string }[] = [
  { value: 'indigo',  label: 'Indigo',  dot: '#6366f1' },
  { value: 'violet',  label: 'Violet',  dot: '#8b5cf6' },
  { value: 'emerald', label: 'Emerald', dot: '#10b981' },
  { value: 'amber',   label: 'Amber',   dot: '#f59e0b' },
  { value: 'rose',    label: 'Rose',    dot: '#f43f5e' },
  { value: 'cyan',    label: 'Cyan',    dot: '#06b6d4' },
  { value: 'orange',  label: 'Orange',  dot: '#f97316' },
  { value: 'teal',    label: 'Teal',    dot: '#14b8a6' },
];

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

// ─── Selection state ───────────────────────────────────────────────────────────

type SelectionType = 'org' | 'practice' | 'radiologist';

interface Selection {
  type: SelectionType;
  /** ID of the selected entity. null = "new" mode. */
  id: string | null;
  /** For new practice / new radiologist — the parent IDs. */
  parentOrgId?: string;
  parentPracticeId?: string;
}

// ─── Form data types ───────────────────────────────────────────────────────────

interface OrgFormData {
  name: string;
  initials: string;
  color: ProfileColor;
}

interface PracticeFormData {
  name: string;
  city: string;
  color: ProfileColor;
}

interface RadiologistFormData {
  name: string;
  initials: string;
  color: ProfileColor;
  practiceId: string;
  dailyRvuGoal: number;
  annualRvuGoal: number;
  fiscalYearStartMonth: number;
  workdayStart: string;
  workdayEnd: string;
  breakMinutes: number;
}

// ─── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULT_ORG: OrgFormData = { name: '', initials: '', color: 'indigo' };
const DEFAULT_PRACTICE: PracticeFormData = { name: '', city: '', color: 'violet' };
const DEFAULT_RADIOLOGIST: RadiologistFormData = {
  name: '',
  initials: '',
  color: 'emerald',
  practiceId: '',
  dailyRvuGoal: 90,
  annualRvuGoal: 15000,
  fiscalYearStartMonth: 1,
  workdayStart: '08:00',
  workdayEnd: '17:00',
  breakMinutes: 0,
};

// ─── Utility ───────────────────────────────────────────────────────────────────

function autoInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

// ─── Color Picker ──────────────────────────────────────────────────────────────

function ColorPicker({
  value,
  onChange,
}: {
  value: ProfileColor;
  onChange: (c: ProfileColor) => void;
}) {
  return (
    <div className="flex gap-2 flex-wrap">
      {COLORS.map((c) => (
        <button
          key={c.value}
          type="button"
          onClick={() => onChange(c.value)}
          title={c.label}
          style={{ background: c.dot }}
          className={`w-7 h-7 rounded-full border-2 transition-all ${
            value === c.value
              ? 'border-white scale-110 shadow-lg'
              : 'border-transparent opacity-70 hover:opacity-100'
          }`}
        />
      ))}
    </div>
  );
}

// ─── Shared form field ─────────────────────────────────────────────────────────

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs text-slate-400 mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  maxLength,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  maxLength?: number;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      maxLength={maxLength}
      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
    />
  );
}

function NumberInput({
  value,
  onChange,
  min,
  step,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  step?: number;
}) {
  return (
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      min={min}
      step={step}
      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
    />
  );
}

// ─── Organization Form ─────────────────────────────────────────────────────────

function OrgForm({
  initial,
  isNew,
  onSave,
  onCancel,
  onDelete,
  saving,
}: {
  initial: OrgFormData;
  isNew: boolean;
  onSave: (d: OrgFormData) => Promise<void>;
  onCancel: () => void;
  onDelete?: () => Promise<void>;
  saving: boolean;
}) {
  const [form, setForm] = useState<OrgFormData>(initial);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function update(patch: Partial<OrgFormData>) {
    setForm((p) => ({ ...p, ...patch }));
  }

  function handleName(name: string) {
    update({ name, initials: autoInitials(name) || form.initials });
  }

  async function handleDelete() {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setDeleting(true);
    await onDelete?.();
    setDeleting(false);
  }

  return (
    <div className="space-y-6">
      {/* Preview */}
      <div className="flex items-center gap-4 pb-4 border-b border-white/8">
        <ProfileAvatar initials={form.initials || '?'} color={form.color} size="md" />
        <div>
          <p className="text-white font-semibold text-lg">{form.name || 'New Organization'}</p>
          <p className="text-slate-400 text-xs uppercase tracking-wider">Organization</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <Field label="Organization Name *">
            <TextInput value={form.name} onChange={handleName} placeholder="e.g. Baptist Medical Group" />
          </Field>
        </div>
        <Field label="Initials (≤3 chars)">
          <TextInput
            value={form.initials}
            onChange={(v) => update({ initials: v.toUpperCase().slice(0, 3) })}
            placeholder="BMG"
            maxLength={3}
          />
        </Field>
        <Field label="Color">
          <div className="pt-1">
            <ColorPicker value={form.color} onChange={(c) => update({ color: c })} />
          </div>
        </Field>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between pt-2">
        {!isNew && onDelete ? (
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
              confirmDelete
                ? 'bg-red-600 text-white hover:bg-red-700'
                : 'text-red-400 hover:text-red-300 hover:bg-red-900/20'
            }`}
          >
            {deleting ? 'Deleting…' : confirmDelete ? 'Confirm Delete' : 'Delete Org'}
          </button>
        ) : <div />}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => { setConfirmDelete(false); onCancel(); }}
            className="px-4 py-2 text-sm text-slate-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!form.name.trim() || saving}
            onClick={() => onSave(form)}
            className="px-4 py-2 text-sm font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
          >
            {saving ? 'Saving…' : isNew ? 'Create' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Practice Form ─────────────────────────────────────────────────────────────

function PracticeForm({
  initial,
  isNew,
  orgName,
  onSave,
  onCancel,
  onDelete,
  saving,
}: {
  initial: PracticeFormData;
  isNew: boolean;
  orgName: string;
  onSave: (d: PracticeFormData) => Promise<void>;
  onCancel: () => void;
  onDelete?: () => Promise<void>;
  saving: boolean;
}) {
  const [form, setForm] = useState<PracticeFormData>(initial);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function update(patch: Partial<PracticeFormData>) {
    setForm((p) => ({ ...p, ...patch }));
  }

  async function handleDelete() {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setDeleting(true);
    await onDelete?.();
    setDeleting(false);
  }

  return (
    <div className="space-y-6">
      {/* Preview */}
      <div className="flex items-center gap-4 pb-4 border-b border-white/8">
        <ProfileAvatar
          initials={form.name ? form.name.slice(0, 2).toUpperCase() : '?'}
          color={form.color}
          size="md"
        />
        <div>
          <p className="text-white font-semibold text-lg">{form.name || 'New Practice'}</p>
          <p className="text-slate-400 text-xs">
            <span className="uppercase tracking-wider">Practice</span>
            {orgName && <span className="text-slate-500"> · {orgName}</span>}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <Field label="Practice Name *">
            <TextInput value={form.name} onChange={(v) => update({ name: v })} placeholder="e.g. Memphis Main Campus" />
          </Field>
        </div>
        <Field label="City / Location">
          <TextInput value={form.city} onChange={(v) => update({ city: v })} placeholder="Memphis, TN" />
        </Field>
        <Field label="Color">
          <div className="pt-1">
            <ColorPicker value={form.color} onChange={(c) => update({ color: c })} />
          </div>
        </Field>
      </div>

      <div className="flex items-center justify-between pt-2">
        {!isNew && onDelete ? (
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
              confirmDelete
                ? 'bg-red-600 text-white hover:bg-red-700'
                : 'text-red-400 hover:text-red-300 hover:bg-red-900/20'
            }`}
          >
            {deleting ? 'Deleting…' : confirmDelete ? 'Confirm Delete' : 'Delete Practice'}
          </button>
        ) : <div />}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => { setConfirmDelete(false); onCancel(); }}
            className="px-4 py-2 text-sm text-slate-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!form.name.trim() || saving}
            onClick={() => onSave(form)}
            className="px-4 py-2 text-sm font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
          >
            {saving ? 'Saving…' : isNew ? 'Create' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Radiologist Form ──────────────────────────────────────────────────────────

function RadiologistForm({
  initial,
  isNew,
  practices,
  onSave,
  onCancel,
  onDelete,
  saving,
}: {
  initial: RadiologistFormData;
  isNew: boolean;
  practices: Practice[];
  onSave: (d: RadiologistFormData) => Promise<void>;
  onCancel: () => void;
  onDelete?: () => Promise<void>;
  saving: boolean;
}) {
  const [form, setForm] = useState<RadiologistFormData>(initial);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function update(patch: Partial<RadiologistFormData>) {
    setForm((p) => ({ ...p, ...patch }));
  }

  function handleName(name: string) {
    update({ name, initials: autoInitials(name) || form.initials });
  }

  async function handleDelete() {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setDeleting(true);
    await onDelete?.();
    setDeleting(false);
  }

  return (
    <div className="space-y-6">
      {/* Preview */}
      <div className="flex items-center gap-4 pb-4 border-b border-white/8">
        <ProfileAvatar initials={form.initials || '?'} color={form.color} size="md" />
        <div>
          <p className="text-white font-semibold text-lg">{form.name || 'New Radiologist'}</p>
          <p className="text-slate-400 text-xs">
            <span className="uppercase tracking-wider">Radiologist</span>
            {form.practiceId && practices.length > 0 && (
              <span className="text-slate-500">
                {' · '}{practices.find((p) => p.id === form.practiceId)?.name ?? ''}
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Identity */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <Field label="Name *">
            <TextInput value={form.name} onChange={handleName} placeholder="e.g. Dr. Will Stewart" />
          </Field>
        </div>
        <Field label="Initials (≤3 chars)">
          <TextInput
            value={form.initials}
            onChange={(v) => update({ initials: v.toUpperCase().slice(0, 3) })}
            placeholder="WS"
            maxLength={3}
          />
        </Field>
        <Field label="Color">
          <div className="pt-1">
            <ColorPicker value={form.color} onChange={(c) => update({ color: c })} />
          </div>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Practice">
            <select
              value={form.practiceId}
              onChange={(e) => update({ practiceId: e.target.value })}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">— Unassigned —</option>
              {practices.map((p) => (
                <option key={p.id} value={p.id}>{p.name}{p.city ? ` (${p.city})` : ''}</option>
              ))}
            </select>
          </Field>
        </div>
      </div>

      {/* Goals */}
      <div>
        <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
          Goals &amp; Schedule
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Daily wRVU Goal">
            <NumberInput value={form.dailyRvuGoal} onChange={(v) => update({ dailyRvuGoal: v })} min={1} />
          </Field>
          <Field label="Annual wRVU Goal">
            <NumberInput value={form.annualRvuGoal} onChange={(v) => update({ annualRvuGoal: v })} min={1} />
          </Field>
          <Field label="Fiscal Year Start">
            <select
              value={form.fiscalYearStartMonth}
              onChange={(e) => update({ fiscalYearStartMonth: Number(e.target.value) })}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {MONTHS.map((m, i) => (
                <option key={i + 1} value={i + 1}>{m}</option>
              ))}
            </select>
          </Field>
          <Field label="Break Minutes / Day">
            <NumberInput value={form.breakMinutes} onChange={(v) => update({ breakMinutes: v })} min={0} step={5} />
          </Field>
          <Field label="Workday Start">
            <input
              type="time"
              value={form.workdayStart}
              onChange={(e) => update({ workdayStart: e.target.value })}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </Field>
          <Field label="Workday End">
            <input
              type="time"
              value={form.workdayEnd}
              onChange={(e) => update({ workdayEnd: e.target.value })}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </Field>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between pt-2">
        {!isNew && onDelete ? (
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
              confirmDelete
                ? 'bg-red-600 text-white hover:bg-red-700'
                : 'text-red-400 hover:text-red-300 hover:bg-red-900/20'
            }`}
          >
            {deleting ? 'Deleting…' : confirmDelete ? 'Confirm Delete' : 'Delete Radiologist'}
          </button>
        ) : <div />}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => { setConfirmDelete(false); onCancel(); }}
            className="px-4 py-2 text-sm text-slate-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!form.name.trim() || saving}
            onClick={() => onSave(form)}
            className="px-4 py-2 text-sm font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
          >
            {saving ? 'Saving…' : isNew ? 'Create' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Tree Item ─────────────────────────────────────────────────────────────────

function TreeItem({
  label,
  sub,
  avatar,
  active,
  onClick,
  indent = 0,
}: {
  label: string;
  sub?: string;
  avatar?: React.ReactNode;
  active: boolean;
  onClick: () => void;
  indent?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-all group ${
        active
          ? 'bg-indigo-600/20 text-white'
          : 'text-slate-300 hover:bg-white/5 hover:text-white'
      }`}
      style={{ paddingLeft: `${12 + indent * 16}px` }}
    >
      {avatar}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">{label}</p>
        {sub && <p className="text-xs text-slate-500 truncate">{sub}</p>}
      </div>
    </button>
  );
}

// ─── Add button ────────────────────────────────────────────────────────────────

function AddBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-slate-500 hover:text-indigo-400 hover:bg-indigo-900/10 rounded-lg transition-colors"
    >
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
      </svg>
      {label}
    </button>
  );
}

// ─── Empty state (right panel) ─────────────────────────────────────────────────

function EmptyRight() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center gap-3 text-slate-500 py-24">
      <svg className="w-12 h-12 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0H5m14 0h2m-2 0h-2M5 21H3m2 0h2M9 7h1m-1 4h1m4-4h1m-1 4h1" />
      </svg>
      <p className="text-sm">Select an item or click + to add one</p>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

interface OrganizationsProps {
  onNavigate: (tab: string) => void;
}

export default function Organizations({ onNavigate: _onNavigate }: OrganizationsProps) {
  const {
    organizations,
    practices,
    radiologists,
    createOrganization,
    updateOrganization,
    deleteOrganization,
    createPractice,
    updatePractice,
    deletePractice,
    createRadiologist,
    updateRadiologist,
    deleteRadiologist,
  } = useOrg();

  const [selection, setSelection] = useState<Selection | null>(null);
  const [saving, setSaving] = useState(false);
  // Track which orgs are expanded in the tree
  const [expandedOrgs, setExpandedOrgs] = useState<Set<string>>(new Set());

  function toggleOrg(id: string) {
    setExpandedOrgs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function select(s: Selection) {
    setSelection(s);
    // Auto-expand parent org when selecting anything inside it
    if (s.parentOrgId) {
      setExpandedOrgs((prev) => new Set([...prev, s.parentOrgId!]));
    }
  }

  // ── Derived helpers ──────────────────────────────────────────────────────────

  const practicesForOrg = useCallback(
    (orgId: string) => practices.filter((p) => p.organizationId === orgId),
    [practices],
  );

  const radiologistsForPractice = useCallback(
    (practiceId: string) => radiologists.filter((r) => r.practiceId === practiceId),
    [radiologists],
  );

  const unassignedRadiologists = radiologists.filter((r) => !r.practiceId);

  // ── Active entity lookup ─────────────────────────────────────────────────────

  const activeOrg =
    selection?.type === 'org' && selection.id
      ? (organizations.find((o) => o.id === selection.id) ?? null)
      : null;

  const activePractice =
    selection?.type === 'practice' && selection.id
      ? (practices.find((p) => p.id === selection.id) ?? null)
      : null;

  const activeRadiologist =
    selection?.type === 'radiologist' && selection.id
      ? (radiologists.find((r) => r.id === selection.id) ?? null)
      : null;

  // ── Org handlers ─────────────────────────────────────────────────────────────

  async function handleSaveOrg(data: OrgFormData) {
    setSaving(true);
    try {
      if (selection?.id) {
        await updateOrganization(selection.id, data);
      } else {
        const org = await createOrganization(data);
        setExpandedOrgs((prev) => new Set([...prev, org.id]));
        setSelection({ type: 'org', id: org.id });
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteOrg() {
    if (!selection?.id) return;
    await deleteOrganization(selection.id);
    setSelection(null);
  }

  // ── Practice handlers ────────────────────────────────────────────────────────

  async function handleSavePractice(data: PracticeFormData) {
    setSaving(true);
    try {
      const orgId = selection?.parentOrgId ?? activePractice?.organizationId ?? '';
      if (selection?.id) {
        await updatePractice(selection.id, { ...data, city: data.city || null });
      } else {
        const p = await createPractice({
          organizationId: orgId,
          name: data.name,
          city: data.city || null,
          color: data.color,
        });
        setSelection({ type: 'practice', id: p.id, parentOrgId: orgId });
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDeletePractice() {
    if (!selection?.id) return;
    await deletePractice(selection.id);
    setSelection(null);
  }

  // ── Radiologist handlers ─────────────────────────────────────────────────────

  async function handleSaveRadiologist(data: RadiologistFormData) {
    setSaving(true);
    try {
      if (selection?.id) {
        await updateRadiologist(selection.id, {
          ...data,
          practiceId: data.practiceId || null,
        });
      } else {
        const r = await createRadiologist({
          ...data,
          practiceId: data.practiceId || null,
        });
        const parentPractice = practices.find((p) => p.id === r.practiceId);
        setSelection({
          type: 'radiologist',
          id: r.id,
          parentPracticeId: r.practiceId ?? undefined,
          parentOrgId: parentPractice?.organizationId,
        });
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteRadiologist() {
    if (!selection?.id) return;
    await deleteRadiologist(selection.id);
    setSelection(null);
  }

  // ── Right panel content ──────────────────────────────────────────────────────

  function renderRightPanel() {
    if (!selection) return <EmptyRight />;

    if (selection.type === 'org') {
      const isNew = !selection.id;
      const initial: OrgFormData = activeOrg
        ? { name: activeOrg.name, initials: activeOrg.initials, color: activeOrg.color }
        : DEFAULT_ORG;

      return (
        <OrgForm
          key={selection.id ?? 'new-org'}
          initial={initial}
          isNew={isNew}
          onSave={handleSaveOrg}
          onCancel={() => setSelection(null)}
          onDelete={!isNew ? handleDeleteOrg : undefined}
          saving={saving}
        />
      );
    }

    if (selection.type === 'practice') {
      const isNew = !selection.id;
      const orgId = selection.parentOrgId ?? activePractice?.organizationId ?? '';
      const orgName = organizations.find((o) => o.id === orgId)?.name ?? '';
      const initial: PracticeFormData = activePractice
        ? { name: activePractice.name, city: activePractice.city ?? '', color: activePractice.color }
        : DEFAULT_PRACTICE;

      return (
        <PracticeForm
          key={selection.id ?? 'new-practice'}
          initial={initial}
          isNew={isNew}
          orgName={orgName}
          onSave={handleSavePractice}
          onCancel={() => setSelection(null)}
          onDelete={!isNew ? handleDeletePractice : undefined}
          saving={saving}
        />
      );
    }

    if (selection.type === 'radiologist') {
      const isNew = !selection.id;
      const defaultPracticeId =
        selection.parentPracticeId ??
        activeRadiologist?.practiceId ??
        '';
      const initial: RadiologistFormData = activeRadiologist
        ? {
            name: activeRadiologist.name,
            initials: activeRadiologist.initials,
            color: activeRadiologist.color,
            practiceId: activeRadiologist.practiceId ?? '',
            dailyRvuGoal: activeRadiologist.dailyRvuGoal,
            annualRvuGoal: activeRadiologist.annualRvuGoal,
            fiscalYearStartMonth: activeRadiologist.fiscalYearStartMonth,
            workdayStart: activeRadiologist.workdayStart,
            workdayEnd: activeRadiologist.workdayEnd,
            breakMinutes: activeRadiologist.breakMinutes,
          }
        : { ...DEFAULT_RADIOLOGIST, practiceId: defaultPracticeId };

      return (
        <RadiologistForm
          key={selection.id ?? 'new-radiologist'}
          initial={initial}
          isNew={isNew}
          practices={practices}
          onSave={handleSaveRadiologist}
          onCancel={() => setSelection(null)}
          onDelete={!isNew ? handleDeleteRadiologist : undefined}
          saving={saving}
        />
      );
    }

    return <EmptyRight />;
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Organizations</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            Manage your org → practice → radiologist hierarchy
          </p>
        </div>
        <button
          type="button"
          onClick={() => setSelection({ type: 'org', id: null })}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Organization
        </button>
      </div>

      {/* Two-panel layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[320px,1fr] gap-6">

        {/* Left: Tree */}
        <div className="card overflow-y-auto max-h-[72vh] space-y-1 py-2">
          {organizations.length === 0 ? (
            <div className="px-4 py-6 text-center text-slate-500 text-sm">
              No organizations yet. Create one to get started.
            </div>
          ) : (
            organizations.map((org) => {
              const orgPractices = practicesForOrg(org.id);
              const isExpanded = expandedOrgs.has(org.id);
              const isActive = selection?.type === 'org' && selection.id === org.id;

              return (
                <div key={org.id}>
                  {/* Org row */}
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => toggleOrg(org.id)}
                      className="p-1 ml-1 text-slate-500 hover:text-white transition-colors"
                      aria-label={isExpanded ? 'Collapse' : 'Expand'}
                    >
                      <svg
                        className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                        fill="none" stroke="currentColor" viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                    <div className="flex-1">
                      <TreeItem
                        label={org.name}
                        sub={`${orgPractices.length} practice${orgPractices.length !== 1 ? 's' : ''}`}
                        avatar={<ProfileAvatar initials={org.initials} color={org.color} size="xs" />}
                        active={isActive}
                        onClick={() => select({ type: 'org', id: org.id })}
                        indent={0}
                      />
                    </div>
                  </div>

                  {/* Practices */}
                  {isExpanded && (
                    <div className="ml-4">
                      {orgPractices.map((practice) => {
                        const prRads = radiologistsForPractice(practice.id);
                        const isPracticeActive =
                          selection?.type === 'practice' && selection.id === practice.id;

                        return (
                          <div key={practice.id}>
                            <TreeItem
                              label={practice.name}
                              sub={
                                (practice.city ? `${practice.city} · ` : '') +
                                `${prRads.length} radiologist${prRads.length !== 1 ? 's' : ''}`
                              }
                              avatar={
                                <ProfileAvatar
                                  initials={practice.name.slice(0, 2).toUpperCase()}
                                  color={practice.color}
                                  size="xs"
                                />
                              }
                              active={isPracticeActive}
                              onClick={() =>
                                select({
                                  type: 'practice',
                                  id: practice.id,
                                  parentOrgId: org.id,
                                })
                              }
                              indent={1}
                            />

                            {/* Radiologists under practice */}
                            {prRads.map((rad) => (
                              <TreeItem
                                key={rad.id}
                                label={rad.name}
                                sub={`${rad.dailyRvuGoal} wRVU/day`}
                                avatar={
                                  <ProfileAvatar
                                    initials={rad.initials}
                                    color={rad.color}
                                    size="xs"
                                  />
                                }
                                active={
                                  selection?.type === 'radiologist' && selection.id === rad.id
                                }
                                onClick={() =>
                                  select({
                                    type: 'radiologist',
                                    id: rad.id,
                                    parentPracticeId: practice.id,
                                    parentOrgId: org.id,
                                  })
                                }
                                indent={2}
                              />
                            ))}

                            {/* Add radiologist to practice */}
                            <div style={{ paddingLeft: `${12 + 2 * 16}px` }}>
                              <AddBtn
                                label="Add Radiologist"
                                onClick={() =>
                                  select({
                                    type: 'radiologist',
                                    id: null,
                                    parentPracticeId: practice.id,
                                    parentOrgId: org.id,
                                  })
                                }
                              />
                            </div>
                          </div>
                        );
                      })}

                      {/* Add practice to org */}
                      <AddBtn
                        label="Add Practice"
                        onClick={() =>
                          select({ type: 'practice', id: null, parentOrgId: org.id })
                        }
                      />
                    </div>
                  )}
                </div>
              );
            })
          )}

          {/* Unassigned radiologists */}
          {unassignedRadiologists.length > 0 && (
            <div className="pt-2 border-t border-white/8 mt-2">
              <p className="px-3 py-1 text-xs text-slate-500 uppercase tracking-wider">Unassigned</p>
              {unassignedRadiologists.map((rad) => (
                <TreeItem
                  key={rad.id}
                  label={rad.name}
                  sub="No practice"
                  avatar={<ProfileAvatar initials={rad.initials} color={rad.color} size="xs" />}
                  active={selection?.type === 'radiologist' && selection.id === rad.id}
                  onClick={() => select({ type: 'radiologist', id: rad.id })}
                  indent={0}
                />
              ))}
            </div>
          )}

          {/* Quick add buttons at bottom */}
          <div className="pt-3 border-t border-white/8 mt-2 space-y-1 px-1">
            <AddBtn
              label="Add Organization"
              onClick={() => setSelection({ type: 'org', id: null })}
            />
            <AddBtn
              label="Add Radiologist (unassigned)"
              onClick={() => setSelection({ type: 'radiologist', id: null })}
            />
          </div>
        </div>

        {/* Right: Form */}
        <div className="card min-h-[300px]">
          {renderRightPanel()}
        </div>
      </div>
    </div>
  );
}
