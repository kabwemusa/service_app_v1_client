import type { Metadata } from 'next'
import { ServicesManager } from '@/components/services/ServicesManager'

export const metadata: Metadata = { title: 'Services' }

export default function ServicesPage() {
  return <ServicesManager />
}
