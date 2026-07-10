import type { Transition } from 'framer-motion';

export const motionDurations = {
  fast: 0.15,
  normal: 0.25,
  slow: 0.45,
} as const;

export const motionEase = {
  easeOut: [0.22, 1, 0.36, 1],
  easeInOut: [0.22, 1, 0.36, 1],
  easeIn: [0.32, 0, 0.67, 0],
} as const;

export const motionSprings = {
  gentle: { type: 'spring', stiffness: 300, damping: 30 },
  smooth: { type: 'spring', stiffness: 200, damping: 25 },
  snappy: { type: 'spring', stiffness: 500, damping: 35 },
} as const satisfies Record<string, Transition>;

export const motionStagger = {
  default: 0.05,
} as const;

