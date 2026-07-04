'use client'

import { useState } from 'react'
import { IoCheckmarkOutline, IoCloseOutline, IoPencilOutline } from 'react-icons/io5'
import { Can } from '@/lib/rbac/Can'
import { useAuditedMutation } from '@/lib/audit/audited-mutation'
import { fmtDatetime } from '@/lib/utils'
import { settingsApi, type SettingItem, type TrustWeights, type AlertRouting, type SettingGroup } from '@/lib/api/settings'

const ROLE_OPTIONS = ['super_admin', 'trust_safety', 'finance', 'moderator', 'support', 'analyst', 'ops']
const CHANNEL_OPTIONS = ['in_app', 'email']

export function SettingField({
  setting,
  onSaved,
  doubleConfirmLabel,
}: {
  setting: SettingItem
  group: SettingGroup
  onSaved: () => void
  /** When set, a checkbox with this label must be ticked before Save is enabled — for major, platform-wide changes. */
  doubleConfirmLabel?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<unknown>(setting.value)
  const [confirmed, setConfirmed] = useState(false)

  const update = useAuditedMutation<{ value: unknown }, unknown>({
    capability: 'write:settings',
    audit: {
      action: 'settings.update',
      targetType: 'platform_setting',
      targetId: setting.key,
      summary: `Update "${setting.label}". Every change is recorded with the before/after value.`,
    },
    mutationFn: (p) => settingsApi.update(setting.key, { value: p.value, reason: p.reason }),
    onSuccess: () => { setEditing(false); onSaved() },
  })

  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 py-3 last:border-0 dark:border-slate-800">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{setting.label}</p>
        <p className="mt-0.5 text-xs text-slate-400">
          {setting.live ? 'Takes effect immediately.' : 'Recorded and audited — applied on the next deploy.'}
          {setting.updated_at && <> · Last changed {fmtDatetime(setting.updated_at)}</>}
        </p>

        {editing ? (
          <div className="mt-2 space-y-2">
            <ValueEditor type={setting.type} value={draft} onChange={setDraft} />
            {doubleConfirmLabel && (
              <label className="flex items-start gap-2 rounded-sm border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5" />
                {doubleConfirmLabel}
              </label>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                disabled={update.isPending || (!!doubleConfirmLabel && !confirmed)}
                onClick={() => update.trigger({ value: draft })}
                className="flex items-center gap-1 rounded-sm bg-teal-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-teal-700 disabled:opacity-50"
              >
                <IoCheckmarkOutline className="size-3.5" /> Save
              </button>
              <button
                type="button"
                onClick={() => { setEditing(false); setDraft(setting.value); setConfirmed(false) }}
                className="flex items-center gap-1 rounded-sm border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-400 dark:hover:bg-slate-700"
              >
                <IoCloseOutline className="size-3.5" /> Cancel
              </button>
            </div>
          </div>
        ) : (
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            <ValuePreview type={setting.type} value={setting.value} />
          </p>
        )}
      </div>

      {!editing && (
        <Can do="write:settings">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="flex shrink-0 items-center gap-1 text-xs font-medium text-teal-600 hover:underline dark:text-teal-400"
          >
            <IoPencilOutline className="size-3.5" /> Edit
          </button>
        </Can>
      )}
    </div>
  )
}

function ValuePreview({ type, value }: { type: SettingItem['type']; value: unknown }) {
  if (type === 'weights') {
    const w = value as TrustWeights
    return <>Identity {Math.round(w.identity * 100)}% · Reliability {Math.round(w.reliability * 100)}% · Financial {Math.round(w.financial * 100)}% · Ratings {Math.round(w.ratings * 100)}%</>
  }
  if (type === 'routing') {
    const r = value as AlertRouting
    return <>{r.roles.join(', ')} — {r.channels.join(', ')}</>
  }
  if (type === 'float' && typeof value === 'number' && value < 1) {
    return <>{Math.round(value * 100)}%</>
  }
  return <>{String(value)}</>
}

function ValueEditor({ type, value, onChange }: { type: SettingItem['type']; value: unknown; onChange: (v: unknown) => void }) {
  if (type.startsWith('enum:')) {
    const options = type.slice(5).split(',')
    return (
      <select value={value as string} onChange={(e) => onChange(e.target.value)} className="h-9 rounded-sm border border-slate-200 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100">
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    )
  }

  if (type === 'int' || type === 'float') {
    return (
      <input
        type="number"
        step={type === 'float' ? 0.01 : 1}
        value={value as number}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-9 w-32 rounded-sm border border-slate-200 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
      />
    )
  }

  if (type === 'weights') {
    const w = value as TrustWeights
    const sum = w.identity + w.reliability + w.financial + w.ratings
    return (
      <div className="space-y-1.5">
        {(['identity', 'reliability', 'financial', 'ratings'] as const).map((k) => (
          <label key={k} className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
            <span className="w-20 capitalize">{k}</span>
            <input
              type="number"
              min={0}
              max={100}
              value={Math.round(w[k] * 100)}
              onChange={(e) => onChange({ ...w, [k]: Number(e.target.value) / 100 })}
              className="h-8 w-20 rounded-sm border border-slate-200 px-2 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
            />
            %
          </label>
        ))}
        <p className={`text-xs ${Math.abs(sum - 1) < 0.01 ? 'text-teal-600' : 'text-red-600'}`}>
          Sum: {Math.round(sum * 100)}% {Math.abs(sum - 1) < 0.01 ? '✓' : '— must total 100%'}
        </p>
      </div>
    )
  }

  if (type === 'routing') {
    const r = value as AlertRouting
    return (
      <div className="space-y-2">
        <div>
          <p className="text-xs text-slate-500">Roles</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {ROLE_OPTIONS.map((role) => (
              <label key={role} className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-400">
                <input
                  type="checkbox"
                  checked={r.roles.includes(role)}
                  onChange={(e) => onChange({ ...r, roles: e.target.checked ? [...r.roles, role] : r.roles.filter((x) => x !== role) })}
                />
                {role}
              </label>
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs text-slate-500">Channels</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {CHANNEL_OPTIONS.map((ch) => (
              <label key={ch} className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-400">
                <input
                  type="checkbox"
                  checked={r.channels.includes(ch)}
                  onChange={(e) => onChange({ ...r, channels: e.target.checked ? [...r.channels, ch] : r.channels.filter((x) => x !== ch) })}
                />
                {ch === 'in_app' ? 'In-app' : 'Email'}
              </label>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return null
}
