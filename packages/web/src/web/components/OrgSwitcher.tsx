/**
 * OrgSwitcher.tsx
 *
 * 3-level hierarchy dropdown in the nav bar:
 *   [Org name › Practice name › Radiologist avatar ▾]
 *
 * Clicking opens a panel that lists:
 *   - All organizations (with their practices and radiologists nested)
 *   - The active radiologist is highlighted
 *   - One click switches to any radiologist in the tree
 *   - "Manage" footer link goes to Organizations page
 */

import { useState, useRef, useEffect } from 'react';
import { useOrg } from '../hooks/useOrg';
import type { ProfileColor, Organization, Practice, RadiologistProfile } from '../types';

// ─── Color map ─────────────────────────────────────────────────────────────────

const COLOR_MAP: Record<ProfileColor, { bg: string; border: string; text: string; dot: string }> = {
  indigo:  { bg: 'bg-indigo-500/20',  border: 'border-indigo-500/40',  text: 'text-indigo-300',  dot: '#6366f1' },
  violet:  { bg: 'bg-violet-500/20',  border: 'border-violet-500/40',  text: 'text-violet-300',  dot: '#8b5cf6' },
  emerald: { bg: 'bg-emerald-500/20', border: 'border-emerald-500/40', text: 'text-emerald-300', dot: '#10b981' },
  amber:   { bg: 'bg-amber-500/20',   border: 'border-amber-500/40',   text: 'text-amber-300',   dot: '#f59e0b' },
  rose:    { bg: 'bg-rose-500/20',    border: 'border-rose-500/40',    text: 'text-rose-300',    dot: '#f43f5e' },
  cyan:    { bg: 'bg-cyan-500/20',    border: 'border-cyan-500/40',    text: 'text-cyan-300',    dot: '#06b6d4' },
  orange:  { bg: 'bg-orange-500/20',  border: 'border-orange-500/40',  text: 'text-orange-300',  dot: '#f97316' },
  teal:    { bg: 'bg-teal-500/20',    border: 'border-teal-500/40',    text: 'text-teal-300',    dot: '#14b8a6' },
};

function colors(color: ProfileColor) {
  return COLOR_MAP[color] ?? COLOR_MAP.indigo;
}

// ─── Avatar ────────────────────────────────────────────────────────────────────

interface AvatarProps {
  initials: string;
  color: ProfileColor;
  size?: 'xs' | 'sm' | 'md';
}

export function ProfileAvatar({ initials, color, size = 'md' }: AvatarProps) {
  const c = colors(color);
  const sz =
    size === 'xs' ? 'w-5 h-5 text-[9px]' :
    size === 'sm' ? 'w-6 h-6 text-[10px]' :
                   'w-8 h-8 text-xs';
  return (
    <div className={`${sz} rounded-full ${c.bg} border ${c.border} ${c.text} flex items-center justify-center font-bold uppercase tracking-tight shrink-0`}>
      {initials.slice(0, 2)}
    </div>
  );
}

// ─── Nested tree row ────────────────────────────────────────────────────────────

interface RadiologistRowProps {
  profile: RadiologistProfile;
  isActive: boolean;
  onSelect: () => void;
}

function RadiologistRow({ profile, isActive, onSelect }: RadiologistRowProps) {
  const c = colors(profile.color);
  return (
    <button
      onClick={onSelect}
      className={`w-full flex items-center gap-2.5 pl-8 pr-3 py-2 text-left transition-all duration-150 ${
        isActive
          ? `${c.bg} border-l-2 ${c.border.replace('border-', 'border-l-')}`
          : 'hover:bg-white/5 border-l-2 border-transparent'
      }`}
    >
      <ProfileAvatar initials={profile.initials} color={profile.color} size="xs" />
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-medium truncate ${isActive ? c.text : 'text-slate-200'}`}>
          {profile.name}
        </p>
        <p className="text-[10px] text-slate-500 truncate">
          {profile.dailyRvuGoal} wRVU/day
        </p>
      </div>
      {isActive && (
        <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: c.dot }} />
      )}
    </button>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

interface OrgSwitcherProps {
  onManage: () => void;
}

export function OrgSwitcher({ onManage }: OrgSwitcherProps) {
  const {
    organizations,
    practices,
    radiologists,
    activeProfile,
    activePractice,
    activeOrg,
    switchRadiologist,
  } = useOrg();

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (!activeProfile) return null;

  const c = colors(activeProfile.color);

  // Build tree: org → [practices] → [radiologists]
  // If no orgs, fall back to flat radiologist list
  const hasOrgs = organizations.length > 0;

  return (
    <div ref={ref} className="relative">
      {/* Trigger */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-2 px-2 py-1.5 rounded-lg border transition-all duration-200 ${
          open
            ? `${c.bg} ${c.border}`
            : 'bg-white/5 border-white/10 hover:bg-white/8 hover:border-white/20'
        }`}
        title="Switch radiologist"
      >
        <ProfileAvatar initials={activeProfile.initials} color={activeProfile.color} size="sm" />

        {/* Breadcrumb: Org › Practice › Name */}
        <div className="hidden sm:flex items-center gap-1 text-xs max-w-[180px]">
          {activeOrg && (
            <>
              <span className="text-slate-500 truncate max-w-[60px]">{activeOrg.name}</span>
              <span className="text-slate-600">›</span>
            </>
          )}
          {activePractice && (
            <>
              <span className="text-slate-400 truncate max-w-[60px]">{activePractice.name}</span>
              <span className="text-slate-600">›</span>
            </>
          )}
          <span className={`font-medium truncate max-w-[70px] ${c.text}`}>
            {activeProfile.name}
          </span>
        </div>

        <svg
          className={`w-3 h-3 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-full mt-2 w-64 rounded-xl bg-[#0d1225] border border-white/10 shadow-2xl shadow-black/60 z-50 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
          <div className="max-h-80 overflow-y-auto">
            {hasOrgs ? (
              // Tree view: Org → Practice → Radiologist
              organizations.map((org) => {
                const orgPractices = practices.filter((p) => p.organizationId === org.id);
                if (orgPractices.length === 0) return null;
                return (
                  <div key={org.id}>
                    {/* Org header */}
                    <div className="px-3 pt-2.5 pb-1 flex items-center gap-2">
                      <div
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: colors(org.color).dot }}
                      />
                      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider truncate">
                        {org.name}
                      </p>
                    </div>

                    {orgPractices.map((practice) => {
                      const practiceRads = radiologists.filter(
                        (r) => r.practiceId === practice.id,
                      );
                      if (practiceRads.length === 0) return null;
                      return (
                        <div key={practice.id}>
                          {/* Practice label */}
                          <div className="pl-5 pr-3 py-1 flex items-center gap-1.5">
                            <div
                              className="w-1.5 h-1.5 rounded-full shrink-0"
                              style={{ backgroundColor: colors(practice.color).dot }}
                            />
                            <p className="text-[10px] text-slate-500 uppercase tracking-wide font-medium truncate">
                              {practice.name}
                              {practice.city ? ` — ${practice.city}` : ''}
                            </p>
                          </div>

                          {/* Radiologists */}
                          {practiceRads.map((profile) => (
                            <RadiologistRow
                              key={profile.id}
                              profile={profile}
                              isActive={profile.id === activeProfile.id}
                              onSelect={async () => {
                                await switchRadiologist(profile.id);
                                setOpen(false);
                              }}
                            />
                          ))}
                        </div>
                      );
                    })}
                  </div>
                );
              })
            ) : (
              // Flat fallback: just radiologists
              <div className="p-1.5 space-y-0.5">
                {radiologists.map((profile) => (
                  <RadiologistRow
                    key={profile.id}
                    profile={profile}
                    isActive={profile.id === activeProfile.id}
                    onSelect={async () => {
                      await switchRadiologist(profile.id);
                      setOpen(false);
                    }}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-white/8 p-1.5">
            <button
              onClick={() => { setOpen(false); onManage(); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 text-sm transition-colors"
            >
              <span className="text-base">🏥</span>
              Manage Organizations
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Keep old export name for compat (ProfileSwitcher used in app.tsx)
export { OrgSwitcher as ProfileSwitcher };
