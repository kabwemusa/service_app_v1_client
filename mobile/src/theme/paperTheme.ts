import { MD3LightTheme } from 'react-native-paper';
import { fontFamily } from './typography';
import { palette } from './palette';
import { radius } from './spacing';

export const appTheme = {
  ...MD3LightTheme,
  roundness: radius.md,
  colors: {
    ...MD3LightTheme.colors,
    primary:          palette.primary,
    primaryContainer: palette.primaryLight,
    secondaryContainer: '#F9E0E9',
    secondary:        palette.secondary,
    error:            palette.danger,
    errorContainer:   palette.dangerLight,
    background:       palette.background,
    surface:          palette.surface,
    surfaceDisabled: '#F0E2E8',
    onPrimary: '#FFFFFF',
    onPrimaryContainer: palette.primary,
    onSecondaryContainer: palette.secondary,
    onSurface:        palette.textPrimary,
    onSurfaceVariant: palette.textSecondary,
    outline:          palette.border,
    surfaceVariant:   '#F5E8EE',
  },
  fonts: {
    ...MD3LightTheme.fonts,
    bodyLarge:   { ...MD3LightTheme.fonts.bodyLarge,   fontFamily: fontFamily.regular },
    bodyMedium:  { ...MD3LightTheme.fonts.bodyMedium,  fontFamily: fontFamily.regular },
    bodySmall:   { ...MD3LightTheme.fonts.bodySmall,   fontFamily: fontFamily.regular },
    labelLarge:  { ...MD3LightTheme.fonts.labelLarge,  fontFamily: fontFamily.semiBold },
    labelMedium: { ...MD3LightTheme.fonts.labelMedium, fontFamily: fontFamily.medium },
    titleLarge:  { ...MD3LightTheme.fonts.titleLarge,  fontFamily: fontFamily.bold },
    titleMedium: { ...MD3LightTheme.fonts.titleMedium, fontFamily: fontFamily.semiBold },
    headlineLarge:  { ...MD3LightTheme.fonts.headlineLarge,  fontFamily: fontFamily.bold },
    headlineMedium: { ...MD3LightTheme.fonts.headlineMedium, fontFamily: fontFamily.bold },
  },
} as const;
