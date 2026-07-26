import { useEffect } from 'react';
import { useAuthStore } from '../../store/authStore';
import { useConsentStore } from '../../store/consentStore';
import { ConsentGate } from './ConsentGate';

/**
 * Root-level consent gate host (mounted in App, alongside SignInHost). When a
 * user is signed in, it fetches their consent standing; if they still need to
 * (re)accept — or they declined — it renders the blocking ConsentGate overlay
 * over the whole app. Same consent record + logic as the mobile app (parity).
 *
 * Note: the PWA is browse-first, so an anonymous visitor is never gated — the
 * gate only applies once an account exists (phone verified), matching the app.
 */
export function ConsentGateHost() {
  const user = useAuthStore((s) => s.user);
  const { phase, status, refresh, reset } = useConsentStore();

  useEffect(() => {
    if (user) refresh();
    else reset();
  }, [user]);

  if (!user) return null;
  if (phase === 'declined') return <ConsentGate />;
  if (status?.needs_consent) return <ConsentGate />;
  return null;
}
