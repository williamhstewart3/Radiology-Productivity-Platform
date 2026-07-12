import { useState, useEffect, Component } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { Route, Switch } from 'wouter';
import { AnimatePresence, motion } from 'framer-motion';
import { useAppInitialization } from './hooks/useAppInitialization';
import { OrgProvider } from './contexts/OrgContext';
import { OrgSwitcher } from './components/OrgSwitcher';
import { useOrg } from './hooks/useOrg';
import { DailyPaceDashboard } from './components/DailyPaceDashboard';
import { MiniPaceWindow } from './components/MiniPaceWindow';
import { QuickLogPalette } from './components/QuickLogPalette';
import { BaptistLogoLockup, BaptistLogoMark } from './components/BaptistLogo';
import {
  Bell,
  ChevronRight,
  History as HistoryIcon,
  LayoutDashboard,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings as SettingsIcon,
  Sun,
  UploadCloud,
} from 'lucide-react';
import { Import } from './pages/Import';
import { History } from './pages/History';
import { Settings } from './pages/Settings';
import { Locations } from './pages/Locations';
import { CameraUploadPage } from './pages/CameraUploadPage';
import { Profiles } from './pages/Profiles';
import { AdminData } from './pages/AdminData';
import { DisclaimerBanner } from './components/DisclaimerBanner';
import { injectTheme } from './lib/theme';

type Tab =
  | 'dashboard'
  | 'import'
  | 'history'
  | 'settings'
  | 'locations'
  | 'profiles'
  | 'camera'
  | 'admin';

class PageErrorBoundary extends Component<
  { children: ReactNode; tab: string },
  { error: Error | null }
> {
  constructor(props: { children: ReactNode; tab: string }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidUpdate(prev: { tab: string }) {
    if (prev.tab !== this.props.tab && this.state.error) {
      this.setState({ error: null });
    }
  }
  render() {
    if (this.state.error) {
      return (
        <div className="max-w-2xl mx-auto py-16 text-center space-y-4">
          <div className="text-4xl">⚠️</div>
          <p className="font-semibold" style={{ color: 'var(--theme-behind)' }}>
            Something went wrong
          </p>
          <p className="text-sm max-w-md mx-auto" style={{ color: 'var(--theme-text-muted)' }}>
            {this.state.error.message}
          </p>
          <button
            onClick={() => this.setState({ error: null })}
            className="px-4 py-2 rounded-lg text-sm font-medium btn-primary"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Nav is 4 items by design: Home, Capture, History, Settings. Analytics
// merged into Home; CPT Library and manual logging live in the QuickLogPalette
// (⌘K, or the search icon in the topbar / Capture page) rather than as a
// destination tab.
const NAV_ITEMS: { id: Tab; label: string; icon: ComponentType<{ className?: string }> }[] = [
  { id: 'dashboard', label: 'Home', icon: LayoutDashboard },
  { id: 'import',    label: 'Capture', icon: UploadCloud },
  { id: 'history',   label: 'History',    icon: HistoryIcon },
  { id: 'settings',  label: 'Settings',   icon: SettingsIcon },
];

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
        exit={{
          opacity: 0,
          scale: 1.08,
          transition: { duration: 0.45, ease: easeOut },
        }}
      />
    </motion.div>
  );
}

function MainApp() {
  const { isReady, error } = useAppInitialization();
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [isDark, setIsDark] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [quickLogOpen, setQuickLogOpen] = useState(false);
  const { activeProfile, activePractice } = useOrg();

  useEffect(() => {
    injectTheme();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setQuickLogOpen(true);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (isDark) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  }, [isDark]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--theme-bg-base)' }}>
        <div className="text-center space-y-4">
          <div className="text-4xl">⚠️</div>
          <p className="font-semibold" style={{ color: 'var(--theme-behind)' }}>Initialization failed</p>
          <p className="text-sm max-w-md" style={{ color: 'var(--theme-text-muted)' }}>{error}</p>
        </div>
      </div>
    );
  }

  if (import.meta.env.SSR && !isReady) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--theme-bg-base)' }}>
        <div className="text-center space-y-6">
          <div className="flex flex-col items-center gap-4">
            <BaptistLogoMark size={52} />
            <div className="flex flex-col items-center gap-1">
              <p className="font-bold text-lg tracking-tight" style={{ color: 'var(--theme-text-primary)' }}>wRVU Tracker</p>
              <p className="text-xs font-medium tracking-widest uppercase" style={{ color: 'var(--theme-accent)' }}>Baptist Medical Group</p>
            </div>
          </div>
          <div
            className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin mx-auto"
            style={{ borderColor: `var(--theme-accent) transparent var(--theme-accent) var(--theme-accent)` }}
          />
          <p className="text-sm" style={{ color: 'var(--theme-text-muted)' }}>Loading…</p>
        </div>
      </div>
    );
  }

  const activeLocation = activePractice?.name ?? 'Current location';

  return (
    <div className={isDark ? 'dark' : ''}>
      {isReady && (
      <div className="app-shell flex min-h-screen">
        <aside className={`desktop-sidebar sticky top-0 hidden h-screen shrink-0 flex-col px-3 py-4 transition-[width] duration-200 lg:flex ${sidebarCollapsed ? 'w-[76px]' : 'w-[248px]'}`}>
          <div className="flex items-center justify-between gap-2 px-1">
            {sidebarCollapsed ? <BaptistLogoMark size={34} /> : <BaptistLogoLockup size="sm" showTagline />}
            <button
              onClick={() => setSidebarCollapsed((v) => !v)}
              className="desk-icon !h-8 !w-8 shrink-0"
              title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {sidebarCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
            </button>
          </div>

          <nav className="mt-6 flex flex-1 flex-col gap-1 overflow-y-auto pr-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`nav-rail-item ${active ? 'nav-rail-item-active' : ''} ${sidebarCollapsed ? 'justify-center px-0' : ''}`}
                  title={sidebarCollapsed ? item.label : undefined}
                >
                  <Icon className="size-4 shrink-0" />
                  {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
                  {!sidebarCollapsed && active && <ChevronRight className="ml-auto size-4 opacity-60" />}
                </button>
              );
            })}
          </nav>

          {!sidebarCollapsed && (
            <div className="desk-card p-3">
              <p className="section-label">Workspace</p>
              <p className="mt-2 truncate text-sm font-medium text-[var(--theme-text-primary)]">
                {activeProfile?.name ?? 'No radiologist'}
              </p>
              <p className="truncate text-xs text-[var(--theme-text-muted)]">{activeLocation}</p>
            </div>
          )}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <DisclaimerBanner />

          <header className="desktop-topbar sticky top-0 z-40">
            <div className="flex h-14 items-center justify-between gap-3 px-4 lg:px-6">
              <div className="flex min-w-0 items-center gap-3">
                <BaptistLogoMark size={28} className="lg:hidden" />
                <div className="hidden min-w-0 md:block">
                  <p className="truncate text-sm font-medium text-[var(--theme-text-primary)]">
                    {activeProfile?.name ?? 'No radiologist selected'}
                  </p>
                  <p className="truncate text-xs text-[var(--theme-text-muted)]">{activeLocation}</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button onClick={() => setQuickLogOpen(true)} className="desk-icon" title="Quick log (⌘K)">
                  <Search className="size-4" />
                </button>
                <OrgSwitcher onManage={() => setActiveTab('locations')} onMyProfile={() => setActiveTab('profiles')} />
                <button className="desk-icon" title="Notifications"><Bell className="size-4" /></button>
                <button onClick={() => setIsDark(!isDark)} className="desk-icon" title="Toggle theme">
                  {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
                </button>
              </div>
            </div>
          </header>

          <main className="min-h-0 flex-1 overflow-auto">
            <div className="mx-auto w-full max-w-[1720px] px-4 py-5 lg:px-6 lg:py-6">
              <PageErrorBoundary tab={activeTab}>
                {activeTab === 'dashboard'     && <DailyPaceDashboard onNavigate={(t) => setActiveTab(t as Tab)} />}
                {activeTab === 'import'        && <Import onImported={() => setActiveTab('dashboard')} onOpenQuickLog={() => setQuickLogOpen(true)} />}
                {activeTab === 'history'       && <History />}
                {activeTab === 'settings'      && <Settings onNavigate={(t) => setActiveTab(t as Tab)} />}
                {activeTab === 'locations'     && <Locations onNavigate={(t) => setActiveTab(t as Tab)} />}
                {activeTab === 'camera'        && <CameraUploadPage onImported={() => setActiveTab('dashboard')} />}
                {activeTab === 'profiles'      && <Profiles onNavigate={(t) => setActiveTab(t as Tab)} initialEditId={activeProfile?.id ?? null} />}
                {activeTab === 'admin'         && <AdminData />}
              </PageErrorBoundary>
            </div>
          </main>

          <nav className="desktop-topbar sticky bottom-0 z-40 grid grid-cols-4 gap-1 px-2 py-2 lg:hidden">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`flex min-h-12 flex-col items-center justify-center gap-1 rounded-lg text-[10px] font-medium transition-colors ${active ? 'bg-cyan-400/10 text-cyan-200' : 'text-slate-500'}`}
                >
                  <Icon className="size-4" />
                  <span className="max-w-full truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </div>
      )}
      <QuickLogPalette open={quickLogOpen} onClose={() => setQuickLogOpen(false)} />
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
