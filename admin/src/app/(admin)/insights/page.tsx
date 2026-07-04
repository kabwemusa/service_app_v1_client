import type { Metadata } from 'next'
import { InsightsManager } from '@/components/insights/InsightsManager'

export const metadata: Metadata = { title: 'Insights' }

export default function InsightsPage() {
  return <InsightsManager />
}
