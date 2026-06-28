import { useState, useEffect } from 'react';
import { useAppInitialization } from './hooks/useAppInitialization';
import { Dashboard } from './pages/Dashboard';
import { LogStudy } from './pages/LogStudy';
import { Import } from './pages/Import';
import { History } from './pages/History';
import { Settings } from './pages/Settings';
import { DisclaimerBanner } from './components/DisclaimerBanner';

type Tab = 'dashboard' | 'log' | 'import' | 'history' | 'settings';

const NAV_ITEMS: { id: Tab; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '📊' },
  { id: 'log', label: 'Log Study', icon: '✏️' },
  { id: 'import', label: 'Import', icon: '📥' },
  { id: 'history', label: 'History', icon: '📋' },
  { id: 'settings', label: 'Settings', icon: '⚙️' },
];

export default function App() {
  const { isReady, error } = useAppInitialization();
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [isDark, setIsDark] = useState(true);

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDark]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0e1a] text-white">
        <div className="text-center space-y-4">
          <div className="text-red-400 text-4xl">⚠️</div>
          <p className="text-red-400 font-semibold">Initialization failed</p>
          <p className="text-slate-400 text-sm max-w-md">{error}</p>
        </div>
      </div>
    );
  }

  if (!isReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0e1a]">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-slate-400 text-sm">Loading wRVU Tracker…</p>
        </div>
      </div>
    );
  }

  return (
    <div className={isDark ? 'dark' : ''}>
      <div className="min-h-screen bg-[#0a0e1a] dark:bg-[#0a0e1a] text-white flex flex-col">
        <DisclaimerBanner />

        {/* Top Nav */}
        <header className="sticky top-0 z-40 bg-[#0d1225]/80 backdrop-blur-md border-b border-white/5">
          <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-sm font-bold">
                R
              </div>
              <span className="font-semibold text-white tracking-tight">wRVU Tracker</span>
            </div>

            {/* Desktop tabs */}
            <nav className="hidden md:flex items-center gap-1">
              {NAV_ITEMS.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                    activeTab === item.id
                      ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                      : 'text-slate-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <span className="mr-1.5">{item.icon}</span>
                  {item.label}
                </button>
              ))}
            </nav>

            <button
              onClick={() => setIsDark(!isDark)}
              className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-all"
              title="Toggle theme"
            >
              {isDark ? '☀️' : '🌙'}
            </button>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto">
          <div className="max-w-7xl mx-auto px-4 py-6">
            {activeTab === 'dashboard' && <Dashboard onNavigate={setActiveTab} />}
            {activeTab === 'log' && <LogStudy onSaved={() => setActiveTab('dashboard')} />}
            {activeTab === 'import' && <Import onImported={() => setActiveTab('dashboard')} />}
            {activeTab === 'history' && <History />}
            {activeTab === 'settings' && <Settings />}
          </div>
        </main>

        {/* Mobile bottom nav */}
        <nav className="md:hidden sticky bottom-0 bg-[#0d1225]/95 backdrop-blur-md border-t border-white/5 px-2 py-2 z-40">
          <div className="flex justify-around">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl transition-all ${
                  activeTab === item.id
                    ? 'text-indigo-400'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
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
