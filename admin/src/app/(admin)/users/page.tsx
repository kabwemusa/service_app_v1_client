import type { Metadata } from 'next'
import { UsersManager } from '@/components/users/UsersManager'

export const metadata: Metadata = { title: 'Users' }

// Route access is enforced two ways: middleware gates /users on `read:users`
// (403 for anyone else) and the Sidebar hides the link via <Can>. PII reveal and
// moderation actions inside are additionally gated on their own capabilities.
export default function UsersPage() {
  return <UsersManager />
}
