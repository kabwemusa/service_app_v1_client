'use client'

import { useEffect, useRef } from 'react'
import { getEcho } from '@/lib/realtime/echo'

export interface AdminQueueEventPayload {
  id: string
  type: string
  module: string
  entity_id: string
  payload: Record<string, unknown>
  created_at: string
}

type Handlers = Record<string, (event: AdminQueueEventPayload) => void>

const MAX_SEEN_IDS = 200

/**
 * Subscribes to `private-admin.{module}` for the lifetime of the calling
 * component and invokes the matching handler for each event type received.
 * Dedupes by the event's `id` in case of reconnect/replay.
 */
export function useAdminChannel(module: string, handlers: Handlers): void {
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  const seenIds = useRef<string[]>([])

  useEffect(() => {
    const echo = getEcho()
    const channel = echo.private(`admin.${module}`)

    const types = Object.keys(handlersRef.current)
    const listener = (type: string) => (event: AdminQueueEventPayload) => {
      if (seenIds.current.includes(event.id)) return
      seenIds.current.push(event.id)
      if (seenIds.current.length > MAX_SEEN_IDS) seenIds.current.shift()

      handlersRef.current[type]?.(event)
    }

    for (const type of types) {
      channel.listen(`.${type}`, listener(type))
    }

    return () => {
      echo.leave(`admin.${module}`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [module])
}
