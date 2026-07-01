import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';
import { locationApi, PlaceCandidate } from '../api/location';

// ── Tuning constants ─────────────────────────────────────────────────────────

/** Minimum wall-clock time before we resolve — prevents returning a stale
 *  cell-tower/Wi-Fi fix that the OS had cached before GPS locks on. */
const PRECISION_BUFFER_MS = 1750;

/** Target GPS horizontal accuracy radius. Below this → reading is "good". */
const MAX_ACCURACY_M = 15;

/** How long to wait between re-polls when accuracy is still above threshold. */
const POLL_INTERVAL_MS = 400;

/** Absolute upper bound. Use best reading so far as a failover after this. */
const HARD_TIMEOUT_MS = 10_000;

// ─────────────────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/** Accept a last-known fix up to 5 minutes old as a search bias. */
const BIAS_MAX_AGE_MS = 5 * 60 * 1000;

/**
 * Cheap, prompt-free device-coordinate hint for forward-search relevance.
 *
 * Returns the OS's last-known position ONLY when location permission is already
 * granted — it never triggers a permission prompt (uses getForegroundPermissions,
 * not requestForegroundPermissions) and never spins up the GPS chip. Null when
 * unavailable, in which case the backend biases to its configured centre.
 *
 * This is a relevance hint only: the coordinate is never shown and never stored.
 */
export async function getSearchBias(): Promise<{ lat: number; lng: number } | null> {
  try {
    const { granted } = await Location.getForegroundPermissionsAsync();
    if (!granted) return null;

    const pos = await Location.getLastKnownPositionAsync({ maxAge: BIAS_MAX_AGE_MS });
    if (!pos) return null;

    return { lat: pos.coords.latitude, lng: pos.coords.longitude };
  } catch {
    return null;
  }
}

export interface HighAccuracyLocationState {
  loading: boolean;
  error:   string | null;
  /** Call to trigger a high-accuracy GPS capture. Returns a resolved
   *  PlaceCandidate (label + region, no raw coords in UI) or null on failure. */
  capture: () => Promise<PlaceCandidate | null>;
}

/**
 * Fused-location hook that enforces a precision buffer before resolving.
 *
 * The buffer prevents the common failure mode where the OS immediately returns
 * a cached low-accuracy cell-tower fix before the GPS chip has a chance to
 * refine the position. The hook polls until the accuracy radius drops below
 * MAX_ACCURACY_M *and* the minimum buffer has elapsed, then reverse-geocodes
 * through the backend to get a landmark-aware label (never raw coordinates).
 */
export function useHighAccuracyLocation(): HighAccuracyLocationState {
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const capture = useCallback(async (): Promise<PlaceCandidate | null> => {
    if (!mounted.current) return null;
    setLoading(true);
    setError(null);

    try {
      const { granted } = await Location.requestForegroundPermissionsAsync();
      if (!granted) {
        if (mounted.current) {
          setError('Location permission denied. Try searching for a place instead.');
        }
        return null;
      }

      const startTime = Date.now();
      // Start the minimum-wait timer in parallel so it runs concurrently with
      // the GPS polling loop rather than being added on top of it.
      const bufferDone = sleep(PRECISION_BUFFER_MS);

      let best: Location.LocationObject | null = null;

      while (true) {
        if (!mounted.current) return null;

        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Highest,
        });

        // Always keep the most accurate reading we have seen
        if (!best || (pos.coords.accuracy ?? Infinity) < (best.coords.accuracy ?? Infinity)) {
          best = pos;
        }

        const elapsed  = Date.now() - startTime;
        const accurate = (pos.coords.accuracy ?? Infinity) < MAX_ACCURACY_M;
        const buffered = elapsed >= PRECISION_BUFFER_MS;
        const timedOut = elapsed >= HARD_TIMEOUT_MS;

        if ((accurate && buffered) || timedOut) break;

        // Wait before re-polling only if there's still time budget remaining
        if (elapsed < HARD_TIMEOUT_MS - POLL_INTERVAL_MS) {
          await sleep(POLL_INTERVAL_MS);
        } else {
          break;
        }
      }

      // Guarantee the precision buffer is always honoured even when GPS
      // resolved on the very first poll (e.g. warm cache on a stationary device)
      await bufferDone;

      if (!best || !mounted.current) return null;

      const candidate = await locationApi.reverse(
        best.coords.latitude,
        best.coords.longitude,
      );
      return candidate;
    } catch {
      if (mounted.current) {
        setError('Could not determine your location. Try searching for a place instead.');
      }
      return null;
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  return { loading, error, capture };
}
