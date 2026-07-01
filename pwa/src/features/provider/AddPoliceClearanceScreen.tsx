import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { verificationApi } from '../../api/verification';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { Button, Card, Field, inputStyle } from '../../components/ui/ui';
import { PhotoCapture } from '../../components/ui/PhotoCapture';
import type { ApiError } from '../../api/client';

// Tier 3 — police clearance. Unlocks in-home jobs. Includes the REQUIRED
// "how to get one" helper: many informal providers don't have a certificate yet,
// and excluding them would cut the supply we need.
export function AddPoliceClearanceScreen() {
  const navigate = useNavigate();
  const [doc, setDoc] = useState<File | null>(null);
  const [certNumber, setCertNumber] = useState('');
  const [issuedOn, setIssuedOn] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!doc || !certNumber || !issuedOn) return;
    setBusy(true); setErr(null);
    try {
      await verificationApi.policeClearance(doc, certNumber, issuedOn);
      navigate('/verification');
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <ScreenHeader title="Police clearance" />
      <div style={{ padding: 'var(--space-md)', display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
        <Card style={{ background: 'var(--success-light)', border: 'none' }}>
          <p className="t-label">🏠 Unlocks in-home jobs</p>
          <p className="t-small" style={{ marginTop: 4 }}>
            A clearance is what lets customers trust you to work inside their home — the highest-paying jobs.
          </p>
        </Card>

        {/* REQUIRED helper — entry must exist; copy is a stub for now. */}
        <Card>
          <button
            onClick={() => setShowHelp((s) => !s)}
            style={{ width: '100%', textAlign: 'left', border: 'none', background: 'transparent', padding: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <span className="t-label">Don't have one yet?</span>
            <span aria-hidden>{showHelp ? '−' : '+'}</span>
          </button>
          {showHelp && (
            <div className="t-small t-muted" style={{ marginTop: 'var(--space-sm)' }}>
              <p>You can get a Police Clearance Certificate from the Zambia Police Service:</p>
              <ol style={{ paddingLeft: 18, marginTop: 6 }}>
                <li>Visit your nearest Police station or the Force Headquarters in Lusaka.</li>
                <li>Bring your NRC and a passport photo.</li>
                <li>Pay the clearance fee and give your fingerprints.</li>
                <li>Collect the certificate, then come back here to upload it.</li>
              </ol>
            </div>
          )}
        </Card>

        <PhotoCapture label="Photo of your clearance certificate" capture="environment" onSelect={setDoc} />

        <Field label="Certificate number">
          <input value={certNumber} onChange={(e) => setCertNumber(e.target.value)} style={inputStyle} placeholder="e.g. PCC/2026/12345" />
        </Field>
        <Field label="Date issued">
          <input type="date" value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} max={new Date().toISOString().slice(0, 10)} style={inputStyle} />
        </Field>

        <Card style={{ background: 'var(--primary-light)', border: 'none' }}>
          <p className="t-small">🔒 Your certificate is private — used only to verify you, never shown to customers.</p>
        </Card>

        {err && <Card style={{ background: 'var(--warning-light)', border: 'none' }}><p className="t-small">{err}</p></Card>}

        <Button onClick={submit} loading={busy} disabled={!doc || !certNumber || !issuedOn}>Submit for review</Button>
      </div>
    </div>
  );
}
