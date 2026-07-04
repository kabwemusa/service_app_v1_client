// Port of the mobile useBookingFlow date/hour logic — identical rules so the web
// booking sheet offers exactly the same days, times, and availability behaviour.

export const HOUR_OPTIONS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];

type AvailMatrix = Record<string, { start: string; end: string }[]>;
const DAY_KEYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;

// Zambia is CAT (UTC+2). Derive "now in Zambia" so past hours grey out correctly
// regardless of the device timezone.
function zambiaHour(): number {
  const utcH = new Date().getUTCHours();
  const utcM = new Date().getUTCMinutes();
  return ((utcH + 2) % 24) + (utcM > 0 ? 1 : 0);
}

export function zambiaToday(): Date {
  const now = new Date();
  const z = new Date(now.getTime() + 2 * 60 * 60_000);
  return new Date(z.getUTCFullYear(), z.getUTCMonth(), z.getUTCDate());
}

export function next14Days(): Date[] {
  const days: Date[] = [];
  const today = zambiaToday();
  for (let i = 0; i <= 14; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    days.push(d);
  }
  return days;
}

export function isHourPast(hour: number, day: Date): boolean {
  const today = zambiaToday();
  if (day.getTime() > today.getTime()) return false;
  if (day.getTime() < today.getTime()) return true;
  return hour < zambiaHour();
}

export function isDayAvailable(day: Date, matrix: AvailMatrix | null | undefined): boolean {
  if (!matrix || Object.keys(matrix).length === 0) return true;
  const slots = matrix[DAY_KEYS[day.getDay()]];
  return Array.isArray(slots) && slots.length > 0;
}

export function isHourAvailable(hour: number, day: Date, matrix: AvailMatrix | null | undefined): boolean {
  if (!matrix || Object.keys(matrix).length === 0) return true;
  const slots = matrix[DAY_KEYS[day.getDay()]];
  if (!Array.isArray(slots) || slots.length === 0) return false;
  return slots.some((s) => {
    const startH = parseInt(s.start.split(':')[0], 10);
    const endH = parseInt(s.end.split(':')[0], 10);
    return hour >= startH && hour < endH;
  });
}

/** Today / Tomorrow, else weekday — plus the day-of-month. */
export function dayChipLabel(day: Date): { top: string; bottom: string } {
  const today = zambiaToday();
  const diff = Math.round((day.getTime() - today.getTime()) / 86_400_000);
  if (diff === 0) return { top: 'Today', bottom: `${day.getDate()}` };
  if (diff === 1) return { top: 'Tomorrow', bottom: `${day.getDate()}` };
  return { top: day.toLocaleDateString('en', { weekday: 'short' }), bottom: `${day.getDate()}` };
}

export const pad2 = (n: number) => n.toString().padStart(2, '0');
