/**
 * BaptistLogo.tsx
 *
 * Baptist Medical Group brand mark — uses the official PNG logo.
 * Used sparingly: header, splash, about only.
 */

import { theme } from '../lib/theme';

interface LogoMarkProps {
  size?: number;
  className?: string;
}

/**
 * The official Baptist Medical Group icon (PNG).
 */
export function BaptistLogoMark({ size = 32, className = '' }: LogoMarkProps) {
  return (
    <img
      src="/bmg_logo.png"
      alt="Baptist Medical Group"
      width={size}
      height={size}
      className={className}
      style={{
        width: size,
        height: size,
        objectFit: 'contain',
        borderRadius: size * 0.2,
        flexShrink: 0,
      }}
    />
  );
}

interface LogoLockupProps {
  size?: 'sm' | 'md' | 'lg';
  showTagline?: boolean;
  className?: string;
}

/**
 * Full horizontal lockup: BMG icon + "wRVU Tracker" wordmark.
 * Use in app header.
 */
export function BaptistLogoLockup({ size = 'md', showTagline = false, className = '' }: LogoLockupProps) {
  const iconSize = size === 'sm' ? 28 : size === 'lg' ? 44 : 36;
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
          <span
            className={`${subSize} font-medium tracking-widest uppercase`}
            style={{ color: theme.colors.accent }}
          >
            Baptist Medical Group
          </span>
        )}
      </div>
    </div>
  );
}
