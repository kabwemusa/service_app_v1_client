import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { legalApi, type LegalDocument, type LegalDocumentType } from '../../api/legal';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { Spinner } from '../../components/ui/ui';
import { LegalDocumentView } from './LegalDocumentView';

// Public single-document reader (/legal/:type) — same versioned source as the app.
export function LegalDocumentScreen() {
  const { type } = useParams<{ type: LegalDocumentType }>();
  const [doc, setDoc] = useState<LegalDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!type) return;
    setLoading(true);
    legalApi.getDocument(type)
      .then(setDoc)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [type]);

  return (
    <div>
      <ScreenHeader title={doc?.title ?? 'Legal'} />
      <div style={{ padding: 'var(--space-md)' }}>
        {loading ? (
          <div style={{ display: 'grid', placeItems: 'center', height: '40vh' }}><Spinner /></div>
        ) : error || !doc ? (
          <p className="t-body t-muted">This document is unavailable. Please try again.</p>
        ) : (
          <LegalDocumentView doc={doc} />
        )}
      </div>
    </div>
  );
}
