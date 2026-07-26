import AsyncStorage from "@react-native-async-storage/async-storage";
import Echo from "laravel-echo";
import * as PusherModule from "pusher-js";
import { apiOrigin } from "../api/client";

// pusher-js's React Native build (resolved via its "react-native" package.json
// field) exports the class as `module.exports.Pusher`, NOT a default export —
// unlike the web/node builds its own type defs describe. A plain
// `import Pusher from "pusher-js"` gets CJS-interop-wrapped into an object
// (no `__esModule` marker on that build), so `new Pusher(...)` throws
// "constructor is not callable". Pulling `.Pusher` off the namespace import
// works across whichever interop shape Metro produces; `.default` covers the
// web/node builds if this ever runs outside RN.
const Pusher: any = (PusherModule as any).Pusher ?? (PusherModule as any).default ?? PusherModule;

// laravel-echo's reverb/pusher connector expects a global Pusher constructor.
(global as any).Pusher = Pusher;

// Verbose WebSocket handshake/auth logs in dev — shows connect, auth POST,
// subscription success/failure right in the Metro console.
if (__DEV__) {
  Pusher.logToConsole = true;
}

/**
 * Reverb (Laravel's first-party WebSocket server) client for the app.
 *
 * Reverb speaks the Pusher protocol, so laravel-echo + pusher-js talk to it
 * directly — the SAME code runs in dev and production; only the env vars change
 * (dev: ws to the LAN host on :8080; prod: wss to your deployed Reverb host).
 *
 * Config priority for the WS host:
 *  1. EXPO_PUBLIC_REVERB_HOST — explicit override (prod / tunnels).
 *  2. Otherwise reuse the API host, so a physical device that can already reach
 *     the backend reaches Reverb on the same machine (port 8080 by default).
 *
 * Private channels authorize through POST /api/broadcasting/auth (auth:api),
 * so we inject the caller's JWT Bearer token via a custom authorizer.
 */
function reverbHost(): string {
  const explicit = process.env.EXPO_PUBLIC_REVERB_HOST;
  if (explicit) return explicit;
  const m = apiOrigin().match(/^https?:\/\/([^:/]+)/);
  return m?.[1] ?? "localhost";
}

let echo: Echo<any> | null = null;

export function getEcho(): Echo<any> | null {
  return echo;
}

/** Create (once) and return the Echo instance. Idempotent. */
export function connectEcho(): Echo<any> {
  if (echo) return echo;

  const key    = process.env.EXPO_PUBLIC_REVERB_KEY ?? "";
  const port   = Number(process.env.EXPO_PUBLIC_REVERB_PORT ?? 8080);
  const scheme = process.env.EXPO_PUBLIC_REVERB_SCHEME ?? "http";
  const forceTLS = scheme === "https";
  const host = reverbHost();
  const authUrl = `${apiOrigin()}/api/broadcasting/auth`;

  console.log("[realtime] connecting Reverb", {
    wsHost: host, wsPort: port, scheme, forceTLS,
    keyPresent: key !== "", authUrl,
  });

  echo = new Echo({
    broadcaster: "reverb",
    key,
    wsHost: host,
    wsPort: port,
    wssPort: port,
    forceTLS,
    enabledTransports: ["ws", "wss"],
    // Reverb isn't Pusher's cloud — never phone home to stats.pusher.com.
    disableStats: true,
    // Custom authorizer so we can attach the JWT Bearer token the /api guard needs.
    authorizer: (channel: any) => ({
      authorize: async (socketId: string, callback: Function) => {
        try {
          const token = await AsyncStorage.getItem("access_token");
          const res = await fetch(authUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({
              socket_id: socketId,
              channel_name: channel.name,
            }),
          });
          if (!res.ok) {
            const body = await res.text().catch(() => "");
            console.warn(`[realtime] channel auth FAILED ${res.status} for ${channel.name}`, body);
            callback(new Error(`Broadcast auth failed (${res.status})`), null);
            return;
          }
          console.log(`[realtime] channel auth OK for ${channel.name}`);
          callback(null, await res.json());
        } catch (e) {
          console.warn("[realtime] channel auth error", e);
          callback(e as Error, null);
        }
      },
    }),
  });

  // Surface connection lifecycle so failures are obvious in the Metro console.
  const conn = (echo.connector as any)?.pusher?.connection;
  conn?.bind("state_change", (s: any) =>
    console.log(`[realtime] state: ${s?.previous} -> ${s?.current}`),
  );
  conn?.bind("error", (err: any) =>
    console.warn("[realtime] connection error", JSON.stringify(err)),
  );

  return echo;
}

/** Tear down the connection (call on logout). */
export function disconnectEcho(): void {
  try {
    echo?.disconnect();
  } catch {
    // best-effort
  }
  echo = null;
}

/** Underlying pusher-js connection, for binding connection-state events. */
export function pusherConnection(): any {
  return (echo?.connector as any)?.pusher?.connection ?? null;
}
