import type { Metadata } from 'next'
import { WhatsAppManager } from '@/components/whatsapp/WhatsAppManager'

export const metadata: Metadata = { title: 'WhatsApp Ops' }

export default function WhatsAppPage() {
  return <WhatsAppManager />
}
