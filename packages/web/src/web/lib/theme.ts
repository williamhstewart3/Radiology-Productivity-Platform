/**
 * theme.ts — Centralized design token system
 *
 * One source of truth for all colors, radii, and branding.
 * Future organizations swap branding by changing activeTheme.
 *
 * Usage:
 *   import { theme } from '../lib/theme';
 *   style={{ background: theme.colors.primary }}
 *
 * For Tailwind class-based components, use CSS custom properties
 * defined in styles.css via --theme-* variables.
 */

export interface OrgTheme {
  name: string;

  // Core palette
  colors: {
    /** Deep navy — app background, sidebar */
    bgBase: string;
    /** Slightly lighter navy — cards, panels */
    bgCard: string;
    /** Darkest navy — mini window, modals */
    bgDeep: string;
    /** Primary interactive blue */
    primary: string;
    /** Lighter primary for hover/active states */
    primaryLight: string;
    /** Sky blue accent — logo color, highlights */
    accent: string;
    /** Border default */
    border: string;
    /** Border on hover / active cards */
    borderActive: string;

    // Status semantic colors (DO NOT change — carry clinical meaning)
    ahead:    string;  // green
    onTrack:  string;  // blue (matches primary)
    caution:  string;  // amber
    behind:   string;  // red
    goalGold: string;  // gold / goal achieved

    // Text
    textPrimary:   string;
    textSecondary: string;
    textMuted:     string;
    textDisabled:  string;
  };

  // Radii
  radius: {
    sm:   string;
    md:   string;
    lg:   string;
    xl:   string;
    full: string;
  };

  // Brand
  brand: {
    name:    string;
    tagline: string;
    /** SVG path string for the logo mark (the arch/chapel symbol) */
    logoMark: string | null;
  };
}

// ─── Baptist Medical Group ────────────────────────────────────────────────────

export const baptistTheme: OrgTheme = {
  name: 'Baptist Medical Group',

  colors: {
    bgBase:        '#0f1824',   // deep navy — slightly blue-tinted
    bgCard:        '#162032',   // card surface
    bgDeep:        '#0b1219',   // deepest layer (mini window)

    primary:       '#2563A8',   // Baptist Blue
    primaryLight:  '#3B82CC',   // lighter blue for hover
    accent:        '#5BB8D4',   // sky blue (logo arch color)

    border:        'rgba(91,184,212,0.12)',   // sky blue tint
    borderActive:  'rgba(91,184,212,0.32)',

    // Status colors — semantic, keep consistent
    ahead:    '#22c55e',
    onTrack:  '#3b82f6',
    caution:  '#f59e0b',
    behind:   '#ef4444',
    goalGold: '#fbbf24',

    textPrimary:   '#f0f6ff',
    textSecondary: '#94a3b8',
    textMuted:     '#64748b',
    textDisabled:  '#374151',
  },

  radius: {
    sm:   '6px',
    md:   '10px',
    lg:   '14px',
    xl:   '18px',
    full: '9999px',
  },

  brand: {
    name:    'Baptist Medical Group',
    tagline: 'Connected by Care',
    // The Baptist arch symbol — simplified SVG path for inline use
    logoMark: `M12 3 C7 3, 3 7, 3 12 C3 17, 7 21, 12 21 C17 21, 21 17, 21 12 C21 7, 17 3, 12 3 Z
               M12 5 L18 18 L12 14 L6 18 Z`,
  },
};

// ─── Placeholder themes for future orgs ──────────────────────────────────────

export const umsTheme: OrgTheme = {
  ...baptistTheme,
  name: 'University of Mississippi',
  colors: {
    ...baptistTheme.colors,
    bgBase:       '#0e1a0e',
    bgCard:       '#152015',
    primary:      '#c41e3a',   // Cardinal red
    primaryLight: '#e03050',
    accent:       '#f0c040',   // Gold
    border:       'rgba(196,30,58,0.15)',
    borderActive: 'rgba(196,30,58,0.35)',
  },
  brand: { name: 'University of Mississippi', tagline: 'Hotty Toddy', logoMark: null },
};

export const privateTheme: OrgTheme = {
  ...baptistTheme,
  name: 'Private Practice',
  colors: {
    ...baptistTheme.colors,
    bgBase:       '#121212',
    bgCard:       '#1c1c1e',
    primary:      '#6366f1',
    primaryLight: '#818cf8',
    accent:       '#a78bfa',
    border:       'rgba(99,102,241,0.15)',
    borderActive: 'rgba(99,102,241,0.35)',
  },
  brand: { name: 'Private Practice', tagline: 'Radiology Productivity', logoMark: null },
};

// ─── Active theme ─────────────────────────────────────────────────────────────

export const theme: OrgTheme = baptistTheme;

// ─── CSS custom property injector ────────────────────────────────────────────
// Called once at app init to sync theme tokens → CSS vars

export function injectTheme(t: OrgTheme = theme) {
  const r = document.documentElement.style;
  r.setProperty('--theme-bg-base',         t.colors.bgBase);
  r.setProperty('--theme-bg-card',         t.colors.bgCard);
  r.setProperty('--theme-bg-deep',         t.colors.bgDeep);
  r.setProperty('--theme-primary',         t.colors.primary);
  r.setProperty('--theme-primary-light',   t.colors.primaryLight);
  r.setProperty('--theme-accent',          t.colors.accent);
  r.setProperty('--theme-border',          t.colors.border);
  r.setProperty('--theme-border-active',   t.colors.borderActive);
  r.setProperty('--theme-ahead',           t.colors.ahead);
  r.setProperty('--theme-on-track',        t.colors.onTrack);
  r.setProperty('--theme-caution',         t.colors.caution);
  r.setProperty('--theme-behind',          t.colors.behind);
  r.setProperty('--theme-goal-gold',       t.colors.goalGold);
  r.setProperty('--theme-text-primary',    t.colors.textPrimary);
  r.setProperty('--theme-text-secondary',  t.colors.textSecondary);
  r.setProperty('--theme-text-muted',      t.colors.textMuted);
  r.setProperty('--theme-text-disabled',   t.colors.textDisabled);
  r.setProperty('--theme-radius-sm',       t.radius.sm);
  r.setProperty('--theme-radius-md',       t.radius.md);
  r.setProperty('--theme-radius-lg',       t.radius.lg);
  r.setProperty('--theme-radius-xl',       t.radius.xl);
}
