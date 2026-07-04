import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { availabilityApi, type AvailabilitySlot } from '../../api/availability';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { Button, Card, Spinner } from '../../components/ui/ui';

// Weekly availability + time off. The hours saved here are what make a
// provider dispatchable: the WhatsApp date-picker and the matching engine
// only offer times inside these windows.

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const DAY_NUMBERS = [1, 2, 3, 4, 5, 6, 0] as const;

const HOURS = Array.from({ length: 17 }, (_, i) => `${String(i + 6).padStart(2, '0')}:00`);

type DayWindow = { start: string; end: string };
type WeekState = Partial<Record<number, DayWindow>>;

function scheduleToWeek(slots: AvailabilitySlot[]): WeekState {
  const week: WeekState = {};
  for (const s of slots) {
    if (!week[s.day_of_week]) week[s.day_of_week] = { start: s.start_time, end: s.end_time };
  }
  return week;
}

function upcomingDates(): { date: string; label: string }[] {
  const out: { date: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 30; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    out.push({
      date: iso,
      label: d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }),
    });
  }
  return out;
}

const selectStyle: CSSProperties = {
  padding: '6px 8px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--text-primary)',
  font: 'inherit',
};

export function AvailabilityScreen() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [week, setWeek]       = useState<WeekState>({});
  const [blocked, setBlocked] = useState<string[]>([]);
  const [dirty, setDirty]     = useState(false);
  const [notice, setNotice]   = useState<string | null>(null);

  const dates = useMemo(upcomingDates, []);

  useEffect(() => {
    availabilityApi.get()
      .then(s => { setWeek(scheduleToWeek(s.schedule)); setBlocked(s.blocked_dates); })
      .catch(() => setNotice('Could not load your availability.'))
      .finally(() => setLoading(false));
  }, []);

  const toggleDay = (dow: number) => {
    setDirty(true);
    setWeek(prev => {
      if (prev[dow]) {
        const { [dow]: _removed, ...rest } = prev;
        return rest;
      }
      return { ...prev, [dow]: { start: '08:00', end: '17:00' } };
    });
  };

  const setTime = (dow: number, field: 'start' | 'end', value: string) => {
    setDirty(true);
    setWeek(prev => ({ ...prev, [dow]: { ...prev[dow]!, [field]: value } }));
  };

  const save = async () => {
    const slots: AvailabilitySlot[] = Object.entries(week).map(([dow, w]) => ({
      day_of_week: Number(dow),
      start_time: w!.start,
      end_time: w!.end,
    }));

    if (slots.some(s => s.start_time >= s.end_time)) {
      setNotice('Each day must end after it starts.');
      return;
    }

    setSaving(true);
    setNotice(null);
    try {
      const s = await availabilityApi.setSchedule(slots);
      setWeek(scheduleToWeek(s.schedule));
      setDirty(false);
      setNotice(slots.length > 0 ? 'Saved — customers can now book these hours.' : 'Cleared — you will not receive new bookings until you set hours.');
    } catch {
      setNotice('Could not save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const toggleBlocked = async (date: string) => {
    const isBlocked = blocked.includes(date);
    setBlocked(prev => (isBlocked ? prev.filter(d => d !== date) : [...prev, date]));
    try {
      const res = isBlocked ? await availabilityApi.unblockDate(date) : await availabilityApi.blockDate(date);
      setBlocked(res.blocked_dates);
    } catch {
      setBlocked(prev => (isBlocked ? [...prev, date] : prev.filter(d => d !== date)));
      setNotice('Could not update that date.');
    }
  };

  if (loading) {
    return <div style={{ display: 'grid', placeItems: 'center', height: '60vh' }}><Spinner /></div>;
  }

  return (
    <div>
      <ScreenHeader title="Availability" />
      <div style={{ padding: 'var(--space-md)', display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
        <Card>
          <p className="t-label" style={{ marginBottom: 4 }}>Weekly hours</p>
          <p className="t-small t-muted" style={{ marginBottom: 12 }}>
            Customers can only book the hours you set here — on WhatsApp and in the app.
          </p>

          {DAY_LABELS.map((label, i) => {
            const dow = DAY_NUMBERS[i];
            const w = week[dow];
            return (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, width: 72, cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!w} onChange={() => toggleDay(dow)} />
                  <span className="t-label">{label}</span>
                </label>
                {w && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <select value={w.start} onChange={e => setTime(dow, 'start', e.target.value)} style={selectStyle} aria-label={`${label} start time`}>
                      {HOURS.slice(0, -1).map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                    <span className="t-small t-muted">to</span>
                    <select value={w.end} onChange={e => setTime(dow, 'end', e.target.value)} style={selectStyle} aria-label={`${label} end time`}>
                      {HOURS.slice(1).map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </span>
                )}
              </div>
            );
          })}

          <div style={{ marginTop: 12 }}>
            <Button onClick={save} disabled={saving || !dirty}>
              {saving ? 'Saving…' : 'Save weekly hours'}
            </Button>
          </div>
        </Card>

        <Card>
          <p className="t-label" style={{ marginBottom: 4 }}>Time off</p>
          <p className="t-small t-muted" style={{ marginBottom: 12 }}>
            Tap a date to block it — you will not be offered jobs that day.
          </p>
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
            {dates.map(d => {
              const isBlocked = blocked.includes(d.date);
              return (
                <button
                  key={d.date}
                  onClick={() => toggleBlocked(d.date)}
                  style={{
                    flex: '0 0 auto',
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: `1px solid ${isBlocked ? 'var(--danger, #B91C1C)' : 'var(--border)'}`,
                    background: isBlocked ? 'var(--danger-light, #FEE2E2)' : 'var(--surface)',
                    color: isBlocked ? 'var(--danger, #B91C1C)' : 'var(--text-primary)',
                    font: 'inherit',
                    fontSize: 13,
                    cursor: 'pointer',
                  }}
                >
                  {d.label}{isBlocked ? ' · OFF' : ''}
                </button>
              );
            })}
          </div>
        </Card>

        {Object.keys(week).length === 0 && (
          <p className="t-small" style={{ color: 'var(--danger, #B91C1C)' }}>
            No working days set — you will not appear in searches or receive job offers.
          </p>
        )}

        {notice && <p className="t-small t-muted" role="status">{notice}</p>}
      </div>
    </div>
  );
}
