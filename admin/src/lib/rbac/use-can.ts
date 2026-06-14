'use client'

import { useAuthStore } from '@/lib/store/auth-store'
import { hasCapability, hasAnyCapability } from '@/lib/rbac/permissions'
import type { Capability } from '@/lib/api/types'

// NOTE: selectors must return a STABLE reference. Returning `?? []` here
// allocates a new array every render, which makes useSyncExternalStore loop
// infinitely ("getServerSnapshot should be cached"). Select the stored array
// (or undefined) and handle the empty case in the derivation instead.

// Primary hook — use this everywhere instead of checking role strings.
export function useCan(capability: Capability): boolean {
  const capabilities = useAuthStore((s) => s.user?.capabilities)
  return capabilities ? hasCapability(capabilities, capability) : false
}

// Checks if the user has ANY of the listed capabilities.
export function useCanAny(required: Capability[]): boolean {
  const capabilities = useAuthStore((s) => s.user?.capabilities)
  return capabilities ? hasAnyCapability(capabilities, required) : false
}

// Checks if the user has ALL of the listed capabilities.
export function useCanAll(required: Capability[]): boolean {
  const capabilities = useAuthStore((s) => s.user?.capabilities)
  return capabilities ? required.every((c) => hasCapability(capabilities, c)) : false
}
