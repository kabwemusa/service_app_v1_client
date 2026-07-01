import { Suspense, useEffect } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { AppRoutes } from './routes';
import { SignInHost } from './features/auth/SignInHost';
import { useAuthStore } from './store/authStore';
import { useTheme } from './theme/useTheme';
import './i18n';

export default function App() {
  const hydrate = useAuthStore((s) => s.hydrate);
  useTheme(); // applies [data-theme] on <html>

  useEffect(() => { hydrate(); }, [hydrate]);

  return (
    <BrowserRouter>
      <div className="app-shell">
        <Suspense fallback={null}>
          <AppRoutes />
        </Suspense>
        {/* Root-level sign-in sheet for the customer first-action flow. */}
        <SignInHost />
      </div>
    </BrowserRouter>
  );
}
