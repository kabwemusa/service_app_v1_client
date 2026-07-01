import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { onboardingApi, type OnboardingState } from '../../api/onboarding';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { Card, Pill, Spinner } from '../../components/ui/ui';

// Minimal provider hub — the go-live destination. Surfaces the account state
// (SET_UP vs LIVE) and the entry to the tier-upgrade surface (Profile →
// Verification). The full hub/dashboard is out of scope for this phase.
export function HubScreen() {
  const [state, setState] = useState<OnboardingState | null>(null);

  useEffect(() => { onboardingApi.state().then(setState).catch(() => {}); }, []);

  if (!state) return <div style={{ display: 'grid', placeItems: 'center', height: '60vh' }}><Spinner /></div>;

  const live = state.state === 'LIVE';

  return (
    <div>
      <ScreenHeader title="Your business" showBack={false} />
      <div style={{ padding: 'var(--space-md)', display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <p className="t-label">{state.collected.name ?? 'Your profile'}</p>
              <p className="t-small t-muted">{state.chosen_service?.title ?? 'No service yet'}</p>
            </div>
            <Pill tone={live ? 'success' : 'warning'}>{live ? 'Live' : 'Set up'}</Pill>
          </div>
        </Card>

        {!live && (
          <Card style={{ background: 'var(--warning-light)', border: 'none' }}>
            <p className="t-label" style={{ marginBottom: 4 }}>One step to start getting jobs</p>
            <p className="t-small">Add the missing verification to unlock dispatch for your category.</p>
          </Card>
        )}

        <Link to="/verification">
          <Card style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}>
            <span className="t-label">Verification & tiers</span>
            <span aria-hidden style={{ color: 'var(--text-secondary)' }}>›</span>
          </Card>
        </Link>
      </div>
    </div>
  );
}
