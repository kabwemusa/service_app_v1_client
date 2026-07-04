import { api } from './client';

// Thin mirror of mobile/src/api/location.ts against the SAME Laravel endpoints.
// The PWA does NOT geocode or compute distance itself — the backend's location
// service (Photon RegionResolver) is the single source. Coordinates travel
// internally; the UI only ever renders `label`.

export type LocationSource = 'DEVICE' | 'SEARCH' | 'SAVED';

/** A geocoded place candidate — forward search hit or reverse-geocode result. */
export interface PlaceCandidate {
  label:      string;
  place_name: string;
  region:     string | null;
  lat:        number;
  lng:        number;
}

export interface PrimaryLocation {
  lat:    number;
  lng:    number;
  label:  string;
  region: string | null;
  source: LocationSource;
}

export interface SavedLocation {
  id:         string;
  label:      string;
  place_name: string;
  region:     string | null;
  lat:        number;
  lng:        number;
  is_primary: boolean;
  created_at: string;
}

export interface SetPrimaryParams {
  lat:     number;
  lng:     number;
  label:   string;
  region?: string | null;
  source:  LocationSource;
}

export interface SaveLocationParams {
  label:       string;
  place_name:  string;
  lat:         number;
  lng:         number;
  region?:     string | null;
  is_primary?: boolean;
}

function qs(params: Record<string, unknown>): string {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) s.set(k, String(v));
  }
  const str = s.toString();
  return str ? `?${str}` : '';
}

export const locationApi = {
  /** Forward geocode / autocomplete. Device coords proximity-bias the results. */
  search: (q: string, bias?: { lat: number; lng: number } | null) =>
    api.get<PlaceCandidate[]>(`/location/search${qs({ q, lat: bias?.lat, lng: bias?.lng })}`),

  /** Device GPS coords → human label + region. */
  reverse: (lat: number, lng: number) =>
    api.post<PlaceCandidate>('/location/reverse', { lat, lng }),

  /** The signed-in user's primary location, or null if unset. */
  getPrimary: () => api.get<PrimaryLocation | null>('/me/location', true),

  /** Set/replace the primary location. */
  setPrimary: (params: SetPrimaryParams) =>
    api.put<PrimaryLocation>('/me/location', params, true),

  listSaved: () => api.get<SavedLocation[]>('/me/saved-locations', true),

  createSaved: (params: SaveLocationParams) =>
    api.post<SavedLocation>('/me/saved-locations', params, true),

  updateSaved: (id: string, params: Partial<SaveLocationParams>) =>
    api.put<SavedLocation>(`/me/saved-locations/${id}`, params, true),

  deleteSaved: (id: string) => api.delete<null>(`/me/saved-locations/${id}`, true),
};
