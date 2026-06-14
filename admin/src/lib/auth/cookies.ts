// Cookie-name constants only. Kept free of `next/headers` so they can be
// imported from client components and edge middleware without pulling in
// server-only APIs. Server-side session helpers live in `session.ts`.

export const ADMIN_TOKEN_COOKIE = 'admin_token'
// Step-up token issued after re-auth / MFA; required for sensitive mutations
export const STEP_UP_COOKIE = 'admin_step_up'
