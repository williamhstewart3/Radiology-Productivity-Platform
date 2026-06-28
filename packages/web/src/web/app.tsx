import { useState, useEffect } from 'react';
import { Route, Switch } from 'wouter';
import { useAppInitialization } from './hooks/useAppInitialization';
import { OrgProvider } from './contexts/OrgContext';
import { OrgSwitcher } from './components/OrgSwitcher';
import { DailyPaceDashboard } from './components/DailyPaceDashboard';
import { MiniPaceWindow } from './components/MiniPaceWindow';
import { BaptistLogoLockup, BaptistLogoMark } from './components/BaptistLogo';
import { Dashboard } from './pages/Dashboard';
import { LogStudy } from './pages/LogStudy';
import { Import } from './pages/Import';
import { History } from './pages/History';
import { Settings } from './pages/Settings';
import { Organizations } from './pages/Organizations';
import { DisclaimerBanner } from './components/DisclaimerBanner';
import { injectTheme } from './lib/theme';

type Tab = 'pace' | 'dashboard' | 'log' | 'import' | 'history' | 'settings' | 'organizations';

const NAV_ITEMS: { id: Tab; label: string; icon: string }[] = [
  { id: 'pace',      label: 'Daily Pace', icon: '⚡' },
  { id: 'dashboard', label: 'Annual',     icon: '📊' },
  { id: 'log',       label: 'Log Study',  icon: '✏️' },
  { id: 'import',    label: 'Import',     icon: '📥' },
  { id: 'history',   label: 'History',    icon: '📋' },
  { id: 'settings',  label: 'Settings',   icon: '⚙️' },
];

function MainApp() {
  const { isReady, error } = useAppInitialization();
  const [activeTab, setActiveTab] = useState<Tab>('pace');
  const [isDark, setIsDark] = useState(true);

  // Inject theme tokens into CSS variables on mount
  useEffect(() => {
    injectTheme();
  }, []);

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDark]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center"
        style={{ background: 'var(--theme-bg-base)' }}>
        <div className="text-center space-y-4">
          <div className="text-4xl">⚠️</div>
          <p className="font-semibold" style={{ color: 'var(--theme-behind)' }}>
            Initialization failed
          </p>
          <p className="text-sm max-w-md" style={{ color: 'var(--theme-text-muted)' }}>
            {error}
          </p>
        </div>
      </div>
    );
  }

  if (!isReady) {
    return (
      <div className="min-h-screen flex items-center justify-center"
        style={{ background: 'var(--theme-bg-base)' }}>
        <div className="text-center space-y-6">
          {/* Branded splash */}
          <div className="flex flex-col items-center gap-4">
            <BaptistLogoMark size={52} />
            <div className="flex flex-col items-center gap-1">
              <p className="font-bold text-lg tracking-tight" style={{ color: 'var(--theme-text-primary)' }}>
                wRVU Tracker
              </p>
              <p className="text-xs font-medium tracking-widest uppercase"
                style={{ color: 'var(--theme-accent)' }}>
                Baptist Medical Group
              </p>
            </div>
          </div>
          {/* Spinner */}
          <div
            className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin mx-auto"
            style={{ borderColor: `var(--theme-accent) transparent var(--theme-accent) var(--theme-accent)` }}
          />
          <p className="text-sm" style={{ color: 'var(--theme-text-muted)' }}>
            Loading…
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={isDark ? 'dark' : ''}>
      <div className="min-h-screen flex flex-col" style={{ background: 'var(--theme-bg-base)', color: 'var(--theme-text-primary)' }}>
        <DisclaimerBanner />

        {/* ── Top Nav ──────────────────────────────────────────────────── */}
        <header
          className="sticky top-0 z-40 backdrop-blur-md"
          style={{
            background: 'rgba(15,24,36,0.88)',
            borderBottom: '1px solid var(--theme-border)',
          }}
        >
          <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
            {/* Logo lockup */}
            <BaptistLogoLockup size="sm" className="hidden sm:flex" />
            {/* Mobile: icon only */}
            <BaptistLogoMark size={28} className="sm:hidden" />

            {/* Desktop tabs */}
            <nav className="hidden md:flex items-center gap-0.5 flex-1 justify-center">
              {NAV_ITEMS.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                    activeTab === item.id
                      ? item.id === 'pace'
                        ? 'nav-tab-pace-active'
                        : 'nav-tab-active'
                      : 'nav-tab-inactive'
                  }`}
                >
                  <span className="mr-1.5 text-[13px]">{item.icon}</span>
                  {item.label}
                </button>
              ))}
            </nav>

            {/* Right: OrgSwitcher + theme toggle */}
            <div className="flex items-center gap-2 shrink-0">
              <OrgSwitcher onManage={() => setActiveTab('organizations')} />
              <button
                onClick={() => setIsDark(!isDark)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-sm transition-all"
                style={{
                  background: 'rgba(91,184,212,0.07)',
                  border: '1px solid var(--theme-border)',
                  color: 'var(--theme-text-muted)',
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.color = 'var(--theme-text-primary)';
                  (e.currentTarget as HTMLButtonElement).style.background = 'rgba(91,184,212,0.12)';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.color = 'var(--theme-text-muted)';
                  (e.currentTarget as HTMLButtonElement).style.background = 'rgba(91,184,212,0.07)';
                }}
                title="Toggle theme"
              >
                {isDark ? '☀️' : '🌙'}
              </button>
            </div>
          </div>
        </header>

        {/* ── Page content ─────────────────────────────────────────────── */}
        <main className="flex-1 overflow-auto">
          <div className="max-w-7xl mx-auto px-4 py-6">
            {activeTab === 'pace'          && <DailyPaceDashboard onNavigate={(t) => setActiveTab(t as Tab)} />}
            {activeTab === 'dashboard'     && <Dashboard onNavigate={(t) => setActiveTab(t as Tab)} />}
            {activeTab === 'log'           && <LogStudy onSaved={() => setActiveTab('pace')} />}
            {activeTab === 'import'        && <Import onImported={() => setActiveTab('pace')} />}
            {activeTab === 'history'       && <History />}
            {activeTab === 'settings'      && <Settings />}
            {activeTab === 'organizations' && <Organizations onNavigate={(t) => setActiveTab(t as Tab)} />}
          </div>
        </main>

        {/* ── Mobile bottom nav ─────────────────────────────────────────── */}
        <nav
          className="md:hidden sticky bottom-0 px-2 py-2 z-40 backdrop-blur-md"
          style={{
            background: 'rgba(15,24,36,0.96)',
            borderTop: '1px solid var(--theme-border)',
          }}
        >
          <div className="flex justify-around">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className="flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-xl transition-all"
                style={{
                  color: activeTab === item.id
                    ? item.id === 'pace'
                      ? 'var(--theme-caution)'
                      : 'var(--theme-accent)'
                    : 'var(--theme-text-muted)',
                }}
              >
                <span className="text-lg">{item.icon}</span>
                <span className="text-[10px] font-medium">{item.label}</span>
              </button>
            ))}
          </div>
        </nav>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <OrgProvider>
      <Switch>
        {/* Standalone mini window — no nav, no init guard */}
        <Route path="/mini-pace">
          <div className="min-h-screen" style={{ background: 'var(--theme-bg-deep)' }}>
            <MiniPaceWindow />
          </div>
        </Route>

        {/* Main app */}
        <Route>
          <MainApp />
        </Route>
      </Switch>
    </OrgProvider>
  );
}
