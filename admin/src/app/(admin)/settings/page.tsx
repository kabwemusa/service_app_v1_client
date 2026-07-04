import type { Metadata } from 'next'
import { PlatformSettingsManager } from '@/components/settings/PlatformSettingsManager'

export const metadata: Metadata = { title: 'Settings' }

export default function SettingsPage() {
  return <PlatformSettingsManager />
}
