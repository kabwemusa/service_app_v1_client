import { useEffect, useState } from 'react';
import { SelectedLocation } from '../components/ui/LocationSearch';
import { useBookingStore } from '../store/bookingStore';
import { useSnackbar } from '../providers/SnackbarProvider';

export const HOUR_OPTIONS    = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
export const DURATION_OPTIONS = [1, 1.5, 2, 3, 4];

function next14Days(): Date[] {
  const days: Date[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = 1; i <= 14; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    days.push(d);
  }
  return days;
}

function pad(n: number) {
  return n.toString().padStart(2, '0');
}

export function useBookingFlow(serviceId: string) {
  const { createBooking, submitting, error, clearError } = useBookingStore();
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

  function reset(initialDay?: Date) {
    setSelectedDay(initialDay ?? days[0]);
    setStartHour(9);
    setDurationHrs(1);
    setDeliveryLocation(null);
  }

  async function submit() {
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
    handleLocationChange,
    submit,
    reset,
    submitting,
    canSubmit: !!deliveryLocation && !submitting,
    summaryLabel,
  };
}
