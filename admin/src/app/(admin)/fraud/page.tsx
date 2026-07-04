import type { Metadata } from 'next'
import { FraudManager } from '@/components/fraud/FraudManager'

export const metadata: Metadata = { title: 'Fraud & denylist' }

export default function FraudPage() {
  return <FraudManager />
}
