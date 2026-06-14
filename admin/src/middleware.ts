import { type NextRequest, NextResponse } from 'next/server'
import { ADMIN_TOKEN_COOKIE } from '@/lib/auth/cookies'
import { ROUTE_CAPABILITY } from '@/lib/rbac/permissions'
import type { AdminTokenPayload, Capability } from '@/lib/api/types'

// Edge-compatible JWT decode (no signature verification — API enforces that)
function decodeEdgeToken(token: string): AdminTokenPayload | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = parts[1]
    // atob is available in the edge runtime
    const decoded = JSON.parse(
      atob(payload.replace(/-/g, '+').replace(/_/g, '/')),
    )
    if (typeof decoded.exp === 'number' && decoded.exp < Math.floor(Date.now() / 1000)) {
      return null
    }
    return decoded as AdminTokenPayload
  } catch {
    return null
  }
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Auth routes are always accessible
  if (pathname.startsWith('/login') || pathname.startsWith('/mfa')) {
    return NextResponse.next()
  }

  // Public error pages
  if (pathname === '/403' || pathname === '/404') {
    return NextResponse.next()
  }

  // All other paths require a valid admin session
  const token = request.cookies.get(ADMIN_TOKEN_COOKIE)?.value
  if (!token) {
    return NextResponse.redirect(
      new URL(`/login?redirect=${encodeURIComponent(pathname)}`, request.url),
    )
  }

  const session = decodeEdgeToken(token)
  if (!session) {
    const res = NextResponse.redirect(
      new URL('/login?reason=expired', request.url),
    )
    res.cookies.delete(ADMIN_TOKEN_COOKIE)
    return res
  }

  // RBAC capability check
  // Strip leading slash for lookup, e.g. /users/123 → /users
  const segment = '/' + (pathname.split('/')[1] ?? '')
  const fullPath = segment + (pathname.includes('/settings/') ? '/' + pathname.split('/')[2] : '')
  const required: Capability | undefined =
    ROUTE_CAPABILITY[pathname] ?? ROUTE_CAPABILITY[fullPath] ?? ROUTE_CAPABILITY[segment]

  if (required && !session.capabilities.includes(required)) {
    return NextResponse.redirect(new URL('/403', request.url))
  }

  return NextResponse.next()
}

export const config = {
  // Run middleware on all paths except static assets and API routes
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|ico|jpg|jpeg|gif|webp)).*)',
  ],
}
