import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
  useFonts,
} from "@expo-google-fonts/plus-jakarta-sans";
import { Ionicons } from "@expo/vector-icons";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import React, { useEffect } from "react";
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
import CreateServiceScreen from "./src/screens/provider/CreateServiceScreen";
import EarningsScreen from "./src/screens/provider/EarningsScreen";
import HubScreen from "./src/screens/provider/HubScreen";
import IncomingRequestsScreen from "./src/screens/provider/IncomingRequestsScreen";
import MyServicesScreen from "./src/screens/provider/MyServicesScreen";
import ProviderProfileEditScreen from "./src/screens/provider/ProviderProfileEditScreen";
import ProviderProfileScreen from "./src/screens/provider/ProviderProfileScreen";
import ProviderSetupScreen from "./src/screens/provider/ProviderSetupScreen";
import ServicePhotosScreen from "./src/screens/provider/ServicePhotosScreen";
import { useAuthStore } from "./src/store/authStore";
import { useLocationStore } from "./src/store/locationStore";
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
      <SearchStack.Screen name="BrowseMain" component={BrowseScreen} />
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
    </CustProfileStack.Navigator>
  );
}

// ── Provider tab navigators (§3 — Hub / Requests / Services / Earnings / Profile) ─

function HubStackNavigator() {
  return (
    <HubStack.Navigator screenOptions={{ headerShown: false }}>
      <HubStack.Screen name="HubMain" component={HubScreen} />
      {/* Hub "Manage" links — Profile & highlights, Availability */}
      <HubStack.Screen
        name="ProviderProfileEdit"
        component={ProviderProfileEditScreen}
      />
      <HubStack.Screen name="ProviderSetup" component={ProviderSetupScreen} />
      {/* Verification lives in the Hub flow too — the §9.1 checklist and the
          tier-unlock card both deep-link here. */}
      <HubStack.Screen name="Kyc" component={KycScreen} />
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
      <RequestsStack.Screen
        name="BookingDetail"
        component={BookingDetailScreen}
      />
    </RequestsStack.Navigator>
  );
}

function ServicesStackNavigator() {
  return (
    <ServicesStack.Navigator screenOptions={{ headerShown: false }}>
      <ServicesStack.Screen name="ServicesMain" component={MyServicesScreen} />
      <ServicesStack.Screen
        name="CreateService"
        component={CreateServiceScreen}
      />
      <ServicesStack.Screen
        name="ServicePhotos"
        component={ServicePhotosScreen}
      />
    </ServicesStack.Navigator>
  );
}

function EarningsStackNavigator() {
  return (
    <EarningsStack.Navigator screenOptions={{ headerShown: false }}>
      <EarningsStack.Screen name="EarningsMain" component={EarningsScreen} />
    </EarningsStack.Navigator>
  );
}

function ProviderProfileStackNavigator() {
  return (
    <ProvProfileStack.Navigator screenOptions={{ headerShown: false }}>
      <ProvProfileStack.Screen name="ProfileMain" component={ProfileScreen} />
      <ProvProfileStack.Screen name="EditProfile" component={EditProfileScreen} />
      <ProvProfileStack.Screen name="Kyc" component={KycScreen} />
      <ProvProfileStack.Screen
        name="SavedLocations"
        component={SavedLocationsScreen}
      />
    </ProvProfileStack.Navigator>
  );
}

// ── Tab bars ──────────────────────────────────────────────────────────────────

function AppTabs() {
  const insets = useSafeAreaInsets();
  const { activeRole } = useAuthStore();
  const isProvider = activeRole === "PROVIDER";
  const tabBarReserve = 20 + spacing.md + insets.bottom;

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
      fontFamily: "PlusJakartaSans_500Medium",
      fontSize: 12,
      marginBottom: 2,
    },
  };

  if (isProvider) {
    return (
      <Tab.Navigator
        screenOptions={({ route }) => ({
          ...sharedOptions,
          tabBarIcon: ({ color, size }) => {
            const icons: Record<
              string,
              React.ComponentProps<typeof Ionicons>["name"]
            > = {
              Hub: "grid-outline",
              Requests: "mail-outline",
              Services: "construct-outline",
              Earnings: "cash-outline",
              Profile: "person-outline",
            };
            return (
              <Ionicons
                name={icons[route.name] ?? "ellipse-outline"}
                size={size}
                color={color}
              />
            );
          },
        })}
      >
        <Tab.Screen name="Hub" component={HubStackNavigator} />
        <Tab.Screen name="Requests" component={RequestsStackNavigator} />
        <Tab.Screen name="Services" component={ServicesStackNavigator} />
        <Tab.Screen name="Earnings" component={EarningsStackNavigator} />
        <Tab.Screen name="Profile" component={ProviderProfileStackNavigator} />
      </Tab.Navigator>
    );
  }

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        ...sharedOptions,
        tabBarIcon: ({ color, size }) => {
          const icons: Record<
            string,
            React.ComponentProps<typeof Ionicons>["name"]
          > = {
            Home: "home-outline",
            Search: "search-outline",
            Bookings: "calendar-outline",
            Profile: "person-outline",
          };
          return (
            <Ionicons
              name={icons[route.name] ?? "ellipse-outline"}
              size={size}
              color={color}
            />
          );
        },
      })}
    >
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
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
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
