import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { animate, motion, useMotionValue, useReducedMotion } from 'framer-motion';
import { motionDurations, motionEase } from '../lib/motionTokens';

interface AnimatedNumberProps {
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  format?: (value: number) => string;
  className?: string;
  style?: CSSProperties;
}

export function AnimatedNumber({
  value,
  decimals = 0,
  prefix = '',
  suffix = '',
  format,
  className,
  style,
}: AnimatedNumberProps) {
  const reduceMotion = useReducedMotion();
  const motionValue = useMotionValue(value);
  const formatValue = useCallback((latest: number) => {
    const text = format ? format(latest) : latest.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    return `${prefix}${text}${suffix}`;
  }, [decimals, format, prefix, suffix]);
  const [displayValue, setDisplayValue] = useState(() => formatValue(value));

  useEffect(() => {
    if (reduceMotion) {
      motionValue.set(value);
      setDisplayValue(formatValue(value));
      return;
    }

    const controls = animate(motionValue, value, {
      duration: motionDurations.slow,
      ease: motionEase.easeOut,
      onUpdate: (latest) => setDisplayValue(formatValue(latest)),
    });
    return controls.stop;
  }, [formatValue, motionValue, reduceMotion, value]);

  return (
    <motion.span className={className} style={{ ...style, fontVariantNumeric: 'tabular-nums' }}>
      {displayValue}
    </motion.span>
  );
}
