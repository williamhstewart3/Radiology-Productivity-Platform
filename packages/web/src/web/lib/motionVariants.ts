import type { Variants } from 'framer-motion';
import { motionDurations, motionEase, motionStagger } from './motionTokens';

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: motionDurations.normal, ease: motionEase.easeOut },
  },
  exit: {
    opacity: 0,
    transition: { duration: motionDurations.fast, ease: motionEase.easeIn },
  },
};

export const pageEntry: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: motionDurations.slow, ease: motionEase.easeOut },
  },
};

export const cardGroup: Variants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: motionStagger.default,
      delayChildren: 0.04,
    },
  },
};

export const cardEntry: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: motionDurations.normal, ease: motionEase.easeOut },
  },
};

export const rowEntry: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: motionDurations.normal, ease: motionEase.easeOut },
  },
  exit: {
    opacity: 0,
    y: -4,
    height: 0,
    transition: { duration: motionDurations.fast, ease: motionEase.easeIn },
  },
};

export const modalPanel: Variants = {
  hidden: { opacity: 0, scale: 0.97, y: 8 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { duration: motionDurations.normal, ease: motionEase.easeOut },
  },
  exit: {
    opacity: 0,
    scale: 0.98,
    y: 4,
    transition: { duration: motionDurations.fast, ease: motionEase.easeIn },
  },
};

