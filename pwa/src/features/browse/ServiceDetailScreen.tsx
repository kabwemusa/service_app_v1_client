import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { catalogApi, type ServiceCard } from '../../api/catalog';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { Button, Card } from '../../components/ui/ui';
import { useAuthStore } from '../../store/authStore';
import { usePendingAction } from '../../store/pendingActionStore';

// Open without auth. The Book button is the first committing action — for a guest
// it opens the sign-in sheet; the tapped service is preserved across sign-in.
export function ServiceDetailScreen() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const requireAuth = usePendingAction((s) => s.requireAuth);
  const [s, setS] = useState<ServiceCard | null>(null);

  useEffect(() => { catalogApi.service(id).then(setS).catch(() => {}); }, [id]);

  const book = () => {
    if (user) { navigate(`/book/${id}`); return; }
    requireAuth({ kind: 'book', serviceId: id, label: t('common.almostThere') });
  };

  if (!s) return <><ScreenHeader /><div style={{ padding: 'var(--space-md)' }}><div className="skeleton" style={{ height: 200 }} /></div></>;

  const price = s.min_price ?? s.base_price;

  return (
    <div style={{ paddingBottom: 96 }}>
      <ScreenHeader title={s.title} />
      <div style={{ padding: 'var(--space-md)' }}>
        {s.photos?.[0]?.url
          ? <img src={s.photos[0].url} alt="" style={{ width: '100%', height: 220, objectFit: 'cover', borderRadius: 'var(--radius-sm)' }} />
          : <div style={{ width: '100%', height: 160, borderRadius: 'var(--radius-sm)', background: 'var(--primary-light)' }} />}

        <h2 className="t-h2" style={{ marginTop: 'var(--space-md)' }}>{s.title}</h2>
        {s.category && <p className="t-muted">{s.category.name}</p>}
        {price != null && <p className="t-price" style={{ marginTop: 8 }}>{t('browse.from')} K{price}</p>}
        {s.description && <Card style={{ marginTop: 'var(--space-md)' }}><p className="t-body">{s.description}</p></Card>}
      </div>

      <div
        style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, maxWidth: 480, margin: '0 auto',
          padding: 'var(--space-md)', paddingBottom: 'calc(var(--space-md) + env(safe-area-inset-bottom))',
          background: 'var(--surface)', borderTop: '1px solid var(--border)',
        }}
      >
        <Button onClick={book}>{t('browse.book')}</Button>
      </div>
    </div>
  );
}
