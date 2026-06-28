/**
 * BaptistLogo.tsx
 *
 * Baptist Medical Group brand mark.
 * The arch/chapel symbol — used sparingly: header, splash, about.
 * Do NOT embed in widgets or dashboards.
 */

import { theme } from '../lib/theme';

interface LogoMarkProps {
  size?: number;
  className?: string;
}

/**
 * The Baptist arch icon — square container with rounded corners.
 * Faithful to the brand's chapel/arch symbol in sky blue on navy.
 */
export function BaptistLogoMark({ size = 32, className = '' }: LogoMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="Baptist Medical Group"
    >
      {/* Square background — navy with rounded corners */}
      <rect
        x="0" y="0" width="40" height="40"
        rx="8"
        fill={theme.colors.primary}
      />
      <rect
        x="0" y="0" width="40" height="40"
        rx="8"
        fill="url(#bmgGrad)"
      />

      {/* Arch / chapel symbol — sky blue */}
      {/* Outer rounded square border */}
      <rect
        x="4" y="4" width="32" height="32"
        rx="5"
        fill="none"
        stroke={theme.colors.accent}
        strokeWidth="2"
        strokeOpacity="0.8"
      />

      {/* Arch: the upward-pointing curved shape (like a tent/chapel arch) */}
      {/* Bottom curved arc (opening) */}
      <path
        d="M10 29 Q20 14 30 29"
        fill="none"
        stroke={theme.colors.accent}
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      {/* Top pointed arch */}
      <path
        d="M12 26 Q20 11 28 26"
        fill="none"
        stroke={theme.colors.accent}
        strokeWidth="2"
        strokeLinecap="round"
        strokeOpacity="0.5"
      />

      <defs>
        <linearGradient id="bmgGrad" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#1B3A6B" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#0f1824" stopOpacity="0.3" />
        </linearGradient>
      </defs>
    </svg>
  );
}

interface LogoLockupProps {
  size?: 'sm' | 'md' | 'lg';
  showTagline?: boolean;
  className?: string;
}

/**
 * Full horizontal lockup: icon + "wRVU Tracker" wordmark.
 * Use in app header.
 */
export function BaptistLogoLockup({ size = 'md', showTagline = false, className = '' }: LogoLockupProps) {
  const iconSize = size === 'sm' ? 24 : size === 'lg' ? 40 : 32;
  const textSize = size === 'sm' ? 'text-sm' : size === 'lg' ? 'text-xl' : 'text-base';
  const subSize  = size === 'sm' ? 'text-[9px]' : 'text-[10px]';

  return (
    <div className={`flex items-center gap-2.5 shrink-0 ${className}`}>
      <BaptistLogoMark size={iconSize} />
      <div className="flex flex-col leading-tight">
        <span className={`font-bold tracking-tight text-white ${textSize}`}>
          wRVU Tracker
        </span>
        {showTagline && (
          <span className={`${subSize} font-medium tracking-widest uppercase`}
            style={{ color: theme.colors.accent }}>
            Baptist Medical Group
          </span>
        )}
      </div>
    </div>
  );
}
