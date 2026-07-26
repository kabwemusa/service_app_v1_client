import type { Metadata } from 'next'
import { PromotionsManager } from '@/components/promotions/PromotionsManager'

export const metadata: Metadata = { title: 'Growth & Promotions' }

export default function PromotionsPage() {
  return <PromotionsManager />
}
