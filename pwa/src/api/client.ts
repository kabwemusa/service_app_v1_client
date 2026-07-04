// Minimal fetch wrapper with JWT access/refresh rotation, mirroring the mobile
// app's api/client.ts contract against the same Laravel API. Tokens live in
// localStorage so a returning user resumes silently (OTP only on a new device).

const ACCESS_KEY = 'access_token';
const REFRESH_KEY = 'refresh_token';

export interface ApiError {
  message: string;
  code: string;
  status: number;
  errors?: Record<string, string[]>;
}

export const tokens = {
  get access() { return localStorage.getItem(ACCESS_KEY); },
  get refresh() { return localStorage.getItem(REFRESH_KEY); },
  set(access: string, refresh: string) {
    localStorage.setItem(ACCESS_KEY, access);
    localStorage.setItem(REFRESH_KEY, refresh);
  },
  clear() {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

/** Resolve a backend storage path (e.g. "service_photos/x.jpg") to a URL.
 *  Same-origin `/storage/…` — proxied to the backend in dev, served alongside
 *  the app in prod. Absolute URLs pass through untouched. */
export function storageUrl(path: string): string {
  if (!path) return '';
  if (/^https?:\/\//.test(path)) return path;
  return `/storage/${path.replace(/^\/+/, '')}`;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  auth?: boolean;
  /** Set for multipart (FormData) bodies — Content-Type is left to the browser. */
  form?: boolean;
}

async function raw<T>(path: string, opts: RequestOptions, retrying = false): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.auth && tokens.access) headers.Authorization = `Bearer ${tokens.access}`;

  let body: BodyInit | undefined;
  if (opts.body !== undefined) {
    if (opts.form) {
      body = opts.body as FormData;
    } else {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }
  }

  const res = await fetch(`/api${path}`, { method: opts.method ?? 'GET', headers, body });

  // Try a one-shot refresh on a 401 for authed calls.
  if (res.status === 401 && opts.auth && !retrying && tokens.refresh) {
    const refreshed = await tryRefresh();
    if (refreshed) return raw<T>(path, opts, true);
  }

  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    const err: ApiError = {
      message: json.message ?? 'Something went wrong.',
      code: json.code ?? 'SERVER_ERROR',
      status: res.status,
      errors: json.errors,
    };
    throw err;
  }

  return (json.data ?? json) as T;
}

let refreshing: Promise<boolean> | null = null;
function tryRefresh(): Promise<boolean> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ refresh_token: tokens.refresh }),
      });
      if (!res.ok) { tokens.clear(); return false; }
      const json = await res.json();
      tokens.set(json.data.access_token, json.data.refresh_token);
      return true;
    } catch {
      tokens.clear();
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export const api = {
  get: <T>(path: string, auth = false) => raw<T>(path, { method: 'GET', auth }),
  post: <T>(path: string, body?: unknown, auth = false) => raw<T>(path, { method: 'POST', body, auth }),
  put: <T>(path: string, body?: unknown, auth = false) => raw<T>(path, { method: 'PUT', body, auth }),
  patch: <T>(path: string, body?: unknown, auth = false) => raw<T>(path, { method: 'PATCH', body, auth }),
  postForm: <T>(path: string, form: FormData, auth = true) => raw<T>(path, { method: 'POST', body: form, auth, form: true }),
  delete: <T>(path: string, auth = false) => raw<T>(path, { method: 'DELETE', auth }),
};
