import { useEffect, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { onboardingApi, type OnboardingState } from '../../api/onboarding';
import { ProgressBar, Button, Spinner } from '../../components/ui/ui';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { SignInSheet } from '../auth/SignInSheet';
import { useAuthStore } from '../../store/authStore';
import { AboutStep, OfferStep, IdentityStep, ServiceStep, PayoutStep, GoLiveStep, type StepProps } from './steps';

const ORDER = ['about', 'offer', 'identity', 'service', 'payout', 'go_live'] as const;
const STEP_COMPONENT: Record<string, (p: StepProps) => ReactElement> = {
  about: AboutStep, offer: OfferStep, identity: IdentityStep, service: ServiceStep, payout: PayoutStep, go_live: GoLiveStep,
};

// Progressive, RESUMABLE: the backend owns the step cursor + collected data, so a
// returning provider lands exactly where they dropped off. Account (phone+OTP)
// is the entry gate; everything after is server-persisted.
export function OnboardingFlow() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const hydrate = useAuthStore((s) => s.hydrate);
  const [state, setState] = useState<OnboardingState | null>(null);
  const [loading, setLoading] = useState(true);
  const [signIn, setSignIn] = useState(!user);

  const refresh = () => onboardingApi.state().then(setState).catch(() => {}).finally(() => setLoading(false));

  useEffect(() => { hydrate(); }, [hydrate]);
  useEffect(() => { if (user) refresh(); else setLoading(false); }, [user]);

  if (!user) {
    return (
      <Welcome
        onStart={() => setSignIn(true)}
        sheet={
          <SignInSheet
            open={signIn}
            intent="PROVIDER"
            actionLabel={t('onboarding.getStarted')}
            onClose={() => setSignIn(false)}
            onSuccess={() => { hydrate(); setSignIn(false); refresh(); }}
          />
        }
      />
    );
  }

  if (loading || !state) {
    return <div style={{ display: 'grid', placeItems: 'center', height: '60vh' }}><Spinner /></div>;
  }

  const step = ORDER.includes(state.step as never) ? state.step : 'about';
  const Step = STEP_COMPONENT[step];
  const idx = ORDER.indexOf(step as never);

  const onDone = () => {
    if (step === 'go_live') { navigate('/hub'); return; }
    refresh();
  };

  return (
    <div>
      <ScreenHeader title="Get listed" showBack={false} />
      <div style={{ padding: 'var(--space-md)' }}>
        <p className="t-small t-muted" style={{ marginBottom: 8 }}>
          {t('onboarding.progress', { current: idx + 1, total: ORDER.length })}
        </p>
        <ProgressBar current={idx + 1} total={ORDER.length} />
        <div style={{ marginTop: 'var(--space-lg)' }}>
          <Step state={state} onDone={onDone} />
        </div>
      </div>
    </div>
  );
}

function Welcome({ onStart, sheet }: { onStart: () => void; sheet: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', padding: 'var(--space-lg)', justifyContent: 'center', textAlign: 'center' }}>
      <div style={{ fontSize: 64, marginBottom: 'var(--space-md)' }}>💼</div>
      <h1 className="t-h1" style={{ marginBottom: 'var(--space-sm)' }}>{t('onboarding.welcomeTitle')}</h1>
      <p className="t-muted" style={{ marginBottom: 'var(--space-xl)' }}>{t('onboarding.welcomeSub')}</p>
      <Button onClick={onStart}>{t('onboarding.getStarted')}</Button>
      {sheet}
    </div>
  );
}
