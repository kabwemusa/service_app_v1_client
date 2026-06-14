import type { Metadata } from 'next'
import { AuditTrail } from '@/components/ui/AuditTrail'

export const metadata: Metadata = { title: 'Audit log' }

export default function AuditLogPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-medium text-slate-900 dark:text-slate-100">Audit log</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Append-only record of every state-changing admin action. Never editable or deletable.
        </p>
      </div>

      {/* Full platform-wide audit viewer — filter by actor, action, target, date */}
      <AuditTrail />
    </div>
  )
}
