# Baptist Medical Group Rebrand — Task Tracker

## Status: IN PROGRESS

## Completed
- [x] theme.ts — centralized token system (Baptist Navy/Blue/Sky + status colors)
- [x] styles.css — CSS custom props, Baptist theme vars, scrollbar, utility classes
- [x] BaptistLogo.tsx — logo mark + lockup component
- [x] app.tsx — Baptist logo in header, theme-token nav, loading splash
- [x] DailyPaceDashboard.tsx — Baptist blue theme, no more indigo/violet
- [x] MiniPaceWindow.tsx — Baptist navy bg, sky blue accent

## In Progress
- [ ] OrgSwitcher.tsx — swap indigo COLOR_MAP → Baptist blue tokens
- [ ] Dashboard.tsx — swap indigo pill styles → theme tokens
- [ ] ProgressBar.tsx — swap indigo → theme tokens
- [ ] Settings.tsx — theme-aware form inputs/buttons
- [ ] LogStudy.tsx — check for hardcoded indigo
- [ ] History.tsx — check for hardcoded indigo
- [ ] Import.tsx — check for hardcoded indigo
- [ ] Organizations.tsx — write full CRUD page (was previously blocked)

## Then
- [ ] bun run build — fix TS errors
- [ ] smoke test in browser at localhost:4200
- [ ] git commit + push

## Color Reference
- Navy bg:    #0f1824 (bgBase), #162032 (bgCard), #0b1219 (bgDeep)
- Primary:    #2563A8 (Baptist Blue)
- Accent:     #5BB8D4 (Sky Blue / logo color)
- Ahead:      #22c55e
- OnTrack:    #3b82f6
- Caution:    #f59e0b
- Behind:     #ef4444
- Gold:       #fbbf24
