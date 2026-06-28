import { useState } from 'react';

export function DisclaimerBanner() {
  const [dismissed, setDismissed] = useState(() => {
    return localStorage.getItem('disclaimer_dismissed') === 'true';
  });

  if (dismissed) return null;

  return (
    <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2.5 text-center relative">
      <p className="text-amber-300/90 text-xs">
        <span className="font-semibold">Personal productivity tool only.</span>{' '}
        wRVU values are estimates for self-tracking — not for billing, coding, or compliance.
        All data stays on your device.
      </p>
      <button
        onClick={() => {
          localStorage.setItem('disclaimer_dismissed', 'true');
          setDismissed(true);
        }}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-amber-400/60 hover:text-amber-300 text-xs px-2 py-1 rounded transition-colors"
      >
        ✕
      </button>
    </div>
  );
}
