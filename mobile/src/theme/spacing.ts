export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radius = {
  // Canonical content-container radius (v3.1 §2 — small, ≤8px). `sm` is the
  // ONLY radius a Card/Divider/container should use.
  sm: 8,
  md: 14,   // pills, sheets, FAB — NOT content cards
  lg: 20,
  xl: 28,
  full: 9999,
} as const;

/**
 * v3.1 §2: "flat white cards … No drop shadows, no glow." The design language is
 * shadowless, so these tokens are intentionally empty — `...shadow.card` spreads
 * nothing. Kept (rather than deleted) so the many existing call sites stay valid
 * while guaranteeing zero elevation renders anywhere. Do not add shadow values here.
 */
export const shadow = {
  card:  {},
  modal: {},
} as const;
