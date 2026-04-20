export const fontFamily = {
  regular:   'PlusJakartaSans_400Regular',
  medium:    'PlusJakartaSans_500Medium',
  semiBold:  'PlusJakartaSans_600SemiBold',
  bold:      'PlusJakartaSans_700Bold',
  extraBold: 'PlusJakartaSans_800ExtraBold',
} as const;

export const typography = {
  heading1:  { fontFamily: fontFamily.extraBold, fontSize: 32, lineHeight: 40 },
  heading2:  { fontFamily: fontFamily.bold,      fontSize: 24, lineHeight: 32 },
  heading3:  { fontFamily: fontFamily.semiBold,  fontSize: 20, lineHeight: 28 },
  body:      { fontFamily: fontFamily.regular,   fontSize: 16, lineHeight: 24 },
  bodySmall: { fontFamily: fontFamily.regular,   fontSize: 14, lineHeight: 20 },
  label:     { fontFamily: fontFamily.semiBold,  fontSize: 14, lineHeight: 20 },
  price:     { fontFamily: fontFamily.bold,      fontSize: 22, lineHeight: 30 },
} as const;
