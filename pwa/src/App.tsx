import { Suspense, useEffect } from 'react';
import { BrowserRouter, useLocation } from 'react-router-dom';
import { AppRoutes } from './routes';
import { SignInHost } from './features/auth/SignInHost';
import { useAuthStore } from './store/authStore';
import { useTheme } from './theme/useTheme';
import './i18n';

// The landing page ("/") is a full-width marketing site; every app screen
// keeps the mobile-first 480px shell. Must live inside BrowserRouter.
function Shell() {
  const { pathname } = useLocation();
  const isLanding = pathname === '/';
  return (
    <div className={isLanding ? 'landing-shell' : 'app-shell'}>
      <Suspense fallback={null}>
        <AppRoutes />
      </Suspense>
      {/* Root-level sign-in sheet for the customer first-action flow. */}
      <SignInHost />
    </div>
  );
}

export default function App() {
  const hydrate = useAuthStore((s) => s.hydrate);
  useTheme(); // applies [data-theme] on <html>

  useEffect(() => { hydrate(); }, [hydrate]);

  return (
    <BrowserRouter>
      <Shell />
    </BrowserRouter>
  );
}
