# wRVU Pace Tracker — Design System

## Vibe
Peloton / Apple Fitness meets clinical dashboard. Performance-focused, clean, data-forward. High information density without clutter. Feels like a premium productivity tool, not a medical spreadsheet.

## Color System

### Dark Mode (default)
- Background: `#0a0e1a` (deep navy-black)
- Surface: `#111827` (card backgrounds)
- Surface elevated: `#1a2234`
- Border: `#1e2d45`
- Text primary: `#f0f4ff`
- Text secondary: `#8892a4`
- Text muted: `#4a5568`

### Light Mode
- Background: `#f0f4f8`
- Surface: `#ffffff`
- Surface elevated: `#f8fafc`
- Border: `#e2e8f0`
- Text primary: `#0d1117`
- Text secondary: `#4a5568`
- Text muted: `#94a3b8`

### Status Colors
- Ahead: `#22c55e` (green-500), glow `rgba(34,197,94,0.3)`
- On Track: `#3b82f6` (blue-500), glow `rgba(59,130,246,0.25)`
- Falling Behind: `#f59e0b` (amber-500), glow `rgba(245,158,11,0.3)`
- Danger Zone: `#ef4444` (red-500), glow `rgba(239,68,68,0.3)`
- Goal Hit: `#a855f7` (purple-500), glow `rgba(168,85,247,0.4)`

### Accent
- Primary accent: `#3b82f6` (blue)
- Progress bar fill: gradient left→right from status color

## Typography
- Font: `Inter` (Google Fonts) — system-ui fallback
- Display numbers: `font-variant-numeric: tabular-nums`, `font-weight: 700`
- Card labels: `12px`, `font-weight: 500`, letter-spacing `0.05em`, uppercase
- Body: `14px`, regular
- Big stats: `48px`–`64px`, bold, tabular

## Layout
- Desktop: single-page dashboard, max-width `1400px`, centered
- Grid: 3-col top stats, 2-col mid (progress + entries), full-width bottom
- Cards: `border-radius: 16px`, `backdrop-filter: blur(8px)`, subtle border
- Spacing: `24px` gaps, `20px` card padding
- Mobile: stacks to single column, stats grid → 2-col

## Animations
- Progress bars: `transition: width 800ms cubic-bezier(0.4, 0, 0.2, 1)`
- Status glow: `box-shadow` pulse keyframe, 2s infinite
- Numbers: smooth count-up on change (CSS transition on width, JS for number)
- Confetti: canvas-based particle burst on Goal Hit
- Upward arrow: translateY keyframe bounce for Ahead
- Amber pulse: opacity keyframe for Falling Behind
- Red pulse: box-shadow + scale keyframe for Danger Zone

## Components
- `StatCard`: label + big number + trend indicator
- `ProgressBar`: animated fill, gradient, glowing tip
- `StatusBadge`: pill with icon + status text + message
- `QuickAddButton`: compact pill/chip, shows estimated wRVU
- `EntryRow`: exam name + wRVU + timestamp + delete/edit actions
- `SettingsPanel`: slide-in drawer or modal
- `ConfettiCanvas`: full-screen overlay, auto-dismisses

## UX Patterns
- All values update every 60 seconds automatically
- Settings persist in localStorage
- Day resets with confirmation modal
- Disclaimer banner at bottom (non-intrusive, muted)
- Dark/light toggle in top-right corner
