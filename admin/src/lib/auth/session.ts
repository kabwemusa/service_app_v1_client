import { cookies } from 'next/headers'
import type { AdminTokenPayload } from '@/lib/api/types'
import { ADMIN_TOKEN_COOKIE, STEP_UP_COOKIE } from '@/lib/auth/cookies'

// Re-exported for backward compatibility with existing import paths.
export { ADMIN_TOKEN_COOKIE, STEP_UP_COOKIE }

// Called only in Server Components and Route Handlers (not edge middleware).
export async function getAdminSession(): Promise<AdminTokenPayload | null> {
  try {
    const store = await cookies()
    const token = store.get(ADMIN_TOKEN_COOKIE)?.value
    if (!token) return null
    return decodeToken(token)
  } catch {
    return null
  }
}

export async function getStepUpSession(): Promise<boolean> {
  try {
    const store = await cookies()
    const token = store.get(STEP_UP_COOKIE)?.value
    if (!token) return false
    const payload = decodeToken(token)
    return payload?.step_up === true
  } catch {
    return false
  }
}

// Decodes the JWT payload without verifying the signature.
// Signature verification is always done by the Laravel API.
export function decodeToken(token: string): AdminTokenPayload | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = parts[1]
    const decoded = JSON.parse(
      Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64url').toString('utf8'),
    )
    // Reject expired tokens early; the API does the authoritative check
    if (typeof decoded.exp === 'number' && decoded.exp < Math.floor(Date.now() / 1000)) {
      return null
    }
    return decoded as AdminTokenPayload
  } catch {
    return null
  }
}
