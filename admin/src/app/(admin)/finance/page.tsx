import type { Metadata } from 'next'
import { FinanceManager } from '@/components/finance/FinanceManager'

export const metadata: Metadata = { title: 'Finance' }

export default function FinancePage() {
  return <FinanceManager />
}
