// Design tokens ported verbatim from the mobile app (mobile/src/theme/*) so the
// PWA shares ONE design language. Light values are the canonical palette; dark
// is a derived brand-consistent variant. Consumed as CSS variables (see
// global.css) — components never hard-code colors/spacing.

export const lightPalette = {
  primary: '#7B1A3A',
  primaryLight: '#F5E8EE',
  secondary: '#C2476A',
  success: '#1E7A50',
  successLight: '#E6F5EE',
  warning: '#B86918',
  warningLight: '#FFF3E0',
  danger: '#B91C1C',
  dangerLight: '#FEE2E2',
  surface: '#FFFFFF',
  background: '#FBF7F8',
  border: '#EDD5DE',
  textPrimary: '#1A0A12',
  textSecondary: '#7B4A5C',
  textDisabled: '#C4A0B0',
  skeleton: '#EDDBDF',
  skeletonShimmer: '#F7EEF1',
} as const;

// Dark variant: same hues, inverted surfaces, lifted brand for contrast on dark.
export const darkPalette: Record<keyof typeof lightPalette, string> = {
  primary: '#E8779A',
  primaryLight: '#3A1421',
  secondary: '#C2476A',
  success: '#3DBE85',
  successLight: '#13311F',
  warning: '#E0A155',
  warningLight: '#3A2A12',
  danger: '#F1746E',
  dangerLight: '#3A1715',
  surface: '#1C1116',
  background: '#140C10',
  border: '#3A2A31',
  textPrimary: '#FBEFF3',
  textSecondary: '#C9A6B3',
  textDisabled: '#7B5A66',
  skeleton: '#2A1B22',
  skeletonShimmer: '#37242C',
};

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 } as const;

// §2 — `sm` (8px) is the only radius for content cards/containers. md+ for pills/sheets.
export const radius = { sm: 8, md: 14, lg: 20, xl: 28, full: 9999 } as const;

export type PaletteKey = keyof typeof lightPalette;
