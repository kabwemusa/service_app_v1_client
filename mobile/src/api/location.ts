import { api } from './client';

// ── Types ──────────────────────────────────────────────────────────────────

export type LocationSource = 'DEVICE' | 'SEARCH' | 'SAVED';

/** A geocoded place candidate — forward search hit or reverse-geocode result.
 *  `lat`/`lng` travel with it internally but the UI only ever renders `label`. */
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

// ── API calls ──────────────────────────────────────────────────────────────

export const locationApi = {
  /** GET /location/search?q=... — forward geocode / autocomplete (§4.3). */
  search: (q: string) =>
    api.get<PlaceCandidate[]>('/location/search', { params: { q } }),

  /** POST /location/reverse — device GPS coords → human label + region (§4.3). */
  reverse: (lat: number, lng: number) =>
    api.post<PlaceCandidate>('/location/reverse', { lat, lng }),

  /** GET /me/location — the signed-in user's primary location, or null if unset. */
  getPrimary: () => api.get<PrimaryLocation | null>('/me/location'),

  /** PUT /me/location — set/replace the primary location (§4.5-A onboarding). */
  setPrimary: (params: SetPrimaryParams) =>
    api.put<PrimaryLocation>('/me/location', params),

  /** GET /me/saved-locations — the address book (Home/Work/…), primary first. */
  listSaved: () => api.get<SavedLocation[]>('/me/saved-locations'),

  /** POST /me/saved-locations — add a place to the address book. */
  createSaved: (params: SaveLocationParams) =>
    api.post<SavedLocation>('/me/saved-locations', params),

  /** PUT /me/saved-locations/{id} — rename/relocate/promote a saved place. */
  updateSaved: (id: string, params: Partial<SaveLocationParams>) =>
    api.put<SavedLocation>(`/me/saved-locations/${id}`, params),

  /** DELETE /me/saved-locations/{id} — remove a place (primary cannot be removed directly). */
  deleteSaved: (id: string) => api.delete<null>(`/me/saved-locations/${id}`),
};
