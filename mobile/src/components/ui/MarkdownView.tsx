import React from 'react';
import { StyleSheet } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { palette, typography } from '../../theme';

interface Props {
  children: string;
}

export function MarkdownView({ children }: Props) {
  return (
    <Markdown style={mdStyles}>
      {children}
    </Markdown>
  );
}

const mdStyles = StyleSheet.create({
  body:             { ...typography.body, color: palette.textPrimary },
  heading1:         { ...typography.heading1, color: palette.textPrimary, marginVertical: 8 },
  heading2:         { ...typography.heading2, color: palette.textPrimary, marginVertical: 6 },
  heading3:         { ...typography.heading3, color: palette.textPrimary, marginVertical: 4 },
  bullet_list:      { marginVertical: 4 },
  ordered_list:     { marginVertical: 4 },
  bullet_list_icon: { color: palette.primary, marginTop: 6 },
  ordered_list_icon:{ color: palette.primary },
  list_item:        { ...typography.body, color: palette.textPrimary, marginVertical: 2 },
  strong:           { fontWeight: '700' as const, color: palette.textPrimary },
  em:               { fontStyle: 'italic' as const },
  link:             { color: palette.primary },
  blockquote: {
    backgroundColor: palette.primaryLight,
    borderLeftColor: palette.primary,
    borderLeftWidth: 3,
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginVertical: 6,
    borderRadius: 4,
  },
  code_inline: {
    backgroundColor: palette.background,
    borderRadius: 4,
    paddingHorizontal: 4,
    fontFamily: 'monospace',
    fontSize: 13,
    color: palette.secondary,
  },
  fence: {
    backgroundColor: palette.background,
    borderRadius: 8,
    padding: 12,
    marginVertical: 6,
  },
});
