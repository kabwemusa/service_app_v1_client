import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { legalApi, type LegalDocumentMeta } from '../../api/legal';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { Card, Spinner } from '../../components/ui/ui';
import { DraftBanner } from './DraftBanner';

// Public "Legal & policies" index — the three versioned documents, readable any
// time (not only at signup), shown on the PWA/website as well as the app.
export function LegalScreen() {
  const [docs, setDocs] = useState<LegalDocumentMeta[]>([]);
  const [draftMode, setDraftMode] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    legalApi.listDocuments()
      .then((res) => { setDocs(res.documents); setDraftMode(res.draft_mode); })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <ScreenHeader title="Legal & policies" />
      <div style={{ padding: 'var(--space-md)' }}>
        {loading ? (
          <div style={{ display: 'grid', placeItems: 'center', height: '40vh' }}><Spinner /></div>
        ) : (
          <>
            <DraftBanner draftMode={draftMode} />
            <p className="t-small t-muted" style={{ marginBottom: 'var(--space-md)' }}>
              These are the agreements between you and Sebenza Technologies Ltd.
              They are available here any time.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
              {docs.map((d) => (
                <Link key={d.type} to={`/legal/${d.type}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                  <Card style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
                    <div style={{ flex: 1 }}>
                      <div className="t-body" style={{ fontWeight: 600 }}>{d.title}</div>
                      <div className="t-small t-muted">
                        Version {d.version}{d.effective_date ? ` · Effective ${d.effective_date}` : ' · Draft'}
                      </div>
                    </div>
                    <span aria-hidden style={{ color: 'var(--text-disabled)' }}>→</span>
                  </Card>
                </Link>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
