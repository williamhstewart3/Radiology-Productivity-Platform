import { motion, useReducedMotion } from 'framer-motion';
import { BaptistLogoMark } from './BaptistLogo';
import { motionDurations, motionEase } from '../lib/motionTokens';

export function LoadingOverlay() {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      className="loading-overlay"
      initial={{ opacity: 1 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: motionDurations.slow, ease: motionEase.easeOut }}
    >
      <motion.div
        className="loading-overlay__logo"
        initial={{ scale: 1, opacity: 1 }}
        animate={reduceMotion ? { opacity: 1 } : {
          scale: [0.985, 1, 0.99, 1, 0.985],
          opacity: [0.8, 1, 0.88, 1, 0.8],
        }}
        exit={{ scale: reduceMotion ? 1 : 1.08, opacity: 0 }}
        transition={reduceMotion ? { duration: motionDurations.fast } : {
          duration: 2,
          ease: motionEase.easeInOut,
          repeat: Infinity,
        }}
      >
        <BaptistLogoMark size={64} />
        <div className="loading-overlay__text">
          <p>wRVU Tracker</p>
          <span>Baptist Medical Group</span>
        </div>
      </motion.div>
    </motion.div>
  );
}

