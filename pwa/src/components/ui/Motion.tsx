import { motion, type Variants } from 'motion/react';
import type { ReactNode } from 'react';

// Shared motion primitives. Movement is dropped automatically for users with
// "reduce motion" on (see <MotionConfig reducedMotion="user"> in App.tsx), so
// these are safe to use anywhere without extra guards.

const EASE = [0.2, 0.7, 0.2, 1] as const;

/** A child of a `stagger` container — fades up into place. */
export const fadeUpItem: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE } },
};

/** Parent that reveals its children one after another. */
export const staggerContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.04 } },
};

/**
 * Fade-and-rise a block into view on scroll (once). Drop-in wrapper around any
 * section content. `delay` lets you offset sibling reveals.
 */
export function Reveal({
  children,
  className,
  delay = 0,
  y = 20,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  y?: number;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0, transition: { duration: 0.55, delay, ease: EASE } }}
      viewport={{ once: true, margin: '0px 0px -12% 0px' }}
    >
      {children}
    </motion.div>
  );
}
