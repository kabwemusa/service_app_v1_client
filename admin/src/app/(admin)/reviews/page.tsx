import type { Metadata } from 'next'
import { ReviewsManager } from '@/components/reviews/ReviewsManager'

export const metadata: Metadata = { title: 'Reviews' }

export default function ReviewsPage() {
  return <ReviewsManager />
}
