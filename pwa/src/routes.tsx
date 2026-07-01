import { lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

// Route-level code splitting keeps the initial payload lean (low-data).
const BrowseScreen = lazy(() => import('./features/browse/BrowseScreen').then((m) => ({ default: m.BrowseScreen })));
const ServiceDetailScreen = lazy(() => import('./features/browse/ServiceDetailScreen').then((m) => ({ default: m.ServiceDetailScreen })));
const BookingScreen = lazy(() => import('./features/booking/BookingScreen').then((m) => ({ default: m.BookingScreen })));
const OnboardingFlow = lazy(() => import('./features/onboarding/OnboardingFlow').then((m) => ({ default: m.OnboardingFlow })));
const HubScreen = lazy(() => import('./features/provider/HubScreen').then((m) => ({ default: m.HubScreen })));
const VerificationScreen = lazy(() => import('./features/provider/VerificationScreen').then((m) => ({ default: m.VerificationScreen })));
const AddPoliceClearanceScreen = lazy(() => import('./features/provider/AddPoliceClearanceScreen').then((m) => ({ default: m.AddPoliceClearanceScreen })));
const AddPortfolioScreen = lazy(() => import('./features/provider/AddPortfolioScreen').then((m) => ({ default: m.AddPortfolioScreen })));

export function AppRoutes() {
  return (
    <Routes>
      {/* Customer: zero-wall browse */}
      <Route path="/" element={<BrowseScreen />} />
      <Route path="/service/:id" element={<ServiceDetailScreen />} />
      <Route path="/book/:serviceId" element={<BookingScreen />} />

      {/* Provider onboarding + thin hub */}
      <Route path="/get-listed" element={<OnboardingFlow />} />
      <Route path="/hub" element={<HubScreen />} />
      <Route path="/verification" element={<VerificationScreen />} />
      <Route path="/verification/clearance" element={<AddPoliceClearanceScreen />} />
      <Route path="/verification/portfolio" element={<AddPortfolioScreen />} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
