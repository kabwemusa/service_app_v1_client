import { useEffect, useState } from 'react';
import { SelectedLocation } from '../components/ui/LocationSearch';
import { useBookingStore } from '../store/bookingStore';
import { useLocationStore } from '../store/locationStore';
import { useSnackbar } from '../providers/SnackbarProvider';

export const HOUR_OPTIONS    = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
export const DURATION_OPTIONS = [1, 1.5, 2, 3, 4];

// Zambia is CAT (Central Africa Time) = UTC+2. We derive "now in Zambia" so
// past hours are greyed out correctly regardless of the device's local timezone.
function zambiaHour(): number {
  const utcH = new Date().getUTCHours();
  const utcM = new Date().getUTCMinutes();
  return ((utcH + 2) % 24) + (utcM > 0 ? 1 : 0); // round up — a partially-elapsed hour is past
}

function zambiaToday(): Date {
  const now = new Date();
  // Shift to UTC+2 for date boundary
  const zambiaNow = new Date(now.getTime() + 2 * 60 * 60_000);
  const d = new Date(zambiaNow.getUTCFullYear(), zambiaNow.getUTCMonth(), zambiaNow.getUTCDate());
  return d;
}

function next14Days(): Date[] {
  const days: Date[] = [];
  const today = zambiaToday();
  for (let i = 0; i <= 14; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    days.push(d);
  }
  return days;
}

/** True if the given hour has already passed on the given day (Zambia time). */
export function isHourPast(hour: number, day: Date): boolean {
  const today = zambiaToday();
  if (day.getTime() > today.getTime()) return false;
  if (day.getTime() < today.getTime()) return true;
  return hour < zambiaHour();
}

function pad(n: number) {
  return n.toString().padStart(2, '0');
}

export function useBookingFlow(serviceId: string) {
  const { createBooking, submitting, error, clearError } = useBookingStore();
  // The active delivery location (§4) — prefilled so the sheet opens ready to send.
  const activeDelivery = useLocationStore((s) => s.deliveryLocation);
  const { showError } = useSnackbar();

  // Stable across re-renders — computed once on mount so Date objects don't
  // change identity every render (which would break memo deps in BookingSheet).
  const [days] = useState(() => next14Days());
  const [selectedDay,      setSelectedDay]      = useState<Date>(days[0]);
  const [startHour,        setStartHour]        = useState(9);
  const [durationHrs,      setDurationHrs]      = useState(1);
  const [deliveryLocation, setDeliveryLocation] = useState<SelectedLocation | null>(null);

  useEffect(() => {
    if (error) {
      showError(error.message);
      clearError();
    }
  }, [error]);

  function handleLocationChange(loc: SelectedLocation | null) {
    setDeliveryLocation(loc);
  }

  // Map the store's active DeliveryLocation onto the SelectedLocation shape the
  // flow uses. SAVED source is treated as SEARCH for the booking payload.
  function activeAsSelected(): SelectedLocation | null {
    if (!activeDelivery) return null;
    return {
      label:  activeDelivery.label,
      lat:    activeDelivery.lat,
      lng:    activeDelivery.lng,
      region: activeDelivery.region,
      source: activeDelivery.source === 'DEVICE' ? 'DEVICE' : 'SEARCH',
    };
  }

  function reset(initialDay?: Date) {
    const day = initialDay ?? days[0];
    setSelectedDay(day);
    // Pick the first future hour on the selected day; default to 9 if all are valid.
    const firstValid = HOUR_OPTIONS.find((h) => !isHourPast(h, day)) ?? HOUR_OPTIONS[0];
    setStartHour(firstValid >= 9 && !isHourPast(9, day) ? 9 : firstValid);
    setDurationHrs(1);
    setDeliveryLocation(activeAsSelected());
  }

  async function submit(addonIds: number[] = [], notes?: string) {
    if (!deliveryLocation) {
      showError('Please set a delivery location.');
      return null;
    }
    const start = new Date(selectedDay);
    start.setHours(startHour, 0, 0, 0);
    const end = new Date(start);
    end.setMinutes(end.getMinutes() + Math.round(durationHrs * 60));
    try {
      return await createBooking({
        service_id:                serviceId,
        scheduled_start:           start.toISOString(),
        scheduled_end:             end.toISOString(),
        delivery_lat:              deliveryLocation.lat,
        delivery_lng:              deliveryLocation.lng,
        delivery_location_label:   deliveryLocation.label,
        delivery_location_region:  deliveryLocation.region,
        delivery_location_source:  deliveryLocation.source,
        ...(addonIds.length ? { addon_ids: addonIds } : {}),
        ...(notes && notes.trim() ? { notes: notes.trim() } : {}),
      });
    } catch {
      return null;
    }
  }

  const endHour = startHour + durationHrs;
  const summaryLabel = `${selectedDay.toLocaleDateString('en', {
    weekday: 'short', day: 'numeric', month: 'short',
  })}  ·  ${pad(startHour)}:00 – ${pad(Math.floor(endHour))}:${endHour % 1 ? '30' : '00'}`;

  return {
    days,
    selectedDay,     setSelectedDay,
    startHour,       setStartHour,
    durationHrs,     setDurationHrs,
    deliveryLocation,
    setDeliveryLocation,
    handleLocationChange,
    submit,
    reset,
    submitting,
    canSubmit: !!deliveryLocation && !submitting,
    summaryLabel,
  };
}
