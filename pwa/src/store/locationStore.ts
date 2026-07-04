import { create } from 'zustand';
import { locationApi, type LocationSource, type PrimaryLocation } from '../api/location';
import { tokens } from '../api/client';

// One location layer, backed by the SAME backend geocoder the app uses. The PWA
// never derives a label or region itself — it reverse-geocodes the device pin
// via /location/reverse and, when signed in, persists the primary via
// /me/location. Coordinates travel internally; the UI renders `label` only.

export interface DeliveryLocation {
  lat:    number;
  lng:    number;
  label:  string;
  region: string | null;
  source: LocationSource;
}

const STORE_KEY = 'delivery_location';

function load(): DeliveryLocation | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as DeliveryLocation) : null;
  } catch {
    return null;
  }
}

function persist(loc: DeliveryLocation | null) {
  if (loc) localStorage.setItem(STORE_KEY, JSON.stringify(loc));
  else localStorage.removeItem(STORE_KEY);
}

function devicePosition(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { timeout: 8000, enableHighAccuracy: true },
    );
  });
}

interface LocationState {
  location: DeliveryLocation | null;
  loading:  boolean;
  hydrate:  () => void;
  /** Read GPS → reverse-geocode via backend → set (and persist to primary if signed in). */
  resolveDevice: () => Promise<DeliveryLocation | null>;
  /** Pull the signed-in user's saved primary from the backend. */
  fetchPrimary:  () => Promise<void>;
  setLocation:   (loc: DeliveryLocation) => void;
}

export const useLocationStore = create<LocationState>((set, get) => ({
  location: load(),
  loading:  false,

  hydrate: () => set({ location: load() }),

  setLocation: (loc) => { persist(loc); set({ location: loc }); },

  resolveDevice: async () => {
    set({ loading: true });
    try {
      const pos = await devicePosition();
      if (!pos) return null;
      // Backend turns coords into a human label + region (never done client-side).
      const place = await locationApi.reverse(pos.lat, pos.lng);
      const loc: DeliveryLocation = {
        lat: place.lat, lng: place.lng, label: place.label, region: place.region, source: 'DEVICE',
      };
      get().setLocation(loc);
      // If signed in, make it the account's primary so app + web agree.
      if (tokens.access) {
        await locationApi.setPrimary({ lat: loc.lat, lng: loc.lng, label: loc.label, region: loc.region, source: 'DEVICE' }).catch(() => {});
      }
      return loc;
    } catch {
      return null;
    } finally {
      set({ loading: false });
    }
  },

  fetchPrimary: async () => {
    if (!tokens.access) return;
    try {
      const primary: PrimaryLocation | null = await locationApi.getPrimary();
      if (primary) {
        const loc: DeliveryLocation = {
          lat: primary.lat, lng: primary.lng, label: primary.label, region: primary.region, source: primary.source,
        };
        get().setLocation(loc);
      }
    } catch {
      /* leave existing local location in place */
    }
  },
}));
