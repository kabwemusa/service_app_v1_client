import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { legalApi, type DataSubjectRequestType } from '../../api/legal';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { Button, Card, Spinner } from '../../components/ui/ui';
import { useAuthStore } from '../../store/authStore';
import { useConsentStore } from '../../store/consentStore';

const RIGHTS: { type: DataSubjectRequestType; label: string; sub: string }[] = [
  { type: 'ACCESS', label: 'Access my data', sub: 'Get a copy of the personal data we hold' },
  { type: 'RECTIFICATION', label: 'Correct my data', sub: 'Ask us to fix inaccurate details' },
  { type: 'PORTABILITY', label: 'Export my data', sub: 'Receive your data in a portable form' },
  { type: 'OBJECTION', label: 'Object to processing', sub: 'Object to how your data is used' },
  { type: 'RESTRICTION', label: 'Restrict processing', sub: 'Ask us to pause certain processing' },
  { type: 'ERASURE', label: 'Delete my data', sub: 'Ask us to erase your personal data' },
];

/**
 * PWA Privacy & consent (brief §C) — withdraw consent + exercise data-subject
 * rights. Same backend + logic as the mobile PrivacyConsentScreen.
 */
export function PrivacyConsentScreen() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const { status, loading, refresh, accept, withdraw, submitting } = useConsentStore();
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => { if (user) refresh(); }, [user]);

  if (!user) {
    return (
      <div>
        <ScreenHeader title="Privacy & consent" />
        <div style={{ padding: 'var(--space-lg)', textAlign: 'center' }}>
          <p className="t-body t-muted">Sign in to manage your consent and data rights.</p>
        </div>
      </div>
    );
  }

  const marketing = status?.marketing_opt_in ?? false;
  const analytics = status?.analytics_opt_in ?? false;

  const toggleOptional = async (scope: 'marketing' | 'analytics', on: boolean) => {
    const ok = on
      ? await accept({ marketing: scope === 'marketing' ? true : marketing, analytics: scope === 'analytics' ? true : analytics })
      : await withdraw(scope);
    setToast(ok ? 'Updated.' : 'Could not update. Please try again.');
  };

  const requestRight = async (right: (typeof RIGHTS)[number]) => {
    if (!window.confirm(`We’ll record your request to ${right.label.toLowerCase()} and follow up using the contact details on your account. Send this request?`)) return;
    try {
      await legalApi.submitDataRequest(right.type);
      setToast('Request received. We’ll follow up on your account contact.');
    } catch {
      setToast('Could not send that request. Please try again.');
    }
  };

  const withdrawCore = async () => {
    if (!window.confirm('Sebenza needs your consent to the core processing (identity, booking, payment) to run. If you withdraw it, we can no longer provide the service and you will be signed out. Your consent history is kept. Continue?')) return;
    try {
      await withdraw('CORE');
      await legalApi.submitDataRequest('WITHDRAW_CONSENT', 'User withdrew core consent from the PWA.');
    } finally {
      logout();
    }
  };

  return (
    <div>
      <ScreenHeader title="Privacy & consent" />
      <div style={{ padding: 'var(--space-md)', display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
        {loading && !status ? (
          <div style={{ display: 'grid', placeItems: 'center', height: '40vh' }}><Spinner /></div>
        ) : (
          <>
            {toast && (
              <div className="t-small" style={{ background: 'var(--success-light)', color: 'var(--success)', padding: 'var(--space-sm) var(--space-md)', borderRadius: 'var(--radius-sm)' }}>{toast}</div>
            )}

            <section>
              <p className="t-label" style={{ marginBottom: 'var(--space-sm)' }}>What you’ve agreed to</p>
              <Card>
                <p className="t-small t-muted" style={{ marginBottom: 8 }}>
                  You’ve accepted the required agreements. You can read them any time.
                </p>
                <Link to="/legal" className="t-label" style={{ color: 'var(--primary)' }}>View Legal &amp; policies →</Link>
              </Card>
            </section>

            <section>
              <p className="t-label" style={{ marginBottom: 'var(--space-sm)' }}>Optional processing</p>
              <Card style={{ padding: 0 }}>
                <OptRow label="Marketing messages" sub="Offers and news. Turn off any time." checked={marketing} disabled={submitting} onChange={(v) => toggleOptional('marketing', v)} />
                <div style={{ borderTop: '1px solid var(--border)' }} />
                <OptRow label="Non-essential analytics" sub="Helps us improve. Turn off any time." checked={analytics} disabled={submitting} onChange={(v) => toggleOptional('analytics', v)} />
              </Card>
            </section>

            <section>
              <p className="t-label" style={{ marginBottom: 'var(--space-sm)' }}>Your data rights</p>
              <Card style={{ padding: 0 }}>
                {RIGHTS.map((right, i) => (
                  <button
                    key={right.type}
                    onClick={() => requestRight(right)}
                    style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 'var(--space-md)', padding: 'var(--space-md)', background: 'transparent', border: 'none', borderTop: i > 0 ? '1px solid var(--border)' : 'none', cursor: 'pointer', textAlign: 'left', color: 'var(--text-primary)' }}
                  >
                    <div style={{ flex: 1 }}>
                      <div className="t-body" style={{ fontWeight: 600 }}>{right.label}</div>
                      <div className="t-small t-muted">{right.sub}</div>
                    </div>
                    <span aria-hidden style={{ color: 'var(--text-disabled)' }}>→</span>
                  </button>
                ))}
              </Card>
            </section>

            <section>
              <p className="t-label" style={{ marginBottom: 'var(--space-sm)' }}>Withdraw consent</p>
              <Button variant="danger" onClick={withdrawCore} disabled={submitting}>Withdraw consent &amp; sign out</Button>
              <p className="t-small t-muted" style={{ marginTop: 8 }}>Ends the service. Your consent history is kept as a record.</p>
            </section>

            <p className="t-small t-muted" style={{ textAlign: 'center', marginTop: 'var(--space-md)' }}>
              You can also complain to the Office of the Data Protection Commissioner in Zambia. See the Privacy Policy for details.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function OptRow({ label, sub, checked, disabled, onChange }: { label: string; sub: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', padding: 'var(--space-md)', cursor: 'pointer' }}>
      <div style={{ flex: 1 }}>
        <div className="t-body" style={{ fontWeight: 600 }}>{label}</div>
        <div className="t-small t-muted">{sub}</div>
      </div>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} style={{ width: 40, height: 24, accentColor: 'var(--primary)' }} />
    </label>
  );
}
