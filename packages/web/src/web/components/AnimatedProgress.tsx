import { motion, useReducedMotion } from 'framer-motion';
import { motionDurations, motionEase } from '../lib/motionTokens';

interface AnimatedProgressBarProps {
  value: number;
  height: number;
  fill: string;
  radius?: number;
  animated?: boolean;
  className?: string;
}

export function AnimatedProgressBar({
  value,
  height,
  fill,
  radius = height / 2,
  animated = true,
  className,
}: AnimatedProgressBarProps) {
  const reduceMotion = useReducedMotion();
  const width = `${Math.min(100, Math.max(0, value))}%`;

  return (
    <motion.div
      className={className}
      initial={false}
      animate={{ width }}
      transition={
        animated && !reduceMotion
          ? { duration: 0.7, ease: motionEase.easeOut }
          : { duration: motionDurations.fast }
      }
      style={{
        height,
        background: fill,
        borderRadius: radius,
        transformOrigin: 'left center',
        willChange: 'width',
      }}
    />
  );
}

interface AnimatedCircleProgressProps {
  value: number;
  circumference: number;
  color: string;
  strokeWidth: number;
  radius: number;
  cx: number;
  cy: number;
}

export function AnimatedCircleProgress({
  value,
  circumference,
  color,
  strokeWidth,
  radius,
  cx,
  cy,
}: AnimatedCircleProgressProps) {
  const reduceMotion = useReducedMotion();
  const dashOffset = circumference * (1 - Math.min(1, Math.max(0, value)));

  return (
    <motion.circle
      cx={cx}
      cy={cy}
      r={radius}
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeDasharray={circumference}
      initial={false}
      animate={{ strokeDashoffset: dashOffset, stroke: color }}
      transition={
        reduceMotion
          ? { duration: motionDurations.fast }
          : { duration: 0.75, ease: motionEase.easeOut }
      }
      transform={`rotate(-90 ${cx} ${cy})`}
      style={{ filter: `drop-shadow(0 0 6px ${color}88)` }}
    />
  );
}

