// import { Ionicons } from "@expo/vector-icons";
// import * as Haptics from "expo-haptics";
// import React, { useEffect, useRef, useState } from "react";
// import {
//   ActivityIndicator,
//   FlatList,
//   KeyboardAvoidingView,
//   Modal,
//   Platform,
//   Pressable,
//   ScrollView,
//   StyleSheet,
//   TouchableOpacity,
//   View,
// } from "react-native";
// import { Text, TextInput } from "react-native-paper";
// import { useSafeAreaInsets } from "react-native-safe-area-context";
// import { locationApi, PlaceCandidate } from "../../api/location";
// import { useHighAccuracyLocation } from "../../hooks/useHighAccuracyLocation";
// import { useSnackbar } from "../../providers/SnackbarProvider";
// import {
//   candidateToDeliveryLocation,
//   DeliveryLocation,
//   toDeliveryLocation,
//   useLocationStore,
// } from "../../store/locationStore";
// import { palette, radius as r, shadow, spacing, typography } from "../../theme";

// interface Props {
//   visible: boolean;
//   onClose: () => void;
//   onSelect: (location: DeliveryLocation) => void;
//   /** Sheet title — e.g. "Show providers near" or "Delivery location" (§4.5-B). */
//   title?: string;
// }

// /**
//  * v3.1 §4.5-B — delivery-location picker used on Home and in the booking flow.
//  * Options: primary location, current GPS, place search.
//  * Coordinates never appear in the UI — only resolved labels.
//  */
// export function LocationPickerSheet({
//   visible,
//   onClose,
//   onSelect,
//   title = "Choose a location",
// }: Props) {
//   const { primaryLocation } = useLocationStore();
//   const { showError } = useSnackbar();
//   const insets = useSafeAreaInsets();

//   const [mode, setMode] = useState<"list" | "search">("list");
//   const [query, setQuery] = useState("");
//   const [suggestions, setSuggestions] = useState<PlaceCandidate[]>([]);
//   const [searching, setSearching] = useState(false);
//   const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
//   const searchInputRef = useRef<any>(null);

//   const { loading: locating, capture } = useHighAccuracyLocation();

//   // Reset to list mode each time the sheet opens
//   useEffect(() => {
//     if (visible) {
//       setMode("list");
//       setQuery("");
//       setSuggestions([]);
//     }
//   }, [visible]);

//   // Focus the search input only AFTER the layout has settled to avoid
//   // simultaneous height-change + keyboard-open shake
//   useEffect(() => {
//     if (mode === "search") {
//       const t = setTimeout(() => searchInputRef.current?.focus(), 120);
//       return () => clearTimeout(t);
//     }
//   }, [mode]);

//   const choose = (loc: DeliveryLocation) => {
//     Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
//     onSelect(loc);
//     onClose();
//   };

//   const handleUseCurrentLocation = async () => {
//     const candidate = await capture();
//     if (candidate) {
//       choose(candidateToDeliveryLocation(candidate, "DEVICE"));
//     } else {
//       showError(
//         "Could not determine your location. Try searching for a place instead."
//       );
//     }
//   };

//   const handleQueryChange = (text: string) => {
//     setQuery(text);
//     setSuggestions([]);
//     if (debounceRef.current) clearTimeout(debounceRef.current);
//     if (text.trim().length < 2) {
//       setSearching(false);
//       return;
//     }
//     setSearching(true);
//     debounceRef.current = setTimeout(async () => {
//       try {
//         setSuggestions(await locationApi.search(text.trim()));
//       } catch {
//         setSuggestions([]);
//       } finally {
//         setSearching(false);
//       }
//     }, 250);
//   };

//   return (
//     <Modal
//       transparent
//       visible={visible}
//       animationType="slide"
//       statusBarTranslucent
//       onRequestClose={onClose}
//     >
//       {/* KAV fills the full modal frame. Backdrop is a flex child that absorbs
//           the space above the sheet — so when the keyboard opens the KAV shrinks,
//           the backdrop absorbs the delta, and the sheet stays above the keyboard. */}
//       <KeyboardAvoidingView behavior="padding" style={styles.kav}>
//         <Pressable style={styles.backdrop} onPress={onClose} />

//         <View
//           style={[styles.sheet, { paddingBottom: insets.bottom || spacing.md }]}
//         >
//           <View style={styles.handle} />

//           <View style={styles.header}>
//             {mode === "search" ? (
//               <TouchableOpacity
//                 onPress={() => setMode("list")}
//                 hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
//               >
//                 <Ionicons
//                   name="chevron-back"
//                   size={20}
//                   color={palette.textSecondary}
//                 />
//               </TouchableOpacity>
//             ) : (
//               <View style={{ width: 20 }} />
//             )}
//             <Text style={styles.headerTitle}>{title}</Text>
//             <TouchableOpacity
//               onPress={onClose}
//               hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
//             >
//               <Ionicons name="close" size={20} color={palette.textSecondary} />
//             </TouchableOpacity>
//           </View>

//           {mode === "list" ? (
//             // ScrollView ensures items never clip even if the list grows
//             <ScrollView
//               style={styles.body}
//               keyboardShouldPersistTaps="handled"
//               showsVerticalScrollIndicator={false}
//             >
//               {primaryLocation && (
//                 <OptionRow
//                   icon="home"
//                   label={primaryLocation.label}
//                   sub={primaryLocation.region ?? "Primary location"}
//                   badge="Primary"
//                   onPress={() => choose(toDeliveryLocation(primaryLocation))}
//                 />
//               )}

//               <OptionRow
//                 icon="navigate"
//                 label="Use current location"
//                 sub="Detect via device GPS"
//                 loading={locating}
//                 onPress={handleUseCurrentLocation}
//               />

//               <OptionRow
//                 icon="search"
//                 label="Search for a place"
//                 sub="Find an address, landmark, or area"
//                 onPress={() => setMode("search")}
//               />
//             </ScrollView>
//           ) : (
//             <View style={styles.searchBody}>
//               <TextInput
//                 ref={searchInputRef}
//                 mode="outlined"
//                 placeholder="Search for a place…"
//                 value={query}
//                 onChangeText={handleQueryChange}
//                 style={styles.input}
//                 outlineStyle={styles.inputOutline}
//                 left={<TextInput.Icon icon="magnify" />}
//                 right={
//                   searching ? (
//                     <TextInput.Icon
//                       icon={() => (
//                         <ActivityIndicator size={16} color={palette.primary} />
//                       )}
//                     />
//                   ) : undefined
//                 }
//               />

//               <FlatList
//                 data={suggestions}
//                 keyExtractor={(item, idx) => `${item.label}-${idx}`}
//                 keyboardShouldPersistTaps="handled"
//                 style={styles.suggestionList}
//                 renderItem={({ item }) => (
//                   <TouchableOpacity
//                     style={styles.suggestion}
//                     onPress={() =>
//                       choose(candidateToDeliveryLocation(item, "SEARCH"))
//                     }
//                   >
//                     <Ionicons
//                       name="location-outline"
//                       size={16}
//                       color={palette.textSecondary}
//                     />
//                     <View style={{ flex: 1 }}>
//                       <Text style={styles.suggestionLabel} numberOfLines={1}>
//                         {item.label}
//                       </Text>
//                       {!!item.region && (
//                         <Text style={styles.suggestionRegion} numberOfLines={1}>
//                           {item.region}
//                         </Text>
//                       )}
//                     </View>
//                   </TouchableOpacity>
//                 )}
//                 ItemSeparatorComponent={() => <View style={styles.sep} />}
//                 ListEmptyComponent={
//                   query.trim().length >= 2 && !searching ? (
//                     <Text style={styles.emptyText}>
//                       No places found. Try a different search.
//                     </Text>
//                   ) : null
//                 }
//               />
//             </View>
//           )}
//         </View>
//       </KeyboardAvoidingView>
//     </Modal>
//   );
// }

import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import { Text, TextInput } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { locationApi, PlaceCandidate } from "../../api/location";
import { useHighAccuracyLocation } from "../../hooks/useHighAccuracyLocation";
import { useSnackbar } from "../../providers/SnackbarProvider";
import {
  candidateToDeliveryLocation,
  DeliveryLocation,
  toDeliveryLocation,
  useLocationStore,
} from "../../store/locationStore";
import { palette, radius as r, shadow, spacing, typography } from "../../theme";

interface Props {
  visible: boolean;
  onClose: () => void;
  onSelect: (location: DeliveryLocation) => void;
  title?: string;
}

export function LocationPickerSheet({
  visible,
  onClose,
  onSelect,
  title = "Choose a location",
}: Props) {
  const { primaryLocation } = useLocationStore();
  const { showError } = useSnackbar();
  const insets = useSafeAreaInsets();

  const [mode, setMode] = useState<"list" | "search">("list");

  // 1. Split query into what the user sees vs what the API searches
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  const [suggestions, setSuggestions] = useState<PlaceCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const searchInputRef = useRef<any>(null);

  const { loading: locating, capture } = useHighAccuracyLocation();

  // Reset state on open
  useEffect(() => {
    if (visible) {
      setMode("list");
      setQuery("");
      setDebouncedQuery("");
      setSuggestions([]);
    }
  }, [visible]);

  // Focus input
  useEffect(() => {
    if (mode === "search") {
      const t = setTimeout(() => searchInputRef.current?.focus(), 120);
      return () => clearTimeout(t);
    }
  }, [mode]);

  // 2. The Debouncer: Only updates the search term when the user stops typing for 300ms
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  // 3. The API Caller: Watches the debounced query and prevents race conditions
  useEffect(() => {
    let isSubscribed = true; // Prevents stale data from overwriting fresh data

    const fetchPlaces = async () => {
      if (debouncedQuery.trim().length < 2) {
        setSuggestions([]);
        setSearching(false);
        return;
      }

      setSearching(true);
      try {
        const results = await locationApi.search(debouncedQuery.trim());
        if (isSubscribed) {
          setSuggestions(results);
        }
      } catch {
        if (isSubscribed) {
          setSuggestions([]);
        }
      } finally {
        if (isSubscribed) {
          setSearching(false);
        }
      }
    };

    fetchPlaces();

    // Cleanup function runs if the user types again before the API finishes
    return () => {
      isSubscribed = false;
    };
  }, [debouncedQuery]);

  const choose = (loc: DeliveryLocation) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onSelect(loc);
    onClose();
  };

  const handleUseCurrentLocation = async () => {
    const candidate = await capture();
    if (candidate) {
      choose(candidateToDeliveryLocation(candidate, "DEVICE"));
    } else {
      showError(
        "Could not determine your location. Try searching for a place instead."
      );
    }
  };

  return (
    <Modal
      transparent
      visible={visible}
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView behavior="padding" style={styles.kav}>
        <Pressable style={styles.backdrop} onPress={onClose} />

        <View
          style={[styles.sheet, { paddingBottom: insets.bottom || spacing.md }]}
        >
          <View style={styles.handle} />

          <View style={styles.header}>
            {mode === "search" ? (
              <TouchableOpacity
                onPress={() => setMode("list")}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons
                  name="chevron-back"
                  size={20}
                  color={palette.textSecondary}
                />
              </TouchableOpacity>
            ) : (
              <View style={{ width: 20 }} />
            )}
            <Text style={styles.headerTitle}>{title}</Text>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close" size={20} color={palette.textSecondary} />
            </TouchableOpacity>
          </View>

          {mode === "list" ? (
            <ScrollView
              style={styles.body}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {primaryLocation && (
                <OptionRow
                  icon="home"
                  label={primaryLocation.label}
                  sub={primaryLocation.region ?? "Primary location"}
                  badge="Primary"
                  onPress={() => choose(toDeliveryLocation(primaryLocation))}
                />
              )}

              <OptionRow
                icon="navigate"
                label="Use current location"
                sub="Detect via device GPS"
                loading={locating}
                onPress={handleUseCurrentLocation}
              />

              <OptionRow
                icon="search"
                label="Search for a place"
                sub="Find an address, landmark, or area"
                onPress={() => setMode("search")}
              />
            </ScrollView>
          ) : (
            <View style={styles.searchBody}>
              <TextInput
                ref={searchInputRef}
                mode="outlined"
                placeholder="Search for a place…"
                value={query}
                onChangeText={setQuery} // Let the useEffect handle the rest!
                style={styles.input}
                outlineStyle={styles.inputOutline}
                left={<TextInput.Icon icon="magnify" />}
                right={
                  searching ? (
                    <TextInput.Icon
                      icon={() => (
                        <ActivityIndicator size={16} color={palette.primary} />
                      )}
                    />
                  ) : undefined
                }
              />

              <FlatList
                data={suggestions}
                keyExtractor={(item, idx) => `${item.label}-${idx}`}
                keyboardShouldPersistTaps="handled"
                style={styles.suggestionList}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.suggestion}
                    onPress={() =>
                      choose(candidateToDeliveryLocation(item, "SEARCH"))
                    }
                  >
                    <Ionicons
                      name="location-outline"
                      size={16}
                      color={palette.textSecondary}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.suggestionLabel} numberOfLines={1}>
                        {item.label}
                      </Text>
                      {!!item.region && (
                        <Text style={styles.suggestionRegion} numberOfLines={1}>
                          {item.region}
                        </Text>
                      )}
                    </View>
                  </TouchableOpacity>
                )}
                ItemSeparatorComponent={() => <View style={styles.sep} />}
                ListEmptyComponent={
                  query.trim().length >= 2 && !searching ? (
                    <Text style={styles.emptyText}>
                      No places found. Try a different search.
                    </Text>
                  ) : null
                }
              />
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── Option row ───────────────────────────────────────────────────────────────

interface OptionRowProps {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  sub?: string;
  badge?: string;
  loading?: boolean;
  onPress: () => void;
}

function OptionRow({
  icon,
  label,
  sub,
  badge,
  loading,
  onPress,
}: OptionRowProps) {
  return (
    <TouchableOpacity
      style={styles.option}
      onPress={onPress}
      disabled={loading}
    >
      <View style={styles.optionIcon}>
        {loading ? (
          <ActivityIndicator size={16} color={palette.primary} />
        ) : (
          <Ionicons name={icon} size={18} color={palette.primary} />
        )}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.optionLabel} numberOfLines={1}>
          {label}
        </Text>
        {!!sub && (
          <Text style={styles.optionSub} numberOfLines={1}>
            {sub}
          </Text>
        )}
      </View>
      {badge && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  // KAV fills the full modal frame so maxHeight % and flex: 1 children resolve correctly.
  // Backdrop is a flex child (not absolute) so it absorbs the space above the sheet;
  // when the keyboard opens the KAV shrinks and the sheet stays above the keyboard.
  kav: { flex: 1 },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.55)",
  },

  sheet: {
    backgroundColor: palette.surface,
    borderTopLeftRadius: r.xl,
    borderTopRightRadius: r.xl,
    maxHeight: "80%",
    flexShrink: 1,
    ...shadow.modal,
  },

  handle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: r.full,
    backgroundColor: palette.border,
    marginTop: spacing.sm,
  },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 4,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
  headerTitle: {
    ...typography.label,
    color: palette.textPrimary,
    fontSize: 16,
  },

  body: {
    minHeight: 200,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
  },

  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm + 4,
  },
  optionIcon: {
    width: 38,
    height: 38,
    borderRadius: r.full,
    backgroundColor: palette.primaryLight,
    alignItems: "center",
    justifyContent: "center",
  },
  optionLabel: {
    ...typography.label,
    color: palette.textPrimary,
    fontSize: 15,
  },
  optionSub: {
    ...typography.bodySmall,
    color: palette.textSecondary,
    fontSize: 12,
    marginTop: 1,
  },
  badge: {
    backgroundColor: palette.primaryLight,
    borderRadius: r.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  badgeText: { ...typography.label, color: palette.primary, fontSize: 11 },

  searchBody: {
    flexShrink: 1,
    padding: spacing.lg,
    paddingBottom: spacing.sm,
    gap: spacing.xs,
  },
  suggestionList: { flexShrink: 1 },

  input: { backgroundColor: "#FFFFFF", marginBottom: spacing.sm },
  inputOutline: { borderRadius: r.lg },

  suggestion: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm + 2,
  },
  suggestionLabel: {
    ...typography.label,
    color: palette.textPrimary,
    fontSize: 14,
  },
  suggestionRegion: {
    ...typography.bodySmall,
    color: palette.textSecondary,
    fontSize: 12,
  },
  sep: { height: 1, backgroundColor: palette.border },
  emptyText: {
    ...typography.bodySmall,
    color: palette.textSecondary,
    textAlign: "center",
    paddingVertical: spacing.lg,
  },
});
