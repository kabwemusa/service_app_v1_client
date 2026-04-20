import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/plus-jakarta-sans';
import { Ionicons } from '@expo/vector-icons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { View } from 'react-native';
import { PaperProvider } from 'react-native-paper';
import { SkeletonBlock } from './src/components/ui/SkeletonBlock';
import { SnackbarProvider } from './src/providers/SnackbarProvider';
import LoginScreen from './src/screens/auth/LoginScreen';
import OtpScreen from './src/screens/auth/OtpScreen';
import RegisterScreen from './src/screens/auth/RegisterScreen';
import BookingDetailScreen from './src/screens/app/BookingDetailScreen';
import BookingScreen from './src/screens/app/BookingScreen';
import BookingsScreen from './src/screens/app/BookingsScreen';
import BrowseScreen from './src/screens/app/BrowseScreen';
import HomeScreen from './src/screens/app/HomeScreen';
import ProfileScreen from './src/screens/app/ProfileScreen';
import SearchScreen from './src/screens/app/SearchScreen';
import ServiceDetailScreen from './src/screens/app/ServiceDetailScreen';
import KycScreen from './src/screens/app/KycScreen';
import CreateServiceScreen from './src/screens/provider/CreateServiceScreen';
import MyServicesScreen from './src/screens/provider/MyServicesScreen';
import ProviderProfileScreen from './src/screens/provider/ProviderProfileScreen';
import ProviderSetupScreen from './src/screens/provider/ProviderSetupScreen';
import ServicePhotosScreen from './src/screens/provider/ServicePhotosScreen';
import { useAuthStore } from './src/store/authStore';
import { appTheme, palette, shadow, spacing } from './src/theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const AuthStack     = createNativeStackNavigator();
const Tab           = createBottomTabNavigator();
const HomeStack     = createNativeStackNavigator();
const SearchStack   = createNativeStackNavigator();
const BookingsStack = createNativeStackNavigator();
const ProfileStack  = createNativeStackNavigator();
const ProviderStack = createNativeStackNavigator();

function HomeStackNavigator() {
  return (
    <HomeStack.Navigator screenOptions={{ headerShown: false }}>
      <HomeStack.Screen name="HomeMain"        component={HomeScreen} />
      <HomeStack.Screen name="ServiceDetail"   component={ServiceDetailScreen} />
      <HomeStack.Screen name="Booking"         component={BookingScreen} />
      <HomeStack.Screen name="BookingDetail"   component={BookingDetailScreen} />
      <HomeStack.Screen name="BrowseMain"      component={BrowseScreen} />
      <HomeStack.Screen name="ProviderProfile" component={ProviderProfileScreen} />
    </HomeStack.Navigator>
  );
}

function SearchStackNavigator() {
  return (
    <SearchStack.Navigator screenOptions={{ headerShown: false }}>
      <SearchStack.Screen name="SearchMain"      component={SearchScreen} />
      <SearchStack.Screen name="ServiceDetail"   component={ServiceDetailScreen} />
      <SearchStack.Screen name="Booking"         component={BookingScreen} />
      <SearchStack.Screen name="BookingDetail"   component={BookingDetailScreen} />
      <SearchStack.Screen name="ProviderProfile" component={ProviderProfileScreen} />
      <SearchStack.Screen name="BrowseMain"      component={BrowseScreen} />
    </SearchStack.Navigator>
  );
}

function BookingsStackNavigator() {
  return (
    <BookingsStack.Navigator screenOptions={{ headerShown: false }}>
      <BookingsStack.Screen name="BookingsMain"  component={BookingsScreen} />
      <BookingsStack.Screen name="BookingDetail" component={BookingDetailScreen} />
    </BookingsStack.Navigator>
  );
}

function ProfileStackNavigator({ isProvider }: { isProvider: boolean }) {
  return (
    <ProfileStack.Navigator screenOptions={{ headerShown: false }}>
      <ProfileStack.Screen name="ProfileMain"    component={ProfileScreen} />
      <ProfileStack.Screen name="Kyc"            component={KycScreen} />
      {isProvider && (
        <>
          <ProfileStack.Screen name="ProviderSetup"  component={ProviderSetupScreen} />
          <ProfileStack.Screen name="MyServices"     component={MyServicesScreen} />
          <ProfileStack.Screen name="CreateService"  component={CreateServiceScreen} />
          <ProfileStack.Screen name="ServicePhotos"  component={ServicePhotosScreen} />
        </>
      )}
    </ProfileStack.Navigator>
  );
}

function ProviderStackNavigator() {
  return (
    <ProviderStack.Navigator screenOptions={{ headerShown: false }}>
      <ProviderStack.Screen name="MyServicesMain"  component={MyServicesScreen} />
      <ProviderStack.Screen name="CreateService"   component={CreateServiceScreen} />
      <ProviderStack.Screen name="ServicePhotos"   component={ServicePhotosScreen} />
    </ProviderStack.Navigator>
  );
}

function AppTabs({ isProvider }: { isProvider: boolean }) {
  const insets = useSafeAreaInsets();

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor:   palette.primary,
        tabBarInactiveTintColor: palette.textSecondary,
        tabBarPressColor:        palette.primaryLight,
        tabBarPressOpacity:      0.7,
        tabBarStyle: {
          backgroundColor: '#ffffff',
          borderTopWidth:  0,
          borderRadius:    24,
          marginHorizontal: spacing.lg,
          marginBottom:    spacing.md + insets.bottom,
          paddingBottom:   6,
          paddingTop:      6,
          height:          68,
          position:        'absolute',
          ...shadow.card,
        },
        tabBarLabelStyle: {
          fontFamily: 'PlusJakartaSans_500Medium',
          fontSize:   12,
          marginBottom: 2,
        },
        tabBarIcon: ({ color, size }) => {
          const icons: Record<string, React.ComponentProps<typeof Ionicons>['name']> = {
            Home:          'home-outline',
            Search:        'search-outline',
            Bookings:      'calendar-outline',
            'My Services': 'construct-outline',
            Profile:       'person-outline',
          };
          return <Ionicons name={icons[route.name] ?? 'ellipse-outline'} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Home"   component={HomeStackNavigator} />
      <Tab.Screen name="Search" component={SearchStackNavigator} />
      {isProvider ? (
        <Tab.Screen name="My Services" component={ProviderStackNavigator} />
      ) : (
        <Tab.Screen name="Bookings" component={BookingsStackNavigator} />
      )}
      <Tab.Screen
        name="Profile"
        children={() => <ProfileStackNavigator isProvider={isProvider} />}
      />
    </Tab.Navigator>
  );
}

export default function App() {
  const [fontsLoaded] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });

  const { step, user, hydrate } = useAuthStore();

  useEffect(() => {
    hydrate();
  }, []);

  if (!fontsLoaded) {
    return (
      <View style={{
        flex: 1,
        backgroundColor: palette.background,
        padding: spacing.lg,
        justifyContent: 'center',
        gap: spacing.sm,
      }}>
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
    <PaperProvider theme={appTheme}>
      <SnackbarProvider>
        <NavigationContainer>
          <StatusBar style="dark" backgroundColor={palette.background} />
          {step === 'authenticated' ? (
            <AppTabs isProvider={user?.role === 'PROVIDER'} />
          ) : (
            <AuthStack.Navigator screenOptions={{ headerShown: false }}>
              {step === 'awaiting_otp' ? (
                <AuthStack.Screen name="Otp"      component={OtpScreen} />
              ) : (
                <>
                  <AuthStack.Screen name="Login"    component={LoginScreen} />
                  <AuthStack.Screen name="Register" component={RegisterScreen} />
                </>
              )}
            </AuthStack.Navigator>
          )}
        </NavigationContainer>
      </SnackbarProvider>
    </PaperProvider>
  );
}
