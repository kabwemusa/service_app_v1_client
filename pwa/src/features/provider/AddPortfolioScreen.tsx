import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { verificationApi } from '../../api/verification';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { Button, Card } from '../../components/ui/ui';
import type { ApiError } from '../../api/client';

const MIN = 3;
const MAX = 8;

// Tier 2 — portfolio. Photos run the §5.3 pipeline server-side (NSFW / duplicate);
// a flagged image is rejected with a clear reason. Lighter review than clearance.
export function AddPortfolioScreen() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const add = (picked: FileList | null) => {
    if (!picked) return;
    setFiles((prev) => [...prev, ...Array.from(picked)].slice(0, MAX));
  };
  const remove = (i: number) => setFiles((prev) => prev.filter((_, idx) => idx !== i));

  const submit = async () => {
    if (files.length < MIN) return;
    setBusy(true); setErr(null);
    try {
      await verificationApi.portfolio(files);
      navigate('/verification');
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <ScreenHeader title="Portfolio" />
      <div style={{ padding: 'var(--space-md)', display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
        <Card style={{ background: 'var(--success-light)', border: 'none' }}>
          <p className="t-label">📸 Show your best work</p>
          <p className="t-small" style={{ marginTop: 4 }}>
            Add at least {MIN} clear photos of jobs you've done. A good portfolio unlocks public-venue work and wins more bookings.
          </p>
        </Card>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {files.map((f, i) => (
            <div key={i} style={{ position: 'relative' }}>
              <img src={URL.createObjectURL(f)} alt={`Portfolio ${i + 1}`} style={{ width: '100%', height: 96, objectFit: 'cover', borderRadius: 'var(--radius-sm)' }} />
              <button
                aria-label={`Remove photo ${i + 1}`}
                onClick={() => remove(i)}
                style={{ position: 'absolute', top: 4, right: 4, width: 28, height: 28, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,.6)', color: '#fff' }}
              >
                ×
              </button>
            </div>
          ))}
          {files.length < MAX && (
            <button
              onClick={() => inputRef.current?.click()}
              style={{ height: 96, border: '1px dashed var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--surface)', color: 'var(--text-secondary)', fontSize: 24 }}
            >
              ＋
            </button>
          )}
        </div>
        <input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={(e) => add(e.target.files)} />

        <p className="t-small t-muted">{files.length} of up to {MAX} photos · minimum {MIN}</p>

        {err && <Card style={{ background: 'var(--warning-light)', border: 'none' }}><p className="t-small">{err}</p></Card>}

        <Button onClick={submit} loading={busy} disabled={files.length < MIN}>Submit for review</Button>
      </div>
    </div>
  );
}
