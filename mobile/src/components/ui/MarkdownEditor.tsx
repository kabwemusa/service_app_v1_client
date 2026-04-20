import { Ionicons } from '@expo/vector-icons';
import React, { useRef } from 'react';
import { StyleSheet, TextInput as RNTextInput, TouchableOpacity, View } from 'react-native';
import { Text, TextInput } from 'react-native-paper';
import { palette, radius as r, spacing, typography } from '../../theme';

interface Props {
  value: string;
  onChangeText: (text: string) => void;
  label?: string;
  placeholder?: string;
  error?: boolean;
}

type FormatAction = { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; wrap?: [string, string]; prefix?: string };

const ACTIONS: FormatAction[] = [
  { icon: 'text',            label: 'B',    wrap: ['**', '**'] },
  { icon: 'text-outline',    label: 'I',    wrap: ['_', '_'] },
  { icon: 'list-outline',    label: '•',    prefix: '- ' },
  { icon: 'list',            label: '1.',   prefix: '1. ' },
  { icon: 'code-slash',      label: '</>',  wrap: ['`', '`'] },
];

export function MarkdownEditor({ value, onChangeText, label, placeholder, error }: Props) {
  const inputRef = useRef<RNTextInput>(null);

  const insert = (action: FormatAction) => {
    if (action.prefix) {
      const lines = value.split('\n');
      const last = lines[lines.length - 1];
      if (last.startsWith(action.prefix)) {
        onChangeText(value);
      } else {
        onChangeText(value + (value.endsWith('\n') || value === '' ? '' : '\n') + action.prefix);
      }
    } else if (action.wrap) {
      const [open, close] = action.wrap;
      onChangeText(value + open + close);
    }
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  return (
    <View>
      <View style={styles.toolbar}>
        {ACTIONS.map((a) => (
          <TouchableOpacity key={a.label} style={styles.toolBtn} onPress={() => insert(a)}>
            <Text style={styles.toolLabel}>{a.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <TextInput
        ref={inputRef as any}
        mode="outlined"
        label={label}
        placeholder={placeholder}
        value={value}
        onChangeText={onChangeText}
        multiline
        numberOfLines={5}
        error={error}
        style={styles.input}
        outlineStyle={styles.inputOutline}
      />
      <Text style={styles.hint}>Supports **bold**, _italic_, - bullets, 1. numbered lists</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: 4,
    paddingHorizontal: 2,
  },
  toolBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: r.sm,
    backgroundColor: palette.primaryLight,
    borderWidth: 1,
    borderColor: palette.border,
    minWidth: 32,
    alignItems: 'center',
  },
  toolLabel: {
    ...typography.label,
    color: palette.primary,
    fontSize: 13,
  },
  input: { backgroundColor: '#FFFFFF', minHeight: 120 },
  inputOutline: { borderRadius: r.lg },
  hint: { ...typography.bodySmall, color: palette.textDisabled, marginTop: 4 },
});
