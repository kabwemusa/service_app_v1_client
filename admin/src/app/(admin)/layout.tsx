import { redirect } from 'next/navigation'
import { getAdminSession } from '@/lib/auth/session'
import { AppShell } from '@/components/layout/AppShell'

// Server Component — reads session from cookie, hydrates AppShell
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getAdminSession()

  // Middleware handles the redirect for most cases; this is the server-side
  // fallback for any edge case where middleware didn't catch the request.
  if (!session) {
    redirect('/login')
  }

  return <AppShell initialSession={session}>{children}</AppShell>
}
