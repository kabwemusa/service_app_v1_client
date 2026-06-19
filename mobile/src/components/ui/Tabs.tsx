import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Text, TouchableRipple } from 'react-native-paper';
import { palette, radius as r, spacing, typography } from '../../theme';

export interface TabItem {
  key:      string;
  label:    string;
  /** Optional live count rendered next to the label, e.g. "Active (3)". */
  count?:   number;
  /** Marks the tab with an attention dot + announces it (publish validation). */
  hasError?: boolean;
}

interface Props {
  items:    TabItem[];
  activeKey: string;
  onChange: (key: string) => void;
  /** Let the bar scroll horizontally when labels overflow (editor section tabs). */
  scrollable?: boolean;
}

/**
 * Flat underline tablist (v3.1 §2). Proper tablist semantics — container is a
 * `tablist`, each item is a `tab` with selected state; error tabs announce so
 * publish-validation failures are reachable by screen readers. Sits on a
 * hairline divider rather than inside a card.
 */
export function Tabs({ items, activeKey, onChange, scrollable = false }: Props) {
  const row = (
    <View style={styles.row} accessibilityRole="tablist">
      {items.map((item) => {
        const active = item.key === activeKey;
        const label  = item.count !== undefined ? `${item.label} (${item.count})` : item.label;
        return (
          <TouchableRipple
            key={item.key}
            onPress={() => onChange(item.key)}
            borderless
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={item.hasError ? `${label}, has errors` : label}
            style={scrollable ? styles.tapFit : styles.tap}
          >
            <View style={[styles.tab, active && styles.tabActive]}>
              <Text style={[styles.label, active && styles.labelActive]} numberOfLines={1}>
                {label}
              </Text>
              {item.hasError && <View style={styles.errorDot} />}
            </View>
          </TouchableRipple>
        );
      })}
    </View>
  );

  if (scrollable) {
    return (
      <View style={styles.container}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          {row}
        </ScrollView>
      </View>
    );
  }

  return <View style={styles.container}>{row}</View>;
}

const styles = StyleSheet.create({
  container: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.border },
  scroll:    { flexGrow: 1 },
  row:       { flexDirection: 'row' },

  tap:    { flex: 1, borderRadius: r.sm },        // even-width (status tabs)
  tapFit: { flexGrow: 0, borderRadius: r.sm },    // content-width (section tabs)
  tab: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: { borderBottomColor: palette.primary },

  label:       { ...typography.body, color: palette.textSecondary, fontSize: 15 },
  labelActive: { color: palette.primary, fontFamily: 'DMSans_500Medium' },

  errorDot: {
    width: 7, height: 7, borderRadius: r.full,
    backgroundColor: palette.warning,
  },
});
