import { Suspense, useEffect } from 'react';
import { BrowserRouter, useLocation } from 'react-router-dom';
import { MotionConfig } from 'motion/react';
import { AppRoutes } from './routes';
import { SignInHost } from './features/auth/SignInHost';
import { ConsentGateHost } from './features/legal/ConsentGateHost';
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
      {/* Root-level consent gate — blocks a signed-in user who must (re)consent. */}
      <ConsentGateHost />
    </div>
  );
}

export default function App() {
  const hydrate = useAuthStore((s) => s.hydrate);
  useTheme(); // applies [data-theme] on <html>

  useEffect(() => { hydrate(); }, [hydrate]);

  return (
    // reducedMotion="user" makes every Motion animation honour the OS
    // "reduce motion" setting automatically — movement is dropped, content
    // still appears. One switch for the whole app.
    <MotionConfig reducedMotion="user">
      <BrowserRouter>
        <Shell />
      </BrowserRouter>
    </MotionConfig>
  );
}
