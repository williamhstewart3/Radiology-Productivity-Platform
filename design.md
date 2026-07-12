# wRVU Pace Tracker - Design System

## Vibe
Quiet productivity companion. Linear/Raycast clarity with Apple Health confidence, but calmer and less attention-seeking. The app should feel like it is working on the radiologist's behalf, not like another system to operate.

The HUD is the primary workday surface. The full app is an explanatory and configuration space. Prefer subtle, glanceable confirmation over dense widgets, dashboards, or persistent demands for attention.

Design priorities:

- Automation over interaction.
- Passive awareness over active management.
- Subtle feedback over interruption.
- Workflow consolidation over more top-level pages.
- Refinement over additional widgets.

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
- Workday HUD: compact, always-glanceable, optimized for current wRVUs, exams, pace, sync status, and review status.
- Full app: workflow-based navigation, not feature-based navigation.
- Home: daily pace, latest sync, timeline, goals, and review state.
- Analytics: study mix, accuracy, and historical trend questions.
- Settings: profiles, locations, automation, preferences, and data management.
- Cards: `border-radius: 10px` to `14px`, subtle border, minimal shadow.
- Spacing: 8-point grid, generous whitespace, avoid nested card stacks.
- Mobile: stacks to single column, stats grid → 2-col

## Animations
- Progress bars: `transition: width 800ms cubic-bezier(0.4, 0, 0.2, 1)`
- Status glow: brief, purposeful highlight after updates; avoid constant pulsing unless attention is needed
- Numbers: smooth count-up on change (CSS transition on width, JS for number)
- Toasts: bottom-right, temporary, fade/slide, color-coded by outcome
- Loading: quiet skeletons or small progress indicators
- Avoid celebratory or distracting motion during routine work

## Components
- `StatCard`: label + big number + trend indicator
- `ProgressBar`: animated fill, gradient, glowing tip
- `StatusBadge`: pill with icon + status text + message
- `SyncToast`: brief capture/import/sync result
- `ReviewExceptionCard`: compact row requiring attention only when confidence is low
- `EntryRow`: exam name + wRVU + timestamp + delete/edit actions
- `SettingsPanel`: slide-in drawer or modal
- `HudSummary`: primary workday surface for wRVUs, exams, pace, last sync, and review state

## UX Patterns
- Values should update automatically whenever capture/import completes and, in the future, on short-interval PowerScribe monitoring.
- Successful sync uses a brief toast and HUD update, not a modal.
- Review appears only for exceptions.
- Routine high-confidence imports should require no approval.
- Settings and profile/location configuration live under Settings, not top-level workflow navigation.
- Disclaimer banner at bottom (non-intrusive, muted)
- Dark/light toggle in top-right corner
