import type { Metadata } from 'next'
import { VerificationQueue } from '@/components/verification/VerificationQueue'

export const metadata: Metadata = { title: 'Verification' }

// Route access is enforced two ways: middleware gates /verification on
// `read:verification` (403 for anyone else) and the Sidebar hides the link via
// <Can>. Decision actions inside are additionally gated on `write:verification`.
export default function VerificationPage() {
  return <VerificationQueue />
}
