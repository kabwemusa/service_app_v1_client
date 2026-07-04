import type { Metadata } from 'next'
import { BookingsManager } from '@/components/bookings/BookingsManager'

export const metadata: Metadata = { title: 'Bookings' }

export default function BookingsPage() {
  return <BookingsManager />
}
