import type { Metadata } from 'next'
import { SafetyManager } from '@/components/safety/SafetyManager'

export const metadata: Metadata = { title: 'Safety' }

// Highest-sensitivity surface. Route access is gated two ways: middleware gates
// /safety on `safety.handle` (403 for anyone but trust_safety / super_admin) and
// the Sidebar hides the link via <Can>. PII reveal and protective actions inside
// are additionally gated + logged. The API enforces safety.handle independently.
export default function SafetyPage() {
  return <SafetyManager />
}
