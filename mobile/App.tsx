import {
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_600SemiBold,
  DMSans_700Bold,
  DMSans_800ExtraBold,
  useFonts,
} from "@expo-google-fonts/dm-sans";
import { Ionicons } from "@expo/vector-icons";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useRef } from "react";
import { View } from "react-native";
import { PaperProvider } from "react-native-paper";
import { SkeletonBlock } from "./src/components/ui/SkeletonBlock";
import { SnackbarProvider } from "./src/providers/SnackbarProvider";
import LoginScreen from "./src/screens/auth/LoginScreen";
import OtpScreen from "./src/screens/auth/OtpScreen";
import RegisterScreen from "./src/screens/auth/RegisterScreen";
import LocationOnboardingScreen from "./src/screens/onboarding/LocationOnboardingScreen";
import BookingDetailScreen from "./src/screens/app/BookingDetailScreen";
import BookingScreen from "./src/screens/app/BookingScreen";
import BookingsScreen from "./src/screens/app/BookingsScreen";
import BrowseScreen from "./src/screens/app/BrowseScreen";
import HomeScreen from "./src/screens/app/HomeScreen";
import KycScreen from "./src/screens/app/KycScreen";
import PostRequestScreen from "./src/screens/app/PostRequestScreen";
import EditProfileScreen from "./src/screens/app/EditProfileScreen";
import ProfileScreen from "./src/screens/app/ProfileScreen";
import SavedLocationsScreen from "./src/screens/app/SavedLocationsScreen";
import SearchScreen from "./src/screens/app/SearchScreen";
import ServiceDetailScreen from "./src/screens/app/ServiceDetailScreen";
import NotificationsScreen from "./src/screens/app/NotificationsScreen";
import NotificationSettingsScreen from "./src/screens/app/NotificationSettingsScreen";
import AllReviewsScreen from "./src/screens/provider/AllReviewsScreen";
import CreateServiceScreen from "./src/screens/provider/CreateServiceScreen";
import EarningsScreen from "./src/screens/provider/EarningsScreen";
import AvailabilityScreen from "./src/screens/provider/AvailabilityScreen";
import HubScreen from "./src/screens/provider/HubScreen";
import IncomingRequestsScreen from "./src/screens/provider/IncomingRequestsScreen";
import MyServicesScreen from "./src/screens/provider/MyServicesScreen";
import ProviderAccountScreen from "./src/screens/provider/ProviderAccountScreen";
import ProviderBookingDetailScreen from "./src/screens/provider/ProviderBookingDetailScreen";
import ProviderProfileEditScreen from "./src/screens/provider/ProviderProfileEditScreen";
import ProviderProfileScreen from "./src/screens/provider/ProviderProfileScreen";
import ProviderSetupScreen from "./src/screens/provider/ProviderSetupScreen";
import ProviderSetupTimelineScreen from "./src/screens/provider/ProviderSetupTimelineScreen";
import { usePushNotifications } from "./src/hooks/usePushNotifications";
import { useAuthStore } from "./src/store/authStore";
import { useLocationStore } from "./src/store/locationStore";
import { useNotificationStore } from "./src/store/notificationStore";
import { appTheme, palette, shadow, spacing } from "./src/theme";
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

// ── Stack navigators ──────────────────────────────────────────────────────────
const AuthStack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

// Customer stacks
const HomeStack = createNativeStackNavigator();
const SearchStack = createNativeStackNavigator();
const BookingsStack = createNativeStackNavigator();
const CustProfileStack = createNativeStackNavigator();

// Provider stacks (§3 — 5-tab Hub / Requests / Services / Earnings / Profile)
const HubStack = createNativeStackNavigator();
const RequestsStack = createNativeStackNavigator();
const ServicesStack = createNativeStackNavigator();
const EarningsStack = createNativeStackNavigator();
const ProvProfileStack = createNativeStackNavigator();

// ── Customer tab navigators ───────────────────────────────────────────────────

function HomeStackNavigator() {
  return (
    <HomeStack.Navigator screenOptions={{ headerShown: false }}>
      <HomeStack.Screen name="HomeMain" component={HomeScreen} />
      {/* v3.2 §6 — post-a-request reverse flow */}
      <HomeStack.Screen name="PostRequest" component={PostRequestScreen} />
      <HomeStack.Screen name="ServiceDetail" component={ServiceDetailScreen} />
      <HomeStack.Screen name="Booking" component={BookingScreen} />
      <HomeStack.Screen name="BookingDetail" component={BookingDetailScreen} />
      <HomeStack.Screen name="BrowseMain" component={BrowseScreen} />
      <HomeStack.Screen
        name="ProviderProfile"
        component={ProviderProfileScreen}
      />
      <HomeStack.Screen name="AllReviews" component={AllReviewsScreen} />
      <HomeStack.Screen name="Notifications" component={NotificationsScreen} />
      <HomeStack.Screen name="NotificationSettings" component={NotificationSettingsScreen} />
    </HomeStack.Navigator>
  );
}

function SearchStackNavigator() {
  return (
    <SearchStack.Navigator screenOptions={{ headerShown: false }}>
      <SearchStack.Screen name="SearchMain" component={SearchScreen} />
      <SearchStack.Screen
        name="ServiceDetail"
        component={ServiceDetailScreen}
      />
      <SearchStack.Screen name="Booking" component={BookingScreen} />
      <SearchStack.Screen
        name="BookingDetail"
        component={BookingDetailScreen}
      />
      <SearchStack.Screen
        name="ProviderProfile"
        component={ProviderProfileScreen}
      />
      <SearchStack.Screen name="AllReviews" component={AllReviewsScreen} />
      <SearchStack.Screen name="BrowseMain" component={BrowseScreen} />
      <SearchStack.Screen name="Notifications" component={NotificationsScreen} />
      <SearchStack.Screen name="NotificationSettings" component={NotificationSettingsScreen} />
    </SearchStack.Navigator>
  );
}

function BookingsStackNavigator() {
  return (
    <BookingsStack.Navigator screenOptions={{ headerShown: false }}>
      <BookingsStack.Screen name="BookingsMain" component={BookingsScreen} />
      <BookingsStack.Screen
        name="BookingDetail"
        component={BookingDetailScreen}
      />
      <BookingsStack.Screen name="Notifications" component={NotificationsScreen} />
      <BookingsStack.Screen name="NotificationSettings" component={NotificationSettingsScreen} />
    </BookingsStack.Navigator>
  );
}

function CustomerProfileStackNavigator() {
  return (
    <CustProfileStack.Navigator screenOptions={{ headerShown: false }}>
      <CustProfileStack.Screen name="ProfileMain" component={ProfileScreen} />
      <CustProfileStack.Screen name="EditProfile" component={EditProfileScreen} />
      <CustProfileStack.Screen name="Kyc" component={KycScreen} />
      <CustProfileStack.Screen
        name="SavedLocations"
        component={SavedLocationsScreen}
      />
      <CustProfileStack.Screen name="Notifications" component={NotificationsScreen} />
      <CustProfileStack.Screen name="NotificationSettings" component={NotificationSettingsScreen} />
    </CustProfileStack.Navigator>
  );
}

// ── Provider tab navigators (§3 — Hub / Requests / Services / Earnings / Profile) ─

function HubStackNavigator() {
  return (
    <HubStack.Navigator screenOptions={{ headerShown: false }}>
      <HubStack.Screen name="HubMain" component={HubScreen} />
      {/* Setup spine — the resumable six-milestone onboarding home. Hub
          redirects an un-listed provider here on open (see HubScreen). */}
      <HubStack.Screen name="SetupTimeline" component={ProviderSetupTimelineScreen} />
      {/* Hub "Manage" links — Profile & highlights, Availability */}
      <HubStack.Screen
        name="ProviderProfileEdit"
        component={ProviderProfileEditScreen}
      />
      <HubStack.Screen name="ProviderSetup" component={ProviderSetupScreen} />
      {/* Weekly hours + time off — writes provider_availability, the source the
          WhatsApp/PWA date-pickers and dispatch eligibility read. */}
      <HubStack.Screen name="Availability" component={AvailabilityScreen} />
      {/* Milestone 3 — "Add your service" opens inside the setup stack so it
          returns to the timeline rather than jumping to the Services tab. */}
      <HubStack.Screen name="CreateService" component={CreateServiceScreen} />
      {/* Verification lives in the Hub flow too — the §9.1 checklist and the
          tier-unlock card both deep-link here. */}
      <HubStack.Screen name="Kyc" component={KycScreen} />
      <HubStack.Screen name="Notifications" component={NotificationsScreen} />
      <HubStack.Screen name="NotificationSettings" component={NotificationSettingsScreen} />
    </HubStack.Navigator>
  );
}

function RequestsStackNavigator() {
  return (
    <RequestsStack.Navigator screenOptions={{ headerShown: false }}>
      <RequestsStack.Screen
        name="RequestsMain"
        component={IncomingRequestsScreen}
      />
      {/* Provider booking detail — its own redesigned screen (customer keeps BookingDetailScreen). */}
      <RequestsStack.Screen
        name="BookingDetail"
        component={ProviderBookingDetailScreen}
      />
      <RequestsStack.Screen name="Notifications" component={NotificationsScreen} />
      <RequestsStack.Screen name="NotificationSettings" component={NotificationSettingsScreen} />
    </RequestsStack.Navigator>
  );
}

function ServicesStackNavigator() {
  return (
    <ServicesStack.Navigator screenOptions={{ headerShown: false }}>
      <ServicesStack.Screen name="ServicesMain" component={MyServicesScreen} />
      {/* Single tabbed editor — photos live in a tab, not a separate route. */}
      <ServicesStack.Screen
        name="CreateService"
        component={CreateServiceScreen}
      />
      <ServicesStack.Screen name="Notifications" component={NotificationsScreen} />
      <ServicesStack.Screen name="NotificationSettings" component={NotificationSettingsScreen} />
    </ServicesStack.Navigator>
  );
}

function EarningsStackNavigator() {
  return (
    <EarningsStack.Navigator screenOptions={{ headerShown: false }}>
      <EarningsStack.Screen name="EarningsMain" component={EarningsScreen} />
      <EarningsStack.Screen name="Notifications" component={NotificationsScreen} />
      <EarningsStack.Screen name="NotificationSettings" component={NotificationSettingsScreen} />
    </EarningsStack.Navigator>
  );
}

function ProviderProfileStackNavigator() {
  return (
    <ProvProfileStack.Navigator screenOptions={{ headerShown: false }}>
      {/* Provider's own Profile + Account screen (customer keeps app/ProfileScreen). */}
      <ProvProfileStack.Screen name="ProfileMain" component={ProviderAccountScreen} />
      <ProvProfileStack.Screen name="ProviderProfileEdit" component={ProviderProfileEditScreen} />
      {/* Public profile, for "Preview as customer". */}
      <ProvProfileStack.Screen name="ProviderProfile" component={ProviderProfileScreen} />
      <ProvProfileStack.Screen name="AllReviews" component={AllReviewsScreen} />
      <ProvProfileStack.Screen name="Kyc" component={KycScreen} />
      <ProvProfileStack.Screen
        name="SavedLocations"
        component={SavedLocationsScreen}
      />
      <ProvProfileStack.Screen name="Notifications" component={NotificationsScreen} />
      <ProvProfileStack.Screen name="NotificationSettings" component={NotificationSettingsScreen} />
    </ProvProfileStack.Navigator>
  );
}

// ── Tab bars ──────────────────────────────────────────────────────────────────

function AppTabs() {
  const insets = useSafeAreaInsets();
  const { activeRole } = useAuthStore();
  const isProvider = activeRole === "PROVIDER";
  const tabBarReserve = 20 + spacing.md + insets.bottom;

  const fetchUnread = useNotificationStore((s) => s.fetchUnreadCount);
  const syncClock = useNotificationStore((s) => s.syncClock);
  const pollRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  // OS-level push notifications (like WhatsApp)
  usePushNotifications();

  useEffect(() => {
    fetchUnread();
    syncClock();
    pollRef.current = setInterval(fetchUnread, 60_000);
    return () => clearInterval(pollRef.current);
  }, []);

  // const tabBarStyle = {
  //   backgroundColor: "#ffffff",
  //   borderTopWidth: 0,
  //   borderRadius: 24,
  //   marginHorizontal: spacing.lg,
  //   marginBottom: spacing.md + insets.bottom,
  //   paddingBottom: 6,
  //   paddingTop: 5,
  //   height: 68,
  //   position: "absolute" as const,
  //   zIndex: 100,
  //   // elevation: 16,
  //   ...shadow.card,
  // };

  const tabBarStyle = {
    backgroundColor: "#ffffff",
    // Remove the floating pill styles:
    // borderTopWidth: 0,
    // borderRadius: 24,
    // marginHorizontal: spacing.lg,
    // marginBottom: spacing.md + insets.bottom,

    // 1. Add a subtle top border (classic Facebook/standard app look)
    borderTopWidth: 1,
    borderTopColor: palette.border || "#E2E8F0",

    // 2. Make it full-width and flush to the bottom
    position: "absolute" as const,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 100,

    // 3. The trick: The total height MUST include the system navigation bar area
    height: 60 + insets.bottom,

    // 4. Push the actual icons upward so they sit above the physical/native buttons
    paddingBottom: insets.bottom > 0 ? insets.bottom : 8,
    paddingTop: 8,

    ...shadow.card,
  };

  const sharedOptions = {
    headerShown: false,
    tabBarHideOnKeyboard: true,
    tabBarActiveTintColor: palette.primary,
    tabBarInactiveTintColor: palette.textSecondary,
    tabBarPressColor: palette.primaryLight,
    tabBarPressOpacity: 0.7,
    tabBarStyle,
    sceneStyle: {
      paddingBottom: tabBarReserve,
      backgroundColor: palette.background,
    },
    tabBarLabelStyle: {
      fontFamily: "DMSans_500Medium",
      fontSize: 12,
      marginBottom: 2,
    },
  };

  const providerIcons: Record<string, [React.ComponentProps<typeof Ionicons>["name"], React.ComponentProps<typeof Ionicons>["name"]]> = {
    Hub:      ["grid-outline",      "grid"],
    Requests: ["mail-outline",      "mail"],
    Services: ["construct-outline", "construct"],
    Earnings: ["cash-outline",      "cash"],
    Profile:  ["person-outline",    "person"],
  };

  const customerIcons: Record<string, [React.ComponentProps<typeof Ionicons>["name"], React.ComponentProps<typeof Ionicons>["name"]]> = {
    Home:     ["home-outline",     "home"],
    Search:   ["search-outline",   "search"],
    Bookings: ["calendar-outline", "calendar"],
    Profile:  ["person-outline",   "person"],
  };

  const renderTabIcon = (
    iconMap: typeof providerIcons,
  ) => ({ route }: { route: { name: string } }) => ({
    ...sharedOptions,
    tabBarIcon: ({ color, size, focused }: { color: string; size: number; focused: boolean }) => {
      const pair = iconMap[route.name] ?? ["ellipse-outline", "ellipse"];
      const iconName = focused ? pair[1] : pair[0];
      return (
        <View style={{ alignItems: "center", justifyContent: "center" }}>
          {focused && (
            <View style={{
              position: "absolute",
              top: -2,
              width: 32,
              height: 32,
              borderRadius: 16,
              backgroundColor: palette.primaryLight,
            }} />
          )}
          <Ionicons name={iconName} size={size} color={color} />
        </View>
      );
    },
  });

  if (isProvider) {
    return (
      <Tab.Navigator screenOptions={renderTabIcon(providerIcons)}>
        <Tab.Screen name="Hub" component={HubStackNavigator} />
        <Tab.Screen name="Requests" component={RequestsStackNavigator} />
        <Tab.Screen name="Services" component={ServicesStackNavigator} />
        <Tab.Screen name="Earnings" component={EarningsStackNavigator} />
        <Tab.Screen name="Profile" component={ProviderProfileStackNavigator} />
      </Tab.Navigator>
    );
  }

  return (
    <Tab.Navigator screenOptions={renderTabIcon(customerIcons)}>
      <Tab.Screen name="Home" component={HomeStackNavigator} />
      <Tab.Screen name="Search" component={SearchStackNavigator} />
      <Tab.Screen name="Bookings" component={BookingsStackNavigator} />
      <Tab.Screen name="Profile" component={CustomerProfileStackNavigator} />
    </Tab.Navigator>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [fontsLoaded] = useFonts({
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_600SemiBold,
    DMSans_700Bold,
    DMSans_800ExtraBold,
  });

  const { step, hydrate, logout } = useAuthStore();
  const { fetchPrimary, onboardingNeeded } = useLocationStore();

  useEffect(() => {
    hydrate();
  }, []);

  useEffect(() => {
    if (step === "authenticated") {
      fetchPrimary().then(() => {
        if (useLocationStore.getState().error?.isSessionExpired) {
          logout();
        }
      });
    }
  }, [step]);

  if (!fontsLoaded) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: palette.background,
          padding: spacing.lg,
          justifyContent: "center",
          gap: spacing.sm,
        }}
      >
        <SkeletonBlock width="60%" height={28} />
        <SkeletonBlock width="40%" height={16} />
        <View style={{ height: spacing.lg }} />
        <SkeletonBlock width="100%" height={52} radius={12} />
        <SkeletonBlock width="100%" height={52} radius={12} />
        <SkeletonBlock width="100%" height={52} radius={12} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <PaperProvider theme={appTheme}>
        <SnackbarProvider>
          <NavigationContainer>
            <StatusBar style="dark" translucent backgroundColor="transparent" />
            {step === "authenticated" ? (
              // null = fetchPrimary still in flight; true = no primary set yet
              onboardingNeeded === null ? (
                <View
                  style={{
                    flex: 1,
                    backgroundColor: palette.background,
                    padding: spacing.lg,
                    justifyContent: "center",
                    gap: spacing.sm,
                  }}
                >
                  <SkeletonBlock width="50%" height={22} />
                  <SkeletonBlock width="75%" height={14} />
                  <View style={{ height: spacing.lg }} />
                  <SkeletonBlock width="100%" height={52} radius={12} />
                  <SkeletonBlock width="100%" height={52} radius={12} />
                </View>
              ) : onboardingNeeded === true ? (
                <LocationOnboardingScreen />
              ) : (
                <AppTabs />
              )
            ) : (
              <AuthStack.Navigator screenOptions={{ headerShown: false }}>
                {step === "awaiting_otp" ? (
                  <AuthStack.Screen name="Otp" component={OtpScreen} />
                ) : (
                  <>
                    <AuthStack.Screen name="Login" component={LoginScreen} />
                    <AuthStack.Screen
                      name="Register"
                      component={RegisterScreen}
                    />
                  </>
                )}
              </AuthStack.Navigator>
            )}
          </NavigationContainer>
        </SnackbarProvider>
      </PaperProvider>
    </SafeAreaProvider>
  );
}
