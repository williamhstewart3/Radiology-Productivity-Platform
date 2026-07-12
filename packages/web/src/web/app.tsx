import { useState, useEffect, Component } from 'react';
import type { ReactNode } from 'react';
import { Route, Switch, Redirect, useLocation, Link } from 'wouter';
import { AnimatePresence, motion } from 'framer-motion';
import { useAppInitialization } from './hooks/useAppInitialization';
import { OrgProvider } from './contexts/OrgContext';
import { useOrg } from './hooks/useOrg';
import { Today } from './pages/Today';
import { MiniPaceWindow } from './components/MiniPaceWindow';
import { ProfileSwitcherButton } from './components/ProfileSwitcherSheet';
import { BaptistLogoLockup, BaptistLogoMark } from './components/BaptistLogo';
import { SidebarNav, BottomTabBar, type TabItem } from './components/ui/TabBar';
import {
  Bell,
  ClipboardList,
  Gauge,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings as SettingsIcon,
  Sun,
  TrendingUp,
} from 'lucide-react';
import { LogStudy } from './pages/LogStudy';
import { Import } from './pages/Import';
import { History } from './pages/History';
import { Settings } from './pages/Settings';
import { Locations } from './pages/Locations';
import { CameraUploadPage } from './pages/CameraUploadPage';
import { CptExplorer } from './pages/CptExplorer';
import { Profiles } from './pages/Profiles';
import { AdminData } from './pages/AdminData';
import { Automation } from './pages/Automation';
import { AnalyticsPage } from './pages/ProductDashboards';
import { DisclaimerBanner } from './components/DisclaimerBanner';
import { injectTheme } from './lib/theme';

// ─── Nav: 5 destinations on real Wouter routes ──────────────────────────────
// Today/Trends/Log/Codes/Settings per the UI modernization spec. History,
// Camera, manual Log entry, Profiles, Locations, Admin Data, and Automation
// aren't primary destinations but stay reachable via secondary routes linked
// from within Trends/Log/Settings — nothing from the pre-redesign nav is lost.
const TAB_ITEMS: TabItem[] = [
  { path: '/today', label: 'Today', icon: Gauge },
  { path: '/trends', label: 'Trends', icon: TrendingUp },
  { path: '/log', label: 'Log', icon: ClipboardList },
  { path: '/codes', label: 'Codes', icon: Search },
  { path: '/settings', label: 'Settings', icon: SettingsIcon },
];

class PageErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="max-w-2xl mx-auto py-16 text-center space-y-4">
          <div className="text-4xl">⚠️</div>
          <p className="font-semibold text-rd-label-primary">Something went wrong</p>
          <p className="text-sm max-w-md mx-auto text-rd-label-secondary">{this.state.error.message}</p>
          <button
            onClick={() => this.setState({ error: null })}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white"
            style={{ background: 'var(--rd-accent)' }}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppLoadingOverlay() {
  const easeOut: [number, number, number, number] = [0.16, 1, 0.3, 1];

  return (
    <motion.div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ backgroundColor: '#0A0E1A' }}
      initial={{ opacity: 1 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.45, ease: easeOut }}
      aria-label="Loading application"
    >
      <motion.img
        src="/bmg_logo.png"
        alt="Baptist"
        className="h-28 w-28 select-none object-contain sm:h-32 sm:w-32"
        draggable={false}
        initial={{ opacity: 0.72, scale: 0.985 }}
        animate={{
          opacity: [0.72, 1, 0.72],
          scale: [0.985, 1, 0.985],
          transition: { duration: 2, repeat: Infinity, ease: 'easeInOut' },
        }}
        exit={{ opacity: 0, scale: 1.08, transition: { duration: 0.45, ease: easeOut } }}
      />
    </motion.div>
  );
}

function MainApp() {
  const { isReady, error } = useAppInitialization();
  const [isDark, setIsDark] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { activeProfile, activePractice } = useOrg();
  const [location, navigate] = useLocation();

  useEffect(() => {
    injectTheme();
  }, []);

  useEffect(() => {
    // Drives both the legacy Baptist theme (`.dark`) and the new token system
    // (`.rd-dark`) so not-yet-migrated screens and the new shell stay visually
    // coherent during the phased rollout. True light-mode support (Settings >
    // Appearance) lands in Phase 5 — the token system already supports it.
    document.documentElement.classList.toggle('dark', isDark);
    document.documentElement.classList.toggle('rd-dark', isDark);
    document.documentElement.classList.toggle('rd-light', !isDark);
  }, [isDark]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-rd-bg">
        <div className="text-center space-y-4">
          <div className="text-4xl">⚠️</div>
          <p className="font-semibold text-rd-label-primary">Initialization failed</p>
          <p className="text-sm max-w-md text-rd-label-secondary">{error}</p>
        </div>
      </div>
    );
  }

  if (import.meta.env.SSR && !isReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-rd-bg">
        <div className="text-center space-y-6">
          <div className="flex flex-col items-center gap-4">
            <BaptistLogoMark size={52} />
            <div className="flex flex-col items-center gap-1">
              <p className="font-bold text-lg tracking-tight text-rd-label-primary">wRVU Tracker</p>
            </div>
          </div>
          <div
            className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin mx-auto"
            style={{ borderColor: 'var(--rd-accent) transparent var(--rd-accent) var(--rd-accent)' }}
          />
          <p className="text-sm text-rd-label-secondary">Loading…</p>
        </div>
      </div>
    );
  }

  const activeLocation = activePractice?.name ?? 'Current location';

  // Old page components take a `(tab: string) => void` onNavigate callback.
  // Map their legacy tab names onto the new route paths.
  function legacyNavigate(tab: string) {
    const map: Record<string, string> = {
      profiles: '/settings/profiles',
      locations: '/settings/locations',
      admin: '/settings/admin',
      automation: '/settings/automation',
      dashboard: '/today',
      history: '/trends/history',
      import: '/log',
      log: '/log/manual',
      camera: '/log/camera',
      explorer: '/codes',
      settings: '/settings',
    };
    navigate(map[tab] ?? '/today');
  }

  return (
    <div className={isDark ? 'dark' : ''}>
      {isReady && (
      <div className="app-shell flex min-h-screen bg-rd-bg">
        <aside className={`sticky top-0 hidden h-screen shrink-0 flex-col gap-4 px-3 py-4 transition-[width] duration-200 md:flex ${sidebarCollapsed ? 'w-[76px]' : 'w-[248px]'}`}>
          <div className="flex items-center justify-between gap-2 px-1">
            {sidebarCollapsed ? <BaptistLogoMark size={34} /> : <BaptistLogoLockup size="sm" showTagline />}
            <button
              onClick={() => setSidebarCollapsed((v) => !v)}
              className="flex size-8 shrink-0 items-center justify-center rounded-full text-rd-label-secondary hover:bg-rd-surface"
              title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {sidebarCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
            </button>
          </div>

          <SidebarNav items={TAB_ITEMS} />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <DisclaimerBanner />

          <header className="sticky top-0 z-30 border-b border-rd-separator bg-rd-surface">
            <div className="flex h-14 items-center justify-between gap-3 px-4 md:px-6">
              <div className="flex min-w-0 items-center gap-3">
                <BaptistLogoMark size={28} className="md:hidden" />
                <div className="hidden min-w-0 md:block">
                  <p className="truncate text-[15px] font-medium text-rd-label-primary">
                    {activeProfile?.name ?? 'No radiologist selected'}
                  </p>
                  <p className="truncate text-[13px] text-rd-label-secondary">{activeLocation}</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  className="flex size-9 items-center justify-center rounded-full text-rd-label-secondary hover:bg-rd-bg"
                  title="Notifications"
                >
                  <Bell className="size-4" />
                </button>
                <button
                  onClick={() => setIsDark(!isDark)}
                  className="flex size-9 items-center justify-center rounded-full text-rd-label-secondary hover:bg-rd-bg"
                  title="Toggle theme"
                >
                  {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
                </button>
                <ProfileSwitcherButton onManageLocations={() => navigate('/settings/locations')} />
              </div>
            </div>
          </header>

          <main className="min-h-0 flex-1 overflow-auto pb-16 md:pb-0">
            <div className="mx-auto w-full max-w-[1720px] px-4 py-5 md:px-6 md:py-6">
              <PageErrorBoundary key={location}>
                <Switch>
                  <Route path="/">
                    <Redirect to="/today" />
                  </Route>
                  <Route path="/today">
                    <Today onNavigate={navigate} />
                  </Route>
                  <Route path="/trends">
                    <div className="space-y-3">
                      <AnalyticsPage />
                      <Link href="/trends/history" className="inline-block text-[15px] font-medium text-rd-accent">
                        View full history →
                      </Link>
                    </div>
                  </Route>
                  <Route path="/trends/history">
                    <History />
                  </Route>
                  <Route path="/log">
                    <div className="space-y-3">
                      <Import onImported={() => navigate('/today')} />
                      <div className="flex gap-4">
                        <Link href="/log/manual" className="text-[15px] font-medium text-rd-accent">
                          Manual entry
                        </Link>
                        <Link href="/log/camera" className="text-[15px] font-medium text-rd-accent">
                          Camera
                        </Link>
                      </div>
                    </div>
                  </Route>
                  <Route path="/log/manual">
                    <LogStudy onSaved={() => navigate('/today')} />
                  </Route>
                  <Route path="/log/camera">
                    <CameraUploadPage onImported={() => navigate('/today')} />
                  </Route>
                  <Route path="/codes">
                    <CptExplorer onNavigate={legacyNavigate} />
                  </Route>
                  <Route path="/settings">
                    <Settings onNavigate={legacyNavigate} />
                  </Route>
                  <Route path="/settings/profiles">
                    <Profiles onNavigate={legacyNavigate} initialEditId={activeProfile?.id ?? null} />
                  </Route>
                  <Route path="/settings/locations">
                    <Locations onNavigate={legacyNavigate} />
                  </Route>
                  <Route path="/settings/admin">
                    <AdminData />
                  </Route>
                  <Route path="/settings/automation">
                    <Automation />
                  </Route>
                </Switch>
              </PageErrorBoundary>
            </div>
          </main>
        </div>

        <BottomTabBar items={TAB_ITEMS} />
      </div>
      )}
      <AnimatePresence>
        {!isReady && <AppLoadingOverlay key="app-loading-overlay" />}
      </AnimatePresence>
    </div>
  );
}

export default function App() {
  const isMiniWindow =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('mini') === 'pace';

  return (
    <OrgProvider>
      {isMiniWindow ? (
        <div className="min-h-screen" style={{ background: 'var(--theme-bg-deep)' }}>
          <MiniPaceWindow />
        </div>
      ) : (
        <Switch>
          <Route path="/mini-pace">
            <div className="min-h-screen" style={{ background: 'var(--theme-bg-deep)' }}>
              <MiniPaceWindow />
            </div>
          </Route>
          <Route>
            <MainApp />
          </Route>
        </Switch>
      )}
    </OrgProvider>
  );
}
