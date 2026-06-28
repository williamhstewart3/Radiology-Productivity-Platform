import { useState } from 'react';

export function DisclaimerBanner() {
  const [dismissed, setDismissed] = useState(() => {
    return localStorage.getItem('disclaimer_dismissed') === 'true';
  });

  if (dismissed) return null;

  return (
    <div
      className="relative px-4 py-1.5 text-center"
      style={{
        background: 'rgba(15,18,24,0.95)',
        borderBottom: '1px solid rgba(91,184,212,0.08)',
      }}
    >
      <p style={{ color: 'rgba(148,163,184,0.7)', fontSize: '11px' }}>
        <span style={{ color: 'rgba(148,163,184,0.9)', fontWeight: 600 }}>Personal use only.</span>{' '}
        Estimates for self-tracking — not for billing or compliance. Data stays on your device.
      </p>
      <button
        onClick={() => {
          localStorage.setItem('disclaimer_dismissed', 'true');
          setDismissed(true);
        }}
        className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors"
        style={{ color: 'rgba(100,116,139,0.5)', fontSize: '10px', padding: '2px 6px', borderRadius: '4px' }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(148,163,184,0.7)'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(100,116,139,0.5)'; }}
      >
        ✕
      </button>
    </div>
  );
}
