import { useEffect, useState } from 'react';
import { legalApi, type LegalDocument, type LegalDocumentMeta, type LegalDocumentType } from '../../api/legal';
import { useConsentStore } from '../../store/consentStore';
import { useAuthStore } from '../../store/authStore';
import { Button, Spinner } from '../../components/ui/ui';
import { DraftBanner } from './DraftBanner';
import { LegalDocumentView } from './LegalDocumentView';

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 1000,
  background: 'var(--background)', overflowY: 'auto',
};

/**
 * The PWA CONSENT GATE (brief §A) — a blocking overlay for a signed-in user who
 * must (re)consent before using the app. Consent here is informed (documents are
 * one tap away), distinguishable (a discrete required tick), unbundled (optional
 * marketing/analytics are separate, OFF by default), and freely given (Decline is
 * offered plainly). Mirrors the mobile ConsentGateScreen.
 */
export function ConsentGate() {
  const { phase, status, submitting, error, accept, decline, clearDeclined } = useConsentStore();
  const logout = useAuthStore((s) => s.logout);

  const [docs, setDocs] = useState<LegalDocumentMeta[]>([]);
  const [draftMode, setDraftMode] = useState(false);
  const [docsLoading, setDocsLoading] = useState(true);
  const [reading, setReading] = useState<LegalDocument | null>(null);
  const [readingLoad, setReadingLoad] = useState(false);

  const [agreedRequired, setAgreedRequired] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [analytics, setAnalytics] = useState(false);

  const reconsent = status?.reason === 'VERSION_CHANGE';

  useEffect(() => {
    legalApi.listDocuments()
      .then((res) => { setDocs(res.documents); setDraftMode(res.draft_mode); })
      .finally(() => setDocsLoading(false));
  }, []);

  const openDoc = (type: LegalDocumentType) => {
    setReadingLoad(true);
    legalApi.getDocument(type).then(setReading).finally(() => setReadingLoad(false));
  };

  // ── Respectful decline screen ─────────────────────────────────────────────
  if (phase === 'declined') {
    return (
      <div style={{ ...overlay, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center', padding: 'var(--space-xl)' }}>
        <div style={{ fontSize: 48, marginBottom: 'var(--space-md)' }}>🤝</div>
        <h2 className="t-h2" style={{ marginBottom: 'var(--space-sm)' }}>We understand</h2>
        <p className="t-body t-muted" style={{ maxWidth: 360, marginBottom: 'var(--space-sm)' }}>
          Sebenza can’t provide the service without agreement to the core Terms and the
          essential privacy processing. That’s completely your choice.
        </p>
        <p className="t-body t-muted" style={{ marginBottom: 'var(--space-xl)' }}>You’re welcome back any time.</p>
        <div style={{ width: '100%', maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
          <Button onClick={() => clearDeclined()}>Review again</Button>
          <Button variant="secondary" onClick={() => logout()}>Exit</Button>
        </div>
      </div>
    );
  }

  // ── Full-document reader (in-gate) ────────────────────────────────────────
  if (reading || readingLoad) {
    return (
      <div style={overlay}>
        <header style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 'var(--space-md)', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 }}>
          <button aria-label="Back" onClick={() => setReading(null)} style={{ width: 44, height: 44, border: 'none', background: 'transparent', fontSize: 20, color: 'var(--text-primary)' }}>←</button>
          <h1 className="t-h3" style={{ flex: 1 }}>{reading?.title ?? 'Legal'}</h1>
        </header>
        <div style={{ padding: 'var(--space-md)' }}>
          {readingLoad || !reading ? <div style={{ display: 'grid', placeItems: 'center', height: '40vh' }}><Spinner /></div> : <LegalDocumentView doc={reading} />}
        </div>
      </div>
    );
  }

  // ── The gate ──────────────────────────────────────────────────────────────
  return (
    <div style={overlay}>
      <div style={{ maxWidth: 560, margin: '0 auto', padding: 'var(--space-lg)', paddingBottom: 160 }}>
        <div style={{ textAlign: 'center', marginBottom: 'var(--space-lg)' }}>
          <div style={{ fontSize: 40, marginBottom: 'var(--space-sm)' }}>🛡️</div>
          <h1 className="t-h2" style={{ marginBottom: 4 }}>
            {reconsent ? 'We’ve updated our agreements' : 'Before you start'}
          </h1>
          <p className="t-body t-muted">
            {reconsent
              ? 'We’ve made changes to the documents below. Please review and agree to continue.'
              : 'Please review the agreements below. You choose what you agree to — some things are optional.'}
          </p>
        </div>

        <DraftBanner draftMode={draftMode} />

        <p className="t-label" style={{ marginBottom: 'var(--space-sm)' }}>The agreements</p>
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden', marginBottom: 'var(--space-md)' }}>
          {docsLoading ? (
            <div style={{ padding: 'var(--space-lg)', display: 'grid', placeItems: 'center' }}><Spinner /></div>
          ) : (
            docs.map((d, i) => (
              <button
                key={d.type}
                onClick={() => openDoc(d.type)}
                style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 'var(--space-md)', padding: 'var(--space-md)', background: 'var(--surface)', border: 'none', borderTop: i > 0 ? '1px solid var(--border)' : 'none', cursor: 'pointer', textAlign: 'left', color: 'var(--text-primary)' }}
              >
                <div style={{ flex: 1 }}>
                  <div className="t-body" style={{ fontWeight: 600 }}>{d.title}</div>
                  <div className="t-small t-muted">Tap to read · v{d.version}</div>
                </div>
                <span aria-hidden style={{ color: 'var(--text-disabled)' }}>→</span>
              </button>
            ))
          )}
        </div>

        {/* Required consent — distinct, explicit, un-ticked */}
        <label style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'flex-start', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: 'var(--space-md)', cursor: 'pointer', marginBottom: 'var(--space-md)' }}>
          <input
            type="checkbox"
            checked={agreedRequired}
            onChange={(e) => setAgreedRequired(e.target.checked)}
            style={{ width: 20, height: 20, marginTop: 2, accentColor: 'var(--primary)' }}
          />
          <span className="t-small" style={{ lineHeight: 1.5 }}>
            I have read and agree to the <strong>Terms of Service</strong> and{' '}
            <strong>User Agreement</strong>, and I consent to the core processing described
            in the <strong>Privacy Policy</strong> that is needed to provide Sebenza
            (identity verification, booking and payment).
          </span>
        </label>

        {/* Optional processing — unbundled, OFF by default */}
        <p className="t-label" style={{ marginBottom: 'var(--space-sm)' }}>Optional — you can use Sebenza without these</p>
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden', marginBottom: 'var(--space-md)' }}>
          <ToggleRow label="Marketing messages" sub="Offers and news by SMS, WhatsApp or email. Off unless you turn it on." checked={marketing} onChange={setMarketing} />
          <div style={{ borderTop: '1px solid var(--border)' }} />
          <ToggleRow label="Non-essential analytics" sub="Helps us improve the app. Not needed to use Sebenza." checked={analytics} onChange={setAnalytics} />
        </div>

        {error && <p className="t-small" style={{ color: 'var(--danger)', textAlign: 'center' }}>{error.message}</p>}
      </div>

      {/* Sticky action bar */}
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: 'var(--surface)', borderTop: '1px solid var(--border)', padding: 'var(--space-md)', paddingBottom: 'calc(var(--space-md) + env(safe-area-inset-bottom))' }}>
        <div style={{ maxWidth: 560, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
          <Button disabled={!agreedRequired || submitting} loading={submitting} onClick={() => accept({ marketing, analytics })}>
            Agree &amp; continue
          </Button>
          <Button variant="ghost" onClick={() => decline()} disabled={submitting}>Decline</Button>
        </div>
      </div>
    </div>
  );
}

function ToggleRow({ label, sub, checked, onChange }: { label: string; sub: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', padding: 'var(--space-md)', background: 'var(--surface)', cursor: 'pointer' }}>
      <div style={{ flex: 1 }}>
        <div className="t-body" style={{ fontWeight: 600 }}>{label}</div>
        <div className="t-small t-muted">{sub}</div>
      </div>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ width: 40, height: 24, accentColor: 'var(--primary)' }} />
    </label>
  );
}
