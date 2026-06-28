/**
 * Profiles.tsx
 *
 * Profile management page — create, edit, delete radiologist profiles.
 * Each profile has its own daily/annual goals, schedule, and color.
 * All study data is scoped to the active profile.
 */

import { useState } from 'react';
import { theme } from '../lib/theme';
import { useProfile } from '../hooks/useProfile';
import { ProfileAvatar } from '../components/ProfileSwitcher';
import type { RadiologistProfile, ProfileColor } from '../types';

// ─── Constants ────────────────────────────────────────────────────────────────

const PROFILE_COLORS: { value: ProfileColor; label: string; dot: string }[] = [
  { value: 'indigo',  label: 'Blue',    dot: '#2563A8' },
  { value: 'violet',  label: 'Sky',     dot: '#5BB8D4' },
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

// ─── Form model ───────────────────────────────────────────────────────────────

interface ProfileFormData {
  name: string;
  initials: string;
  color: ProfileColor;
  dailyRvuGoal: number;
  annualRvuGoal: number;
  fiscalYearStartMonth: number;
  workdayStart: string;
  workdayEnd: string;
  breakMinutes: number;
}

const DEFAULT_FORM: ProfileFormData = {
  name: '',
  initials: '',
  color: 'cyan',
  dailyRvuGoal: 90,
  annualRvuGoal: 15000,
  fiscalYearStartMonth: 1,
  workdayStart: '08:00',
  workdayEnd: '17:00',
  breakMinutes: 0,
};

function profileToForm(p: RadiologistProfile): ProfileFormData {
  return {
    name: p.name,
    initials: p.initials,
    color: p.color,
    dailyRvuGoal: p.dailyRvuGoal,
    annualRvuGoal: p.annualRvuGoal,
    fiscalYearStartMonth: p.fiscalYearStartMonth,
    workdayStart: p.workdayStart,
    workdayEnd: p.workdayEnd,
    breakMinutes: p.breakMinutes,
  };
}

// ─── Profile Form ─────────────────────────────────────────────────────────────

interface ProfileFormProps {
  initial: ProfileFormData;
  onSave: (data: ProfileFormData) => Promise<void>;
  onCancel: () => void;
  saving: boolean;
  isNew: boolean;
}

function ProfileForm({ initial, onSave, onCancel, saving, isNew }: ProfileFormProps) {
  const [form, setForm] = useState<ProfileFormData>(initial);

  function update(patch: Partial<ProfileFormData>) {
    setForm((prev) => ({ ...prev, ...patch }));
  }

  // Auto-generate initials from name if not customized
  function handleNameChange(name: string) {
    const autoInitials = name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join('');
    update({ name, initials: autoInitials || form.initials });
  }

  return (
    <div className="card space-y-6">
      {/* Preview */}
      <div className="flex items-center gap-4 pb-4 border-b border-white/8">
        <ProfileAvatar initials={form.initials || '?'} color={form.color} size="md" />
        <div>
          <p className="text-white font-semibold">{form.name || 'New Profile'}</p>
          <p className="text-slate-400 text-xs">
            Daily goal: {form.dailyRvuGoal} wRVU · Annual: {form.annualRvuGoal.toLocaleString()} wRVU
          </p>
        </div>
      </div>

      {/* Identity */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-slate-400 mb-1.5">Name *</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="Dr. Smith"
            maxLength={40}
            className="input w-full"
            autoFocus
          />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1.5">Initials (shown in avatar)</label>
          <input
            type="text"
            value={form.initials}
            onChange={(e) => update({ initials: e.target.value.toUpperCase().slice(0, 3) })}
            placeholder="DR"
            maxLength={3}
            className="input w-full font-mono uppercase"
          />
        </div>
      </div>

      {/* Color */}
      <div>
        <label className="block text-xs text-slate-400 mb-2">Accent Color</label>
        <div className="flex flex-wrap gap-2">
          {PROFILE_COLORS.map((c) => (
            <button
              key={c.value}
              onClick={() => update({ color: c.value })}
              title={c.label}
              className={`w-7 h-7 rounded-full border-2 transition-all ${
                form.color === c.value
                  ? 'scale-110 border-white shadow-lg'
                  : 'border-transparent hover:scale-105'
              }`}
              style={{ backgroundColor: c.dot }}
            />
          ))}
        </div>
      </div>

      {/* Goals */}
      <div>
        <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3">Goals</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Daily wRVU Goal</label>
            <input
              type="number"
              value={form.dailyRvuGoal}
              onChange={(e) => update({ dailyRvuGoal: Number(e.target.value) })}
              min={1}
              max={500}
              step={5}
              className="input w-full"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Annual wRVU Goal</label>
            <input
              type="number"
              value={form.annualRvuGoal}
              onChange={(e) => update({ annualRvuGoal: Number(e.target.value) })}
              min={1000}
              max={100000}
              step={500}
              className="input w-full"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Fiscal Year Start</label>
            <select
              value={form.fiscalYearStartMonth}
              onChange={(e) => update({ fiscalYearStartMonth: Number(e.target.value) })}
              className="input w-full"
            >
              {MONTHS.map((m, i) => (
                <option key={i + 1} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Schedule */}
      <div>
        <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3">Daily Schedule</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Shift Start</label>
            <input
              type="time"
              value={form.workdayStart}
              onChange={(e) => update({ workdayStart: e.target.value })}
              className="input w-full"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Shift End</label>
            <input
              type="time"
              value={form.workdayEnd}
              onChange={(e) => update({ workdayEnd: e.target.value })}
              className="input w-full"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Break (minutes)</label>
            <input
              type="number"
              value={form.breakMinutes}
              onChange={(e) => update({ breakMinutes: Math.max(0, Number(e.target.value)) })}
              min={0}
              max={480}
              step={5}
              className="input w-full"
            />
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        <button
          onClick={onCancel}
          className="px-5 py-2.5 rounded-xl border border-white/15 text-slate-300 text-sm hover:border-white/30 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={() => onSave(form)}
          disabled={saving || !form.name.trim()}
          className="flex-1 py-2.5 rounded-xl text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
          style={{ background: `linear-gradient(135deg, ${theme.colors.primary}, ${theme.colors.accent})` }}
        >
          {saving ? 'Saving…' : isNew ? 'Create Profile' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

interface ProfilesProps {
  onNavigate: (tab: string) => void;
  /** If set, open the edit form for this profile ID immediately */
  initialEditId?: string | null;
}

export function Profiles({ onNavigate, initialEditId }: ProfilesProps) {
  const { profiles, activeProfile, switchProfile, createProfile, updateProfile, deleteProfile } = useProfile();
  const [editing, setEditing] = useState<string | null>(initialEditId ?? null); // profile id or 'new'
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSaveNew(data: ProfileFormData) {
    if (!data.name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await createProfile({
        name: data.name.trim(),
        initials: data.initials.trim() || data.name.slice(0, 2).toUpperCase(),
        color: data.color,
        dailyRvuGoal: data.dailyRvuGoal,
        annualRvuGoal: data.annualRvuGoal,
        fiscalYearStartMonth: data.fiscalYearStartMonth,
        workdayStart: data.workdayStart,
        workdayEnd: data.workdayEnd,
        breakMinutes: data.breakMinutes,
        powerScribeUsername: null,
        powerScribeLastSync: null,
      });
      setEditing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create profile');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveEdit(id: string, data: ProfileFormData) {
    setSaving(true);
    setError(null);
    try {
      await updateProfile(id, {
        name: data.name.trim(),
        initials: data.initials.trim() || data.name.slice(0, 2).toUpperCase(),
        color: data.color,
        dailyRvuGoal: data.dailyRvuGoal,
        annualRvuGoal: data.annualRvuGoal,
        fiscalYearStartMonth: data.fiscalYearStartMonth,
        workdayStart: data.workdayStart,
        workdayEnd: data.workdayEnd,
        breakMinutes: data.breakMinutes,
      });
      setEditing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setError(null);
    try {
      await deleteProfile(id);
      setDeleteConfirm(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete profile');
    }
  }

  // ── Create / edit form ────────────────────────────────────────────────────
  if (editing === 'new') {
    return (
      <div className="max-w-2xl mx-auto space-y-6 animate-in fade-in duration-300">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setEditing(null)}
            className="text-slate-400 hover:text-white transition-colors"
          >
            ← Back
          </button>
          <h1 className="text-2xl font-bold text-white tracking-tight">New Profile</h1>
        </div>
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <ProfileForm
          initial={DEFAULT_FORM}
          onSave={handleSaveNew}
          onCancel={() => setEditing(null)}
          saving={saving}
          isNew
        />
      </div>
    );
  }

  if (editing && editing !== 'new') {
    const profile = profiles.find((p) => p.id === editing);
    // Profile not found (still loading or deleted) — fall back to list
    if (!profile) {
      if (profiles.length === 0) {
        // Still loading — show nothing momentarily (won't flash because profiles load fast)
        return null;
      }
      // Profile ID is stale/invalid — reset to list
      setTimeout(() => setEditing(null), 0);
      return null;
    }
    return (
      <div className="max-w-2xl mx-auto space-y-6 animate-in fade-in duration-300">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setEditing(null)}
            className="text-slate-400 hover:text-white transition-colors"
          >
            ← Back
          </button>
          <h1 className="text-2xl font-bold text-white tracking-tight">Edit Profile</h1>
        </div>
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <ProfileForm
          initial={profileToForm(profile)}
          onSave={(data) => handleSaveEdit(profile.id, data)}
          onCancel={() => setEditing(null)}
          saving={saving}
          isNew={false}
        />
      </div>
    );
  }

  // ── Profile list ──────────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-in fade-in duration-300">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Profiles</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            {profiles.length} profile{profiles.length !== 1 ? 's' : ''} · all data is scoped per profile
          </p>
        </div>
        <button
          onClick={() => setEditing('new')}
          className="px-4 py-2 rounded-xl text-white text-sm font-semibold hover:opacity-90 transition-opacity shadow-lg"
          style={{ background: `linear-gradient(135deg, ${theme.colors.primary}, ${theme.colors.accent})`, boxShadow: `0 4px 14px rgba(37,99,168,0.35)` }}
        >
          + New Profile
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          {error}
        </div>
      )}

      <div className="space-y-3">
        {profiles.map((profile) => {
          const isActive = profile.id === activeProfile?.id;
          const isConfirmingDelete = deleteConfirm === profile.id;

          return (
            <div
              key={profile.id}
              className="card transition-all duration-200"
              style={isActive ? { borderColor: 'rgba(37,99,168,0.35)', background: 'rgba(37,99,168,0.06)' } : {}}
            >
              <div className="flex items-start gap-4">
                <ProfileAvatar initials={profile.initials} color={profile.color} />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-white">{profile.name}</h3>
                    {isActive && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-medium uppercase tracking-wide"
                        style={{ background: 'rgba(91,184,212,0.2)', borderColor: 'rgba(37,99,168,0.3)', color: theme.colors.accent, border: '1px solid rgba(37,99,168,0.3)' }}>
                        Active
                      </span>
                    )}
                  </div>

                  <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-400">
                    <span>⚡ Daily: <span className="text-slate-300 font-medium">{profile.dailyRvuGoal} wRVU</span></span>
                    <span>📊 Annual: <span className="text-slate-300 font-medium">{profile.annualRvuGoal.toLocaleString()} wRVU</span></span>
                    <span>
                      🕐 {profile.workdayStart}–{profile.workdayEnd}
                      {profile.breakMinutes > 0 && ` (${profile.breakMinutes}m break)`}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {!isActive && (
                    <button
                      onClick={() => switchProfile(profile.id)}
                      className="text-xs px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10 hover:border-white/20 transition-colors"
                    >
                      Switch
                    </button>
                  )}
                  <button
                    onClick={() => setEditing(profile.id)}
                    className="text-xs px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10 hover:border-white/20 transition-colors"
                  >
                    Edit
                  </button>
                  {profiles.length > 1 && !isConfirmingDelete && (
                    <button
                      onClick={() => setDeleteConfirm(profile.id)}
                      className="text-xs px-2.5 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-colors"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>

              {/* Delete confirmation inline */}
              {isConfirmingDelete && (
                <div className="mt-3 pt-3 border-t border-red-500/20 flex items-center justify-between gap-3">
                  <p className="text-sm text-red-300">
                    Delete <strong>{profile.name}</strong>? Study data stays but won't appear in any profile.
                  </p>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => setDeleteConfirm(null)}
                      className="text-xs px-3 py-1.5 rounded-lg border border-white/15 text-slate-400 hover:border-white/30 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => handleDelete(profile.id)}
                      className="text-xs px-3 py-1.5 rounded-lg bg-red-500/20 border border-red-500/30 text-red-400 hover:bg-red-500/30 transition-colors"
                    >
                      Confirm Delete
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Info box */}
      <div className="p-4 rounded-xl bg-white/3 border border-white/8 text-xs text-slate-400 space-y-1.5">
        <p className="font-semibold text-slate-300">About Profiles</p>
        <p>Each profile has its own daily/annual goals and schedule. Studies are scoped to the active profile — switch profiles to see a different radiologist's data.</p>
        <p>Legacy studies logged before profiles were added are visible in all profiles.</p>
      </div>
    </div>
  );
}
