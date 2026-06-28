/**
 * ProfileSwitcher.tsx
 *
 * Compact dropdown in the nav bar for switching between profiles.
 * Shows a color dot + initials avatar for the active profile.
 * Clicking opens a popover listing all profiles + "Manage Profiles" link.
 */

import { useState, useRef, useEffect } from 'react';
import { useProfile } from '../hooks/useProfile';
import type { ProfileColor } from '../types';

// ─── Color map ────────────────────────────────────────────────────────────────

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

function getColors(color: ProfileColor) {
  return COLOR_MAP[color] ?? COLOR_MAP.indigo;
}

// ─── Avatar ───────────────────────────────────────────────────────────────────

interface AvatarProps {
  initials: string;
  color: ProfileColor;
  size?: 'sm' | 'md';
}

export function ProfileAvatar({ initials, color, size = 'md' }: AvatarProps) {
  const colors = getColors(color);
  const sizeClass = size === 'sm' ? 'w-6 h-6 text-[10px]' : 'w-8 h-8 text-xs';
  return (
    <div
      className={`${sizeClass} rounded-full ${colors.bg} border ${colors.border} ${colors.text} flex items-center justify-center font-bold uppercase tracking-tight shrink-0`}
    >
      {initials.slice(0, 2)}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

interface ProfileSwitcherProps {
  onManageProfiles: () => void;
}

export function ProfileSwitcher({ onManageProfiles }: ProfileSwitcherProps) {
  const { activeProfile, profiles, switchProfile } = useProfile();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (!activeProfile) return null;

  const colors = getColors(activeProfile.color);

  return (
    <div ref={ref} className="relative">
      {/* Trigger button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-2 px-2 py-1.5 rounded-lg border transition-all duration-200 ${
          open
            ? `${colors.bg} ${colors.border}`
            : 'bg-white/5 border-white/10 hover:bg-white/8 hover:border-white/20'
        }`}
        title="Switch profile"
      >
        <ProfileAvatar initials={activeProfile.initials} color={activeProfile.color} size="sm" />
        <span className="text-xs font-medium text-slate-300 max-w-[80px] truncate hidden sm:block">
          {activeProfile.name}
        </span>
        <svg
          className={`w-3 h-3 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-full mt-2 w-56 rounded-xl bg-[#0d1225] border border-white/10 shadow-2xl shadow-black/60 z-50 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
          <div className="p-1.5 space-y-0.5">
            {profiles.map((profile) => {
              const pc = getColors(profile.color);
              const isActive = profile.id === activeProfile.id;
              return (
                <button
                  key={profile.id}
                  onClick={async () => {
                    if (!isActive) await switchProfile(profile.id);
                    setOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all duration-150 ${
                    isActive
                      ? `${pc.bg} border ${pc.border}`
                      : 'hover:bg-white/5 border border-transparent'
                  }`}
                >
                  <ProfileAvatar initials={profile.initials} color={profile.color} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-medium truncate ${isActive ? pc.text : 'text-slate-200'}`}>
                      {profile.name}
                    </p>
                    <p className="text-[10px] text-slate-500 truncate">
                      Goal: {profile.dailyRvuGoal} / day
                    </p>
                  </div>
                  {isActive && (
                    <div
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: pc.dot }}
                    />
                  )}
                </button>
              );
            })}
          </div>

          <div className="border-t border-white/8 p-1.5">
            <button
              onClick={() => {
                setOpen(false);
                onManageProfiles();
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 text-sm transition-colors"
            >
              <span className="text-base">👥</span>
              Manage Profiles
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
