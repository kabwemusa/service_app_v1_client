import type { Metadata } from 'next'
import { LegalManager } from '@/components/legal/LegalManager'

export const metadata: Metadata = { title: 'Legal & Consent' }

export default function LegalPage() {
  return <LegalManager />
}
