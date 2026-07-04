import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { catalogApi, type Category } from '../../api/catalog';
import { onboardingApi, type OnboardingState, type GoLiveResult } from '../../api/onboarding';
import { Button, Card, Field, inputStyle, Pill } from '../../components/ui/ui';
import { PhotoCapture } from '../../components/ui/PhotoCapture';
import { TierLadder } from '../../components/ui/TierLadder';
import type { ApiError } from '../../api/client';

const LANGS = [
  { code: 'en', label: 'English' },
  { code: 'ny', label: 'Nyanja' },
  { code: 'bem', label: 'Bemba' },
  { code: 'ton', label: 'Tonga' },
];

const RISK_LABEL: Record<number, string> = { 1: 'Remote — basic ID only', 2: 'Public venue — portfolio later', 3: 'In-home — clearance later' };

export interface StepProps {
  state: OnboardingState;
  onDone: () => void;
}

export function AboutStep({ state, onDone }: StepProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(state.collected.name ?? '');
  const [langs, setLangs] = useState<string[]>(state.collected.languages ?? []);
  const [area, setArea] = useState(state.collected.area_label ?? '');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const toggleLang = (c: string) => setLangs((l) => (l.includes(c) ? l.filter((x) => x !== c) : [...l, c]));

  const useGps = () => navigator.geolocation?.getCurrentPosition((p) => {
    setCoords({ lat: p.coords.latitude, lng: p.coords.longitude });
    if (!area) setArea('My location');
  });

  const submit = async () => {
    setBusy(true);
    // Avatar is uploaded immediately on capture (PhotoCapture onSelect); here we
    // persist the rest of the About step.
    await onboardingApi.about({ name, languages: langs, area_label: area, ...(coords ? { latitude: coords.lat, longitude: coords.lng } : {}) });
    setBusy(false);
    onDone();
  };

  return (
    <div>
      <h2 className="t-h2" style={{ marginBottom: 'var(--space-md)' }}>{t('onboarding.aboutTitle')}</h2>
      <PhotoCapture label={t('onboarding.photo')} capture="user" shape="circle" onSelect={(f) => onboardingApi.avatar(f)} />
      <p className="t-small t-muted" style={{ marginTop: -8, marginBottom: 'var(--space-md)' }}>{t('onboarding.photoHint')}</p>
      <Field label={t('onboarding.name')}>
        <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
      </Field>
      <Field label={t('onboarding.area')}>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={area} onChange={(e) => setArea(e.target.value)} style={{ ...inputStyle, flex: 1 }} placeholder="e.g. Kabwata, Lusaka" />
          <Button variant="secondary" full={false} onClick={useGps}>📍</Button>
        </div>
      </Field>
      <Field label={t('onboarding.languages')}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {LANGS.map((l) => (
            <button
              key={l.code}
              onClick={() => toggleLang(l.code)}
              style={{
                minHeight: 40, padding: '0 var(--space-md)', borderRadius: 'var(--radius-full)',
                border: '1px solid var(--border)', fontWeight: 600,
                background: langs.includes(l.code) ? 'var(--primary)' : 'var(--surface)',
                color: langs.includes(l.code) ? '#fff' : 'var(--text-primary)',
              }}
            >
              {l.label}
            </button>
          ))}
        </div>
      </Field>
      <Button onClick={submit} loading={busy} disabled={!name}>{t('common.continue')}</Button>
    </div>
  );
}

export function OfferStep({ onDone }: StepProps) {
  const { t } = useTranslation();
  const [cats, setCats] = useState<Category[]>([]);
  const [picked, setPicked] = useState<Category | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { catalogApi.categories().then(setCats).catch(() => {}); }, []);

  const submit = async () => {
    if (!picked) return;
    setBusy(true);
    await onboardingApi.offer(picked.id);
    setBusy(false);
    onDone();
  };

  return (
    <div>
      <h2 className="t-h2">{t('onboarding.offerTitle')}</h2>
      <p className="t-muted" style={{ marginBottom: 'var(--space-md)' }}>{t('onboarding.offerSub')}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
        {cats.map((c) => (
          <Card key={c.id} onClick={() => setPicked(c)} style={{ borderColor: picked?.id === c.id ? 'var(--primary)' : 'var(--border)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="t-label">{c.name}</span>
            {c.risk_tier != null && <Pill tone={c.risk_tier === 1 ? 'success' : 'warning'}>{RISK_LABEL[c.risk_tier]}</Pill>}
          </Card>
        ))}
      </div>
      <div style={{ marginTop: 'var(--space-lg)' }}>
        <Button onClick={submit} loading={busy} disabled={!picked}>{t('common.continue')}</Button>
      </div>
    </div>
  );
}

export function IdentityStep({ onDone }: StepProps) {
  const { t } = useTranslation();
  const [nrc, setNrc] = useState<File | null>(null);
  const [selfie, setSelfie] = useState<File | null>(null);
  const [momo, setMomo] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!nrc || !selfie || !momo) return;
    setBusy(true); setErr(null);
    try {
      await onboardingApi.identity(nrc, selfie, momo);
      onDone();
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h2 className="t-h2">{t('onboarding.identityTitle')}</h2>
      <Card style={{ background: 'var(--primary-light)', border: 'none', margin: 'var(--space-md) 0' }}>
        <p className="t-small">🔒 {t('onboarding.identitySub')}</p>
      </Card>
      <PhotoCapture label={t('onboarding.nrcFront')} capture="environment" onSelect={setNrc} />
      <PhotoCapture label={t('onboarding.selfie')} capture="user" shape="circle" onSelect={setSelfie} />
      <Field label={t('onboarding.momoNumber')}>
        <input value={momo} onChange={(e) => setMomo(e.target.value)} inputMode="tel" style={inputStyle} placeholder="097 123 4567" />
      </Field>
      {err && <Card style={{ background: 'var(--warning-light)', border: 'none', marginBottom: 'var(--space-md)' }}><p className="t-small">{err}</p></Card>}
      <Button onClick={submit} loading={busy} disabled={!nrc || !selfie || !momo}>{t('common.continue')}</Button>
    </div>
  );
}

// Outcome-based pricing — the provider owns every price parameter; customers
// never input hours anywhere.
const PRICING_MODELS = [
  { value: 'OUTCOME_FIXED',  label: 'Fixed price',      hint: 'One price for a defined outcome.' },
  { value: 'HOURLY_CAPPED',  label: 'Hourly + cap',     hint: 'Your rate; a spend cap protects customers (set on the backend, editable later).' },
  { value: 'PROVIDER_SCOPE', label: 'Quote after brief', hint: 'Customers describe the job; you send a fixed quote.' },
  { value: 'QUOTE_DEPOSIT',  label: 'Quote + deposit',  hint: 'Big jobs: full quote, a deposit confirms, balance on completion.' },
] as const;

export function ServiceStep({ onDone }: StepProps) {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [model, setModel] = useState<string>('OUTCOME_FIXED');
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [busy, setBusy] = useState(false);

  const toggleDay = (d: number) => setDays((arr) => (arr.includes(d) ? arr.filter((x) => x !== d) : [...arr, d]));

  const needsPrice = model === 'OUTCOME_FIXED' || model === 'HOURLY_CAPPED';

  const submit = async () => {
    setBusy(true);
    await onboardingApi.service({
      title,
      price: price ? Number(price) : undefined,
      pricing_model: model,
      availability: days.map((d) => ({ day_of_week: d, start_time: '08:00', end_time: '17:00' })),
    });
    setBusy(false);
    onDone();
  };

  const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  const selected = PRICING_MODELS.find((m) => m.value === model)!;

  return (
    <div>
      <h2 className="t-h2" style={{ marginBottom: 'var(--space-md)' }}>{t('onboarding.serviceTitle')}</h2>
      <Field label={t('onboarding.serviceName')}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} style={inputStyle} placeholder="e.g. Logo design" />
      </Field>
      <Field label="How do you price this?">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {PRICING_MODELS.map((m) => (
            <button
              key={m.value}
              onClick={() => setModel(m.value)}
              style={{
                padding: '8px 12px', borderRadius: 'var(--radius-full)', border: '1px solid var(--border)', fontWeight: 600, fontSize: 13,
                background: model === m.value ? 'var(--primary)' : 'var(--surface)',
                color: model === m.value ? '#fff' : 'var(--text-primary)',
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="t-small t-muted" style={{ marginTop: 6 }}>{selected.hint}</p>
      </Field>
      {needsPrice && (
        <Field label={model === 'HOURLY_CAPPED' ? 'Hourly rate (ZMW)' : t('onboarding.price')}>
          <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" style={inputStyle} placeholder={model === 'HOURLY_CAPPED' ? '80' : '150'} />
          {model === 'HOURLY_CAPPED' && Number(price) > 0 && (
            <p className="t-small t-muted" style={{ marginTop: 4 }}>
              Customer sees your hourly rate with a protective spend cap. The exact cap is set on the backend and you can fine-tune it later.
            </p>
          )}
        </Field>
      )}
      <Field label={t('onboarding.availability')}>
        <div style={{ display: 'flex', gap: 6 }}>
          {DOW.map((d, i) => (
            <button
              key={i}
              onClick={() => toggleDay(i)}
              style={{
                width: 40, height: 40, borderRadius: 'var(--radius-full)', border: '1px solid var(--border)', fontWeight: 600,
                background: days.includes(i) ? 'var(--primary)' : 'var(--surface)',
                color: days.includes(i) ? '#fff' : 'var(--text-primary)',
              }}
            >
              {d}
            </button>
          ))}
        </div>
      </Field>
      <Button onClick={submit} loading={busy} disabled={!title || (needsPrice && !price)}>{t('common.continue')}</Button>
    </div>
  );
}

export function PayoutStep({ state, onDone }: StepProps) {
  const { t } = useTranslation();
  const [momo, setMomo] = useState(state.collected.momo_number ?? '');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    await onboardingApi.payout({ momo_number: momo || undefined });
    setBusy(false);
    onDone();
  };

  return (
    <div>
      <h2 className="t-h2">{t('onboarding.payoutTitle')}</h2>
      <p className="t-muted" style={{ marginBottom: 'var(--space-md)' }}>{t('onboarding.payoutSub')}</p>
      <Field label={t('onboarding.momoNumber')}>
        <input value={momo} onChange={(e) => setMomo(e.target.value)} inputMode="tel" style={inputStyle} placeholder="097 123 4567" />
      </Field>
      <Button onClick={submit} loading={busy}>{t('common.continue')}</Button>
    </div>
  );
}

export function GoLiveStep({ onDone }: StepProps) {
  const { t } = useTranslation();
  const [result, setResult] = useState<GoLiveResult | null>(null);

  useEffect(() => { onboardingApi.goLive().then(setResult).catch(() => {}); }, []);

  if (!result) return <div className="skeleton" style={{ height: 200 }} />;

  const category = result.tier_ladder.risk_label ?? 'more';

  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 56, marginBottom: 'var(--space-sm)' }}>{result.is_live ? '🎉' : '🚀'}</div>
      <h2 className="t-h2">{result.is_live ? t('onboarding.goLiveLive') : t('onboarding.goLiveSetup', { category })}</h2>
      <p className="t-muted" style={{ margin: 'var(--space-sm) 0 var(--space-lg)' }}>
        {result.is_live ? t('onboarding.goLiveLiveSub') : ''}
      </p>

      <div style={{ textAlign: 'left', marginBottom: 'var(--space-lg)' }}>
        <TierLadder data={result.tier_ladder} title={t('onboarding.tierLadder')} />
      </div>

      <Button onClick={onDone}>{result.is_live ? t('onboarding.done') : t('onboarding.addLater')}</Button>
    </div>
  );
}
