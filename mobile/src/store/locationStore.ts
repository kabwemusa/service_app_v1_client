import { create } from 'zustand';
import { ApiError } from '../api/errors';
import {
  locationApi,
  LocationSource,
  PlaceCandidate,
  PrimaryLocation,
  SaveLocationParams,
  SavedLocation,
  SetPrimaryParams,
} from '../api/location';

function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  return new ApiError((e as any)?.message ?? 'Something went wrong.', 'SERVER_ERROR');
}

/** The location discovery & booking requests are anchored to this session —
 *  defaults to the user's primary location, switchable without persisting (§4.5-B). */
export interface DeliveryLocation {
  lat:    number;
  lng:    number;
  label:  string;
  region: string | null;
  source: LocationSource;
}

export function toDeliveryLocation(p: PrimaryLocation): DeliveryLocation {
  return { lat: p.lat, lng: p.lng, label: p.label, region: p.region, source: p.source };
}

export function candidateToDeliveryLocation(c: PlaceCandidate, source: LocationSource): DeliveryLocation {
  return { lat: c.lat, lng: c.lng, label: c.label, region: c.region, source };
}

export function savedToDeliveryLocation(s: SavedLocation): DeliveryLocation {
  return { lat: s.lat, lng: s.lng, label: s.label, region: s.region, source: 'SAVED' };
}

interface LocationState {
  primary:          PrimaryLocation | null;
  /** null while we're still asking the server; true/false once we have an answer (§4.5-A gate). */
  onboardingNeeded: boolean | null;
  saved:            SavedLocation[];
  savedLoaded:      boolean;
  activeDelivery:   DeliveryLocation | null;
  loading:          boolean;
  savedLoading:     boolean;
  error:            ApiError | null;

  fetchPrimary:      () => Promise<void>;
  setPrimary:        (params: SetPrimaryParams) => Promise<boolean>;
  fetchSaved:        () => Promise<void>;
  createSaved:       (params: SaveLocationParams) => Promise<SavedLocation | null>;
  updateSaved:       (id: string, params: Partial<SaveLocationParams>) => Promise<boolean>;
  deleteSaved:       (id: string) => Promise<boolean>;
  setActiveDelivery: (loc: DeliveryLocation) => void;
  clearError:        () => void;
  reset:             () => void;
}

const initialState = {
  primary:          null as PrimaryLocation | null,
  onboardingNeeded: null as boolean | null,
  saved:            [] as SavedLocation[],
  savedLoaded:      false,
  activeDelivery:   null as DeliveryLocation | null,
  loading:          false,
  savedLoading:     false,
  error:            null as ApiError | null,
};

export const useLocationStore = create<LocationState>((set, get) => ({
  ...initialState,

  clearError: () => set({ error: null }),
  reset: () => set(initialState),

  fetchPrimary: async () => {
    set({ loading: true, error: null });
    try {
      const primary = await locationApi.getPrimary();
      set((s) => ({
        primary,
        onboardingNeeded: primary === null,
        activeDelivery: s.activeDelivery ?? (primary ? toDeliveryLocation(primary) : null),
      }));
    } catch (e) {
      // Fail open — a transient network error must never trap the user in onboarding.
      set({ error: toApiError(e), onboardingNeeded: false });
    } finally {
      set({ loading: false });
    }
  },

  setPrimary: async (params) => {
    set({ loading: true, error: null });
    try {
      const primary = await locationApi.setPrimary(params);
      set((s) => ({
        primary,
        onboardingNeeded: false,
        activeDelivery: s.activeDelivery ?? toDeliveryLocation(primary),
      }));
      return true;
    } catch (e) {
      set({ error: toApiError(e) });
      return false;
    } finally {
      set({ loading: false });
    }
  },

  fetchSaved: async () => {
    set({ savedLoading: true, error: null });
    try {
      const saved = await locationApi.listSaved();
      set({ saved, savedLoaded: true });
    } catch (e) {
      set({ error: toApiError(e) });
    } finally {
      set({ savedLoading: false });
    }
  },

  createSaved: async (params) => {
    set({ error: null });
    try {
      const location = await locationApi.createSaved(params);
      await get().fetchSaved();
      if (params.is_primary) await get().fetchPrimary();
      return location;
    } catch (e) {
      set({ error: toApiError(e) });
      return null;
    }
  },

  updateSaved: async (id, params) => {
    set({ error: null });
    try {
      await locationApi.updateSaved(id, params);
      await get().fetchSaved();
      if (params.is_primary) await get().fetchPrimary();
      return true;
    } catch (e) {
      set({ error: toApiError(e) });
      return false;
    }
  },

  deleteSaved: async (id) => {
    set({ error: null });
    try {
      await locationApi.deleteSaved(id);
      await get().fetchSaved();
      return true;
    } catch (e) {
      set({ error: toApiError(e) });
      return false;
    }
  },

  setActiveDelivery: (loc) => set({ activeDelivery: loc }),
}));
