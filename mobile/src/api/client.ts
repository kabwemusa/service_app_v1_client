import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { ApiError, ErrorCode } from "./errors";

/**
 * Resolve the backend base URL with zero daily configuration.
 *
 * In __DEV__ (Expo Go / dev build):
 *   Constants.expoConfig.hostUri is the Metro dev-server address, e.g.
 *   "192.168.1.50:8081". The backend always runs on the same machine on
 *   port 8000. We strip the port and substitute 8000 — works automatically
 *   on physical devices regardless of which IP the router assigns today.
 *
 * In production builds:
 *   Falls back to EXPO_PUBLIC_API_URL (set in mobile/.env before `eas build`).
 */
function resolveBaseUrl(): string {
  if (__DEV__) {
    const hostUri: string | undefined = Constants.expoConfig?.hostUri;
    if (hostUri) {
      // hostUri is "host:port" — take only the host part
      const host = hostUri.split(":")[0];
      if (host) return `http://${host}:8000/api`;
    }
  }
  // Production / fallback
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL;
  }
  return Platform.OS === "android"
    ? "http://10.0.2.2:8000/api"
    : "http://localhost:8000/api";
}

const BASE_URL = resolveBaseUrl();
// console.log(`API Base URL: ${BASE_URL}`);

/** Build a URL for a file stored on the backend's public disk.
 *  Uses the same host/port as the API so physical devices can reach it. */
export function storageUrl(path: string): string {
  return BASE_URL.replace(/\/api$/, "") + "/storage/" + path;
}

// These endpoints manage their own 401 responses — never trigger the refresh dance on them.
const PUBLIC_ENDPOINTS = [
  "/auth/login",
  "/auth/register",
  "/auth/verify-otp",
  "/auth/refresh",
  "/auth/resend-otp",
];

async function request<T>(
  endpoint: string,
  options: RequestInit & {
    params?: Record<string, any>;
    isFormData?: boolean;
  } = {}
): Promise<T> {
  const accessToken = await AsyncStorage.getItem("access_token");

  const { params, isFormData, ...fetchOptions } = options;

  // Append query string parameters if provided
  const url = params
    ? `${BASE_URL}${endpoint}?${new URLSearchParams(
        Object.fromEntries(
          Object.entries(params).filter(
            ([, v]) => v !== undefined && v !== null
          )
        )
      )}`
    : `${BASE_URL}${endpoint}`;

  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(fetchOptions.headers as Record<string, string>),
  };

  // For regular JSON requests set Content-Type. For FormData, omit it so
  // fetch can set the correct multipart boundary automatically.
  if (!isFormData) {
    headers["Content-Type"] = "application/json";
  }

  if (accessToken) {
    headers["Authorization"] = `Bearer ${accessToken}`;
  }

  let res: Response;

  try {
    res = await fetch(url, { ...fetchOptions, headers });
  } catch {
    throw new ApiError(
      "No internet connection. Please check your network.",
      "NETWORK_ERROR"
    );
  }

  // Session refresh dance — only for protected endpoints
  if (res.status === 401 && !PUBLIC_ENDPOINTS.includes(endpoint)) {
    const refreshed = await attemptTokenRefresh();
    if (refreshed) {
      return request<T>(endpoint, options);
    }
    await AsyncStorage.multiRemove(["access_token", "refresh_token"]);
    throw new ApiError(
      "Your session has expired. Please log in again.",
      "SESSION_EXPIRED",
      401
    );
  }

  let json: any;
  try {
    json = await res.json();
  } catch {
    throw new ApiError(
      "Unexpected server response.",
      "SERVER_ERROR",
      res.status
    );
  }

  if (!res.ok) {
    throw new ApiError(
      json.message ?? "Something went wrong.",
      (json.code as ErrorCode) ?? "SERVER_ERROR",
      res.status,
      json.errors ?? null
    );
  }

  return json.data as T;
}

async function attemptTokenRefresh(): Promise<boolean> {
  try {
    const refreshToken = await AsyncStorage.getItem("refresh_token");
    if (!refreshToken) return false;

    const res = await fetch(`${BASE_URL}/auth/refresh`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    if (!res.ok) return false;

    const json = await res.json();
    await AsyncStorage.multiSet([
      ["access_token", json.data.access_token],
      ["refresh_token", json.data.refresh_token],
    ]);
    return true;
  } catch {
    return false;
  }
}

export const api = {
  get: <T>(endpoint: string, opts?: { params?: Record<string, any> }) =>
    request<T>(endpoint, { method: "GET", params: opts?.params }),
  post: <T>(endpoint: string, body: unknown) =>
    request<T>(endpoint, { method: "POST", body: JSON.stringify(body) }),
  put: <T>(endpoint: string, body: unknown) =>
    request<T>(endpoint, { method: "PUT", body: JSON.stringify(body) }),
  patch: <T>(endpoint: string, body: unknown) =>
    request<T>(endpoint, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(endpoint: string) => request<T>(endpoint, { method: "DELETE" }),
  /** Multipart FormData upload — do NOT set Content-Type; fetch handles boundary. */
  upload: <T>(endpoint: string, body: FormData) =>
    request<T>(endpoint, {
      method: "POST",
      body: body as any,
      isFormData: true,
    }),
};
