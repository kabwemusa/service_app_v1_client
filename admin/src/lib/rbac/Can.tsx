'use client'

import type { ReactNode } from 'react'
import { useCan, useCanAny, useCanAll } from '@/lib/rbac/use-can'
import type { Capability } from '@/lib/api/types'

interface CanProps {
  // Render children only if the user has this single capability
  do?: Capability
  // Render children if the user has ANY of these capabilities
  any?: Capability[]
  // Render children only if the user has ALL of these capabilities
  all?: Capability[]
  children: ReactNode
  // Optional fallback rendered when the check fails (default: null)
  fallback?: ReactNode
}

// Declarative RBAC gate. Hides UI — the API enforces independently.
//
//   <Can do="write:payouts">
//     <Button>Release payout</Button>
//   </Can>
//
//   <Can any={['read:fraud', 'read:disputes']}>
//     <FraudPanel />
//   </Can>
export function Can({ do: single, any, all, children, fallback = null }: CanProps) {
  const singleOk = single !== undefined ? useCan(single) : true
  const anyOk = any !== undefined ? useCanAny(any) : true
  const allOk = all !== undefined ? useCanAll(all) : true

  if (singleOk && anyOk && allOk) return <>{children}</>
  return <>{fallback}</>
}
