import { useState, useEffect, Component } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { Route, Switch } from 'wouter';
import { useAppInitialization } from './hooks/useAppInitialization';
import { OrgProvider } from './contexts/OrgContext';
import { OrgSwitcher } from './components/OrgSwitcher';
import { useOrg } from './hooks/useOrg';
import { DailyPaceDashboard } from './components/DailyPaceDashboard';
import { MiniPaceWindow } from './components/MiniPaceWindow';
import { BaptistLogoLockup, BaptistLogoMark } from './components/BaptistLogo';
import {
  Bell,
  Camera,
  ChevronRight,
  ClipboardList,
  Database,
  Gauge,
  History as HistoryIcon,
  LayoutDashboard,
  MapPinned,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings as SettingsIcon,
  Sun,
  UploadCloud,
  Watch,
} from 'lucide-react';
import { Dashboard } from './pages/Dashboard';
import { LogStudy } from './pages/LogStudy';
import { Import } from './pages/Import';
import { History } from './pages/History';
import { Settings } from './pages/Settings';
import { Locations } from './pages/Locations';
import { WatcherPage } from './pages/WatcherPage';
import { CameraUploadPage } from './pages/CameraUploadPage';
import { CptExplorer } from './pages/CptExplorer';
import { Profiles } from './pages/Profiles';
import { AdminData } from './pages/AdminData';
import { DisclaimerBanner } from './components/DisclaimerBanner';
import { injectTheme } from './lib/theme';

type Tab = 'pace' | 'dashboard' | 'log' | 'import' | 'history' | 'settings' | 'locations' | 'watcher' | 'profiles' | 'camera' | 'explorer' | 'admin';

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

const NAV_ITEMS: { id: Tab; label: string; icon: ComponentType<{ className?: string }> }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'pace',      label: 'Daily Pace', icon: Gauge },
  { id: 'log',       label: 'Log Study',  icon: ClipboardList },
  { id: 'import',    label: 'Import',     icon: UploadCloud },
  { id: 'watcher',   label: 'Watcher',    icon: Watch },
  { id: 'camera',    label: 'Camera',     icon: Camera },
  { id: 'explorer',  label: 'CPT Explorer', icon: Search },
  { id: 'history',   label: 'History',    icon: HistoryIcon },
  { id: 'locations', label: 'Locations',  icon: MapPinned },
  { id: 'settings',  label: 'Settings',   icon: SettingsIcon },
  { id: 'admin',     label: 'Admin Data', icon: Database },
];

function MainApp() {
  const { isReady, error } = useAppInitialization();
  const [activeTab, setActiveTab] = useState<Tab>('pace');
  const [isDark, setIsDark] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { activeProfile, activePractice } = useOrg();

  useEffect(() => {
    injectTheme();
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

  if (!isReady) {
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
                {activeTab === 'pace'          && <DailyPaceDashboard onNavigate={(t) => setActiveTab(t as Tab)} />}
                {activeTab === 'dashboard'     && <Dashboard onNavigate={(t) => setActiveTab(t as Tab)} />}
                {activeTab === 'log'           && <LogStudy onSaved={() => setActiveTab('pace')} />}
                {activeTab === 'import'        && <Import onImported={() => setActiveTab('pace')} />}
                {activeTab === 'history'       && <History />}
                {activeTab === 'settings'      && <Settings />}
                {activeTab === 'locations'     && <Locations onNavigate={(t) => setActiveTab(t as Tab)} />}
                {activeTab === 'watcher'       && <WatcherPage onNavigateToImport={() => setActiveTab('import')} />}
                {activeTab === 'camera'        && <CameraUploadPage onImported={() => setActiveTab('pace')} />}
                {activeTab === 'explorer'      && <CptExplorer onNavigate={(t) => setActiveTab(t as Tab)} />}
                {activeTab === 'profiles'      && <Profiles onNavigate={(t) => setActiveTab(t as Tab)} initialEditId={activeProfile?.id ?? null} />}
                {activeTab === 'admin'         && <AdminData />}
              </PageErrorBoundary>
            </div>
          </main>

          <nav className="desktop-topbar sticky bottom-0 z-40 grid grid-cols-5 gap-1 px-2 py-2 lg:hidden">
            {NAV_ITEMS.slice(0, 10).map((item) => {
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
