import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { servicesApi, type Service } from '../../api/services';
import { bookingsApi } from '../../api/bookings';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { api, storageUrl } from '../../api/client';
import { useLocationStore } from '../../store/locationStore';
import { categoryImage, categoryColor } from '../../theme/imagery';
import {
  HOUR_OPTIONS, next14Days, isHourPast, isDayAvailable, isHourAvailable, dayChipLabel, pad2,
} from './bookingFlow';
import './booking.css';

// Web twin of the mobile BookingSheet: When (day chips) · Start time (hour chips)
// · Where · Add extras · brief · live Total. Amounts shown come from the backend
// service; the buyer-protection line mirrors the app's preview (the booking
// record the backend returns is the source of truth for the final charge).

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

// Platform WhatsApp channel for free-form conversation (never the counterparty's
// number — anti-circumvention). Digits only; empty hides the button.
const WHATSAPP_NUMBER = (import.meta.env.VITE_WHATSAPP_NUMBER ?? '').replace(/[^0-9]/g, '');

export function BookingScreen() {
  const { serviceId = '' } = useParams();
  const location = useLocationStore((s) => s.location);
  const resolveDevice = useLocationStore((s) => s.resolveDevice);
  const hydrate = useLocationStore((s) => s.hydrate);

  const [svc, setSvc] = useState<Service | null>(null);
  const days = useMemo(() => next14Days(), []);
  const [selectedDay, setSelectedDay] = useState<Date>(days[0]);
  const [startHour, setStartHour] = useState(9);
  const [selectedAddons, setSelectedAddons] = useState<Set<number>>(new Set());
  const [briefAnswers, setBriefAnswers] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [address, setAddress] = useState('');
  const [editingLoc, setEditingLoc] = useState(false);
  const [bookedHours, setBookedHours] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<'FUNDED' | 'BRIEF_SENT' | 'REQUESTED' | null>(null);
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [agreementBusy, setAgreementBusy] = useState(false);
  const [agreementErr, setAgreementErr] = useState<string | null>(null);

  // Open the Booking Agreement PDF via a short-lived signed link. On the async
  // (PawaPay) path the document may still be generating when this screen shows —
  // surface a gentle "ready shortly" message rather than an error.
  async function openAgreement() {
    if (!bookingId || agreementBusy) return;
    setAgreementBusy(true);
    setAgreementErr(null);
    try {
      const { url } = await bookingsApi.agreementLink(bookingId);
      window.open(url, '_blank', 'noopener');
    } catch {
      setAgreementErr('Your agreement is being prepared — it will be ready in a moment. You can also find it under My Bookings.');
    } finally {
      setAgreementBusy(false);
    }
  }

  useEffect(() => { hydrate(); }, [hydrate]);
  useEffect(() => { if (location?.label && !address) setAddress(location.label); }, [location, address]);

  useEffect(() => {
    servicesApi.show(serviceId).then(setSvc).catch(() => {});
    servicesApi.bookedSlots(serviceId).then(({ slots }) => {
      const keys = new Set<string>();
      for (const slot of slots) {
        const cur = new Date(slot.start); cur.setMinutes(0, 0, 0);
        const end = new Date(slot.end);
        while (cur < end) { keys.add(`${cur.toDateString()}-${cur.getHours()}`); cur.setHours(cur.getHours() + 1); }
      }
      setBookedHours(keys);
    }).catch(() => {});
  }, [serviceId]);

  const avail = svc?.provider?.availability_matrix ?? null;
  const isDirect = svc?.payment_mode === 'DIRECT';
  const isQuote = svc?.pricing_model === 'PROVIDER_SCOPE' || svc?.pricing_model === 'QUOTE_DEPOSIT';
  const isCapped = svc?.pricing_model === 'HOURLY_CAPPED';

  const briefPrompts = useMemo(() => (isQuote ? (svc?.scope_prompts ?? []) : []), [isQuote, svc]);
  const hasStructuredBrief = briefPrompts.length > 0;

  const hourBooked = (h: number, d: Date) => bookedHours.has(`${d.toDateString()}-${h}`);
  const hourOk = (h: number, d: Date) => isHourAvailable(h, d, avail) && !isHourPast(h, d) && !hourBooked(h, d);
  const isDaySelectable = (d: Date) => isDayAvailable(d, avail) && HOUR_OPTIONS.some((h) => hourOk(h, d));

  // Land on the first bookable day + hour once the service (availability) loads.
  useEffect(() => {
    if (!svc) return;
    const firstDay = days.find(isDaySelectable) ?? days[0];
    setSelectedDay(firstDay);
    const firstHour = HOUR_OPTIONS.find((h) => hourOk(h, firstDay)) ?? 9;
    setStartHour(firstHour);
    setBriefAnswers(briefPrompts.map(() => ''));
  }, [svc, bookedHours]);

  // Keep the selected hour valid when the day changes.
  useEffect(() => {
    if (!hourOk(startHour, selectedDay)) {
      const h = HOUR_OPTIONS.find((x) => hourOk(x, selectedDay));
      if (h !== undefined) setStartHour(h);
    }
  }, [selectedDay, bookedHours]);

  // ── Totals (display) ──
  const svcCost = (isCapped ? (svc?.cap_amount ?? svc?.base_price) : svc?.base_price) ?? 0;
  const addonSum = (svc?.addons ?? []).filter((a) => selectedAddons.has(a.id)).reduce((s, a) => s + a.price, 0);
  const prot = !isDirect && !isQuote ? Math.min((svcCost + addonSum) * 0.02, 50) : 0;
  const total = svcCost + addonSum + prot;

  const briefComplete = !isQuote
    || (hasStructuredBrief
        ? briefPrompts.every((_, i) => (briefAnswers[i] ?? '').trim().length > 0)
        : (briefAnswers[0] ?? '').trim().length > 0);

  const durationLabel = svc?.duration_estimate_mins
    ? (svc.duration_estimate_mins >= 60
        ? `~${Math.round((svc.duration_estimate_mins / 60) * 10) / 10} hr`
        : `~${svc.duration_estimate_mins} min`)
    : null;

  const toggleAddon = (id: number) => setSelectedAddons((prev) => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
  });

  const submit = async () => {
    if (!svc) return;
    setBusy(true); setErr(null);
    try {
      let loc = location;
      if (!loc) loc = await resolveDevice();
      if (!loc) { setErr('We need your location to match a nearby provider. Tap “Use my location”.'); return; }

      const start = new Date(selectedDay); start.setHours(startHour, 0, 0, 0);
      const scopeBrief = isQuote
        ? (hasStructuredBrief
            ? briefPrompts.map((q, i) => ({ question: q, answer: (briefAnswers[i] ?? '').trim() }))
            : [{ question: 'Describe the job', answer: (briefAnswers[0] ?? '').trim() }])
        : undefined;

      const booking = await api.post<{ id: string }>('/bookings', {
        service_id: svc.id,
        scheduled_start: start.toISOString(),
        delivery_lat: loc.lat,
        delivery_lng: loc.lng,
        delivery_location_label: address || loc.label,
        delivery_location_region: loc.region,
        delivery_location_source: loc.source,
        ...(selectedAddons.size ? { addon_ids: Array.from(selectedAddons) } : {}),
        ...(isQuote && notes.trim() ? { notes: notes.trim() } : {}),
        ...(scopeBrief ? { scope_brief: scopeBrief } : {}),
      }, true);

      setBookingId(booking.id);
      if (isQuote) { setDone('BRIEF_SENT'); }
      else if (isDirect) { setDone('REQUESTED'); }
      else { await api.post(`/bookings/${booking.id}/pay`, {}, true).catch(() => {}); setDone('FUNDED'); }
    } catch (e) {
      setErr((e as { message?: string })?.message ?? 'Could not create the booking.');
    } finally {
      setBusy(false);
    }
  };

  const ctaLabel = isQuote ? 'Send brief · get quote'
    : isDirect ? 'Request booking'
    : `Pay K${total.toFixed(0)}`;

  if (!svc) return <><ScreenHeader title="Book" /><div className="bk" style={{ padding: 'var(--space-md)' }}><div className="skeleton" style={{ height: 260 }} /></div></>;

  const accent = categoryColor(svc.category?.id ?? 0);
  const thumb = svc.photos?.[0]?.path ? storageUrl(svc.photos[0].path) : categoryImage(svc.category?.name, svc.category?.id ?? 0, 200);

  if (done) {
    return (
      <div className="bk">
        <ScreenHeader title="Booking" />
        <div className="bk-done">
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-lg)' }}>
            <p className="t-h3" style={{ marginBottom: 8 }}>
              {done === 'BRIEF_SENT' ? 'Brief sent 📋' : done === 'REQUESTED' ? 'Request sent 📨' : 'Almost there 📲'}
            </p>
            <p className="t-small t-muted">
              {done === 'BRIEF_SENT'
                ? "The provider is reviewing your brief. We'll notify you when their quote is in — you approve it before any money moves."
                : done === 'REQUESTED'
                ? "The provider will confirm your request shortly. You'll pay them directly after the job — both of you mark it complete."
                : 'Check your phone and approve the Mobile Money prompt to pay. Your money is held safely until you confirm the job is done — track it under My Bookings.'}
            </p>

            {/* Booking Agreement (both parties get the same document) + WhatsApp */}
            {done === 'FUNDED' && bookingId && (
              <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {agreementErr && <p className="t-small t-muted">{agreementErr}</p>}
                <button
                  type="button"
                  onClick={openAgreement}
                  disabled={agreementBusy}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    padding: '10px 14px', borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--primary)', background: 'var(--primary)', color: '#fff',
                    fontWeight: 600, cursor: agreementBusy ? 'default' : 'pointer',
                  }}
                >
                  {agreementBusy ? 'Preparing…' : '⬇  Download Booking Agreement'}
                </button>
                {WHATSAPP_NUMBER && (
                  <a
                    href={`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(`Hi, I have a question about my booking (ref ${bookingId.slice(0, 8).toUpperCase()}).`)}`}
                    target="_blank" rel="noreferrer"
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                      padding: '10px 14px', borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border)', color: 'var(--text)', textDecoration: 'none', fontWeight: 600,
                    }}
                  >
                    💬  Message on WhatsApp
                  </a>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bk">
      <ScreenHeader title="Book" />

      {/* Summary header */}
      <div className="bk-header">
        <img className="bk-thumb" src={thumb} alt="" style={{ background: `color-mix(in srgb, ${accent} 15%, transparent)` }} />
        <div className="bk-header-body">
          <div className="bk-header-title">{svc.title}</div>
          <div className="bk-header-meta">
            {[svc.provider?.display_name, durationLabel].filter(Boolean).join('  ·  ') || 'Choose a time & place'}
          </div>
        </div>
      </div>

      <div className="bk-body">
        {/* When */}
        <p className="bk-label">When</p>
        <div className="bk-chip-row" role="radiogroup" aria-label="Choose a day">
          {days.map((day, i) => {
            const active = sameDay(day, selectedDay);
            const ok = isDaySelectable(day);
            const lbl = dayChipLabel(day);
            return (
              <button
                key={i}
                className={`bk-day-chip ${active ? 'bk-chip-sel' : ''} ${!ok ? 'bk-chip-off' : ''}`}
                onClick={() => ok && setSelectedDay(day)}
                disabled={!ok}
                aria-pressed={active}
              >
                <span className="bk-day-wkd">{lbl.top}</span>
                <span className="bk-day-num">{lbl.bottom}</span>
              </button>
            );
          })}
        </div>

        {/* Start time */}
        <p className="bk-label">Start time</p>
        <div className="bk-chip-row" role="radiogroup" aria-label="Choose a start time">
          {HOUR_OPTIONS.map((h) => {
            const active = h === startHour;
            const ok = hourOk(h, selectedDay);
            return (
              <button
                key={h}
                className={`bk-time-chip ${active ? 'bk-chip-sel' : ''} ${!ok ? 'bk-chip-off' : ''}`}
                onClick={() => ok && setStartHour(h)}
                disabled={!ok}
                aria-pressed={active}
              >
                {pad2(h)}:00
              </button>
            );
          })}
        </div>

        {durationLabel && !isCapped && (
          <div className="bk-duration"><span aria-hidden>⏱</span> Estimated duration: {durationLabel} — set by the provider as a guide.</div>
        )}

        {isCapped && (
          <div className="bk-cap">
            <div className="bk-cap-headline">
              K{(svc.hourly_rate ?? 0).toFixed(0)}/hr · you only pay for the time worked
            </div>
            <div className="bk-cap-note">
              The most you'd pay is K{svcCost.toFixed(0)}. You're charged only for the time actually worked.
            </div>
          </div>
        )}

        {/* Where */}
        <p className="bk-label">Where</p>
        <div className="bk-loc">
          <span aria-hidden>📍</span>
          <span className={`bk-loc-txt ${!location?.label && !address ? 'bk-loc-empty' : ''}`}>
            {address || location?.label || 'Add a delivery location'}
          </span>
          <button className="bk-loc-change" onClick={() => { resolveDevice(); setEditingLoc(true); }}>
            {location?.label || address ? 'Change' : 'Add'}
          </button>
        </div>
        {(editingLoc || (!location?.label && !address)) && (
          <input
            className="bk-loc-input"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Area / landmark"
            aria-label="Delivery address"
          />
        )}

        {/* Add extras */}
        {(svc.addons?.length ?? 0) > 0 && (
          <>
            <p className="bk-label">Add extras</p>
            <div className="bk-addons">
              {svc.addons.map((a) => {
                const on = selectedAddons.has(a.id);
                return (
                  <div key={a.id} className="bk-addon" onClick={() => toggleAddon(a.id)} role="checkbox" aria-checked={on}>
                    <span className={`bk-check ${on ? 'bk-check-on' : ''}`}>{on ? '✓' : ''}</span>
                    <span className="bk-addon-name">{a.name}</span>
                    <span className="bk-addon-price">+ K{a.price.toFixed(0)}</span>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* Structured brief (quote-first) */}
        {isQuote && (
          <>
            <p className="bk-label">Tell the provider about the job</p>
            {(hasStructuredBrief ? briefPrompts : ['Describe the job']).map((q, i) => (
              <div key={i} className="bk-brief">
                <div className="bk-brief-q">{q}</div>
                <input
                  className="bk-input"
                  value={briefAnswers[i] ?? ''}
                  onChange={(e) => setBriefAnswers((prev) => { const n = [...prev]; n[i] = e.target.value; return n; })}
                  placeholder="Your answer…"
                />
              </div>
            ))}
            <p className="bk-label">Anything else? (optional)</p>
            <textarea className="bk-textarea" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Extra details for the provider…" />
          </>
        )}

        {/* Total */}
        <div className="bk-total">
          {isQuote ? (
            <div className="bk-quote-note">
              <span aria-hidden>💬</span>
              <span>
                {svc.pricing_model === 'QUOTE_DEPOSIT'
                  ? `${svc.provider?.display_name ?? 'The provider'} will send a full quote after reviewing your brief.${svc.deposit_percent != null ? ` A ${svc.deposit_percent}% deposit confirms the booking — the balance is collected on completion.` : ''} Nothing is charged until you approve the quote.`
                  : `${svc.provider?.display_name ?? 'The provider'} will review your brief and send a quote with the price, duration and what's included. Nothing is charged until you approve it.`}
              </span>
            </div>
          ) : (
            <>
              <div className="bk-fee-row">
                <span className="bk-fee-lbl">{isCapped ? 'Cost (up to)' : 'Service'}</span>
                <span className="bk-fee-amt">K{svcCost.toFixed(0)}</span>
              </div>
              {(svc.addons ?? []).filter((a) => selectedAddons.has(a.id)).map((a) => (
                <div key={a.id} className="bk-fee-row">
                  <span className="bk-fee-lbl">{a.name}</span>
                  <span className="bk-fee-amt">K{a.price.toFixed(0)}</span>
                </div>
              ))}
              {!isDirect && (
                <div className="bk-fee-row">
                  <span className="bk-fee-lbl">Buyer protection (2%)</span>
                  <span className="bk-fee-amt">K{prot.toFixed(0)}</span>
                </div>
              )}
              <div className="bk-fee-divider" />
              <div className="bk-fee-row">
                <span className="bk-total-lbl">{isDirect ? 'Agreed price' : 'Total'}</span>
                <span className="bk-total-amt">K{total.toFixed(0)}</span>
              </div>
            </>
          )}

          <div className="bk-mode">
            <span aria-hidden>{isDirect ? '💵' : '🔒'}</span>
            <span>
              {isDirect
                ? `You'll pay ${svc.provider?.display_name ?? 'the provider'} directly after the job · they'll confirm your request.`
                : isCapped
                ? "You pay only for the time worked. Your payment is held safely until you confirm the job's done."
                : isQuote
                ? "Once you approve the quote, your payment is held safely and released only when you confirm the job's done."
                : "Your payment is held safely by our licensed partner — released to the provider only when you confirm the job's done."}
            </span>
          </div>

          {err && <div className="bk-mode" style={{ background: 'var(--warning-light)', color: 'var(--text-primary)' }}>{err}</div>}

          <button className="bk-cta" onClick={submit} disabled={busy || !briefComplete}>
            {busy ? 'Working…' : ctaLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
