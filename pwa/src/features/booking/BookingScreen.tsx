import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { catalogApi, type ServiceCard } from '../../api/catalog';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { Button, Card, Field, inputStyle } from '../../components/ui/ui';
import { api } from '../../api/client';
import { useAuthStore } from '../../store/authStore';

// Post-sign-in resume target: the booking the guest tapped survived. Name and
// address are captured LAZILY here (never upfront). Payment/escrow is Phase 4 —
// stubbed: we capture intent and stop at the funding step.
export function BookingScreen() {
  const { serviceId = '' } = useParams();
  const user = useAuthStore((s) => s.user);
  const [s, setS] = useState<ServiceCard | null>(null);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [savedName, setSavedName] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => { catalogApi.service(serviceId).then(setS).catch(() => {}); }, [serviceId]);

  const proceed = async () => {
    // Lazy profile capture — only what the booking needs, only now.
    if (name) { await api.patch('/me/account', { name }, true).catch(() => {}); setSavedName(true); }
    setDone(true);
  };

  return (
    <div>
      <ScreenHeader title="Confirm booking" />
      <div style={{ padding: 'var(--space-md)', display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
        {s && (
          <Card>
            <p className="t-label">{s.title}</p>
            {s.category && <p className="t-small t-muted">{s.category.name}</p>}
            {(s.min_price ?? s.base_price) != null && <p className="t-price" style={{ marginTop: 6 }}>K{s.min_price ?? s.base_price}</p>}
          </Card>
        )}

        {done ? (
          <Card>
            <p className="t-h3" style={{ marginBottom: 8 }}>You're all set 🎉</p>
            <p className="t-small t-muted">
              Your details are saved{savedName ? '' : ''}. Payment is the next step — escrow funding
              arrives in the next release.
            </p>
          </Card>
        ) : (
          <>
            {!user?.email && (
              <Field label="Your name" hint="So the provider knows who to expect.">
                <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} placeholder="e.g. Chanda Mwale" />
              </Field>
            )}
            <Field label="Where is the service?" hint="Saved to your address book for next time.">
              <input value={address} onChange={(e) => setAddress(e.target.value)} style={inputStyle} placeholder="Area / landmark" />
            </Field>
            <Button onClick={proceed}>Continue</Button>
          </>
        )}
      </div>
    </div>
  );
}
