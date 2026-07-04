import Echo from 'laravel-echo'
import Pusher from 'pusher-js'
import type { ChannelAuthorizationData } from 'pusher-js/types/src/core/auth/options'
import { ADMIN_TOKEN_COOKIE } from '@/lib/auth/cookies'

declare global {
  interface Window {
    Pusher: typeof Pusher
  }
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

function getAdminToken(): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(new RegExp(`(?:^|; )${ADMIN_TOKEN_COOKIE}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

let echo: Echo<'reverb'> | null = null

/**
 * Singleton Echo/Reverb client for the admin console. Lazily created so it
 * never runs during SSR — call from a client component's `useEffect`.
 */
export function getEcho(): Echo<'reverb'> {
  if (echo) return echo

  if (typeof window !== 'undefined') {
    window.Pusher = Pusher
  }

  echo = new Echo({
    broadcaster: 'reverb',
    key: process.env.NEXT_PUBLIC_REVERB_APP_KEY,
    wsHost: process.env.NEXT_PUBLIC_REVERB_HOST ?? 'localhost',
    wsPort: Number(process.env.NEXT_PUBLIC_REVERB_PORT ?? 8080),
    wssPort: Number(process.env.NEXT_PUBLIC_REVERB_PORT ?? 8080),
    forceTLS: (process.env.NEXT_PUBLIC_REVERB_SCHEME ?? 'http') === 'https',
    enabledTransports: ['ws', 'wss'],
    // Admin auth is a JWT bearer token (cookie-readable, not session-based),
    // so the auth request needs its own Authorization header rather than
    // Echo's default cookie/credentials-based authorizer.
    authorizer: (channel: { name: string }) => ({
      authorize: (
        socketId: string,
        callback: (error: Error | null, data: ChannelAuthorizationData | null) => void,
      ) => {
        const token = getAdminToken()
        fetch(`${API_BASE}/api/admin/broadcasting/auth`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ socket_id: socketId, channel_name: channel.name }),
        })
          .then((res) => {
            if (!res.ok) throw new Error(`Broadcasting auth failed: HTTP ${res.status}`)
            return res.json()
          })
          .then((data: ChannelAuthorizationData) => callback(null, data))
          .catch((error: Error) => callback(error, null))
      },
    }),
  })

  return echo
}

export function disconnectEcho(): void {
  echo?.disconnect()
  echo = null
}
