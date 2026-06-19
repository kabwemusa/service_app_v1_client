'use client'

import { useRef, useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { api, ApiResponseError } from '@/lib/api/client'
import { ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'

interface MfaResponse {
  // Full admin_token cookie set by Set-Cookie header on success
  success: boolean
}

export default function MfaPage() {
  const router = useRouter()
  const params = useSearchParams()
  const redirect = params.get('redirect') ?? '/dashboard'

  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (code.replace(/\s/g, '').length !== 6) return
    setError(null)
    setSubmitting(true)

    try {
      // Read the partial token from the short-lived cookie
      const partial = document.cookie.match(/admin_mfa_partial=([^;]+)/)?.[1]
      if (!partial) {
        router.push('/login?reason=expired')
        return
      }

      await api.post<MfaResponse>('/api/admin/auth/mfa/verify', {
        code: code.replace(/\s/g, ''),
        partial_token: decodeURIComponent(partial),
      })

      // Clear the partial cookie
      document.cookie = 'admin_mfa_partial=; path=/; max-age=0'
      router.push(redirect)
    } catch (err) {
      if (err instanceof ApiResponseError) {
        setError(err.error.message)
      } else {
        setError('Verification failed. Please try again.')
      }
      setCode('')
      setSubmitting(false)
      inputRef.current?.focus()
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6 dark:bg-slate-950">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-2">
          <div className="flex size-10 items-center justify-center rounded-lg bg-teal-600">
            <ShieldCheck className="size-5 text-white" />
          </div>
          <h1 className="text-base font-medium text-slate-900 dark:text-slate-100">
            Two-factor authentication
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 text-center">
            Enter the 6-digit code from your authenticator app.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800"
        >
          <div className="space-y-1.5">
            <label htmlFor="mfa-code" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Authentication code
            </label>
            <input
              ref={inputRef}
              id="mfa-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              value={code}
              onChange={(e) => {
                const v = e.target.value.replace(/[^0-9]/g, '').slice(0, 6)
                setCode(v)
              }}
              placeholder="000000"
              className={cn(
                'h-11 w-full rounded-lg border px-3 text-center text-xl tracking-[0.3em]',
                'border-slate-200 bg-white dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100',
                'focus:outline-none focus:ring-2 focus:ring-teal-500',
                error && 'border-red-400',
              )}
            />
          </div>

          {error && (
            <p className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-600">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={code.length !== 6 || submitting}
            className="w-full rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-60"
          >
            {submitting ? 'Verifyingâ€¦' : 'Verify'}
          </button>
        </form>

        <p className="text-center text-xs text-slate-400">
          Lost access to your authenticator?{' '}
          <a href="mailto:it@ssm.internal" className="underline underline-offset-2">
            Contact IT
          </a>
        </p>
      </div>
    </div>
  )
}
