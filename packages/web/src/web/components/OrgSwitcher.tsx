/**
 * OrgSwitcher.tsx
 *
 * 3-level hierarchy dropdown in the nav bar:
 *   [Org name › Practice name › Radiologist avatar ▾]
 *
 * Baptist Medical Group branding: navy/sky-blue palette.
 */

import { useState, useRef, useEffect } from 'react';
import { useOrg } from '../hooks/useOrg';
import { theme } from '../lib/theme';
import type { ProfileColor, RadiologistProfile } from '../types';

// ─── Color map — maps profile colors to Baptist-compatible tokens ─────────────

const COLOR_MAP: Record<ProfileColor, { bg: string; border: string; text: string; dot: string }> = {
  indigo:  { bg: 'rgba(37,99,168,0.2)',   border: 'rgba(91,184,212,0.35)',  text: '#93c5fd', dot: '#3b82f6' },
  violet:  { bg: 'rgba(109,40,217,0.15)', border: 'rgba(139,92,246,0.35)', text: '#c4b5fd', dot: '#8b5cf6' },
  emerald: { bg: 'rgba(16,185,129,0.15)', border: 'rgba(52,211,153,0.35)', text: '#6ee7b7', dot: '#10b981' },
  amber:   { bg: 'rgba(245,158,11,0.15)', border: 'rgba(251,191,36,0.35)', text: '#fde68a', dot: '#f59e0b' },
  rose:    { bg: 'rgba(244,63,94,0.15)',  border: 'rgba(251,113,133,0.35)', text: '#fda4af', dot: '#f43f5e' },
  cyan:    { bg: 'rgba(91,184,212,0.15)', border: 'rgba(91,184,212,0.35)', text: '#7dd3fc', dot: '#5BB8D4' },
  orange:  { bg: 'rgba(249,115,22,0.15)', border: 'rgba(253,186,116,0.35)', text: '#fed7aa', dot: '#f97316' },
  teal:    { bg: 'rgba(20,184,166,0.15)', border: 'rgba(45,212,191,0.35)', text: '#99f6e4', dot: '#14b8a6' },
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
    size === 'xs' ? { width: 20, height: 20, fontSize: 9 } :
    size === 'sm' ? { width: 24, height: 24, fontSize: 10 } :
                   { width: 32, height: 32, fontSize: 12 };
  return (
    <div
      style={{
        width: sz.width, height: sz.height,
        borderRadius: '50%',
        background: c.bg,
        border: `1px solid ${c.border}`,
        color: c.text,
        fontSize: sz.fontSize,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
        flexShrink: 0,
      }}
    >
      {initials.slice(0, 2)}
    </div>
  );
}

// ─── Radiologist row ──────────────────────────────────────────────────────────

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
      style={{
        width: '100%',
        display: 'flex', alignItems: 'center', gap: 10,
        paddingLeft: 32, paddingRight: 12, paddingTop: 8, paddingBottom: 8,
        textAlign: 'left',
        background: isActive ? c.bg : 'transparent',
        borderLeft: `2px solid ${isActive ? c.dot : 'transparent'}`,
        borderTop: 'none', borderRight: 'none', borderBottom: 'none',
        cursor: 'pointer',
        transition: 'background 0.15s ease',
      }}
      onMouseEnter={(e) => {
        if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(91,184,212,0.06)';
      }}
      onMouseLeave={(e) => {
        if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
      }}
    >
      <ProfileAvatar initials={profile.initials} color={profile.color} size="xs" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{
          fontSize: 13, fontWeight: 500,
          color: isActive ? c.text : theme.colors.textSecondary,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          margin: 0,
        }}>
          {profile.name}
        </p>
        <p style={{
          fontSize: 10, color: theme.colors.textMuted, margin: 0,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {profile.dailyRvuGoal} wRVU/day
        </p>
      </div>
      {isActive && (
        <div style={{
          width: 6, height: 6, borderRadius: '50%',
          background: c.dot, flexShrink: 0,
        }} />
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
    organizations, practices, radiologists,
    activeProfile, activePractice, activeOrg,
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
  const hasOrgs = organizations.length > 0;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {/* Trigger button */}
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 10px',
          borderRadius: 10,
          border: `1px solid ${open ? c.border : theme.colors.border}`,
          background: open ? c.bg : 'rgba(91,184,212,0.06)',
          cursor: 'pointer',
          transition: 'all 0.2s ease',
        }}
        title="Switch radiologist"
      >
        <ProfileAvatar initials={activeProfile.initials} color={activeProfile.color} size="sm" />

        {/* Breadcrumb */}
        <div style={{
          display: 'none',
          alignItems: 'center', gap: 4,
          fontSize: 12, maxWidth: 180,
        }}
          className="sm:flex"
        >
          {activeOrg && (
            <>
              <span style={{ color: theme.colors.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 60 }}>
                {activeOrg.name}
              </span>
              <span style={{ color: theme.colors.textDisabled }}>›</span>
            </>
          )}
          {activePractice && (
            <>
              <span style={{ color: theme.colors.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 60 }}>
                {activePractice.name}
              </span>
              <span style={{ color: theme.colors.textDisabled }}>›</span>
            </>
          )}
          <span style={{ fontWeight: 600, color: c.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 70 }}>
            {activeProfile.name}
          </span>
        </div>

        <svg
          style={{
            width: 12, height: 12, color: theme.colors.textMuted,
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s ease', flexShrink: 0,
          }}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div
          style={{
            position: 'absolute', right: 0, top: 'calc(100% + 8px)',
            width: 260,
            borderRadius: 14,
            background: theme.colors.bgCard,
            border: `1px solid ${theme.colors.border}`,
            boxShadow: `0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(91,184,212,0.06)`,
            zIndex: 50, overflow: 'hidden',
            animation: 'fadeInDown 0.15s ease',
          }}
        >
          <style>{`
            @keyframes fadeInDown {
              from { opacity: 0; transform: translateY(-6px); }
              to   { opacity: 1; transform: translateY(0); }
            }
          `}</style>

          <div style={{ maxHeight: 320, overflowY: 'auto' }}>
            {hasOrgs ? (
              organizations.map((org) => {
                const orgPractices = practices.filter((p) => p.organizationId === org.id);
                if (orgPractices.length === 0) return null;
                return (
                  <div key={org.id}>
                    {/* Org header */}
                    <div style={{ padding: '10px 12px 4px', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 7, height: 7, borderRadius: '50%', background: colors(org.color).dot, flexShrink: 0 }} />
                      <p style={{
                        fontSize: 10, fontWeight: 700, color: theme.colors.textMuted,
                        textTransform: 'uppercase', letterSpacing: '0.06em',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        margin: 0,
                      }}>
                        {org.name}
                      </p>
                    </div>

                    {orgPractices.map((practice) => {
                      const practiceRads = radiologists.filter((r) => r.practiceId === practice.id);
                      if (practiceRads.length === 0) return null;
                      return (
                        <div key={practice.id}>
                          {/* Practice label */}
                          <div style={{ padding: '4px 12px 4px 20px', display: 'flex', alignItems: 'center', gap: 6 }}>
                            <div style={{ width: 5, height: 5, borderRadius: '50%', background: colors(practice.color).dot, flexShrink: 0, opacity: 0.7 }} />
                            <p style={{
                              fontSize: 10, color: theme.colors.textDisabled, fontWeight: 500,
                              textTransform: 'uppercase', letterSpacing: '0.04em',
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                              margin: 0,
                            }}>
                              {practice.name}{practice.city ? ` — ${practice.city}` : ''}
                            </p>
                          </div>

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
              // Flat fallback
              <div style={{ padding: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
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
          <div style={{ borderTop: `1px solid ${theme.colors.border}`, padding: 6 }}>
            <button
              onClick={() => { setOpen(false); onManage(); }}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 12px', borderRadius: 8,
                background: 'transparent',
                border: 'none', cursor: 'pointer',
                color: theme.colors.textMuted, fontSize: 13, fontWeight: 500,
                transition: 'background 0.15s ease, color 0.15s ease',
              }}
              onMouseEnter={(e) => {
                const btn = e.currentTarget as HTMLButtonElement;
                btn.style.background = 'rgba(91,184,212,0.08)';
                btn.style.color = theme.colors.textPrimary;
              }}
              onMouseLeave={(e) => {
                const btn = e.currentTarget as HTMLButtonElement;
                btn.style.background = 'transparent';
                btn.style.color = theme.colors.textMuted;
              }}
            >
              <span style={{ fontSize: 15 }}>🏥</span>
              Manage Organizations
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Compat re-export
export { OrgSwitcher as ProfileSwitcher };
