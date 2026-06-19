'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect, useRef, useCallback } from 'react'
import {
  LayoutDashboard, UserCheck, Scale, Shield, AlertTriangle,
  Users, Calendar, Briefcase, Tag, Star,
  Megaphone, Image as ImageIcon,
  Percent, Wallet, CreditCard,
  BarChart3, Settings,
  ChevronRight, Loader2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCan } from '@/lib/rbac/use-can'
import type { Capability } from '@/lib/api/types'
import type { LucideIcon } from 'lucide-react'

// ── Data ─────────────────────────────────────────────────────────────────────

interface NavItem {
  label: string
  href: string
  icon: LucideIcon
  capability: Capability
}

interface NavGroup {
  label: string
  icon: LucideIcon
  items: NavItem[]
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Overview',
    icon: LayoutDashboard,
    items: [
      { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, capability: 'read:dashboard' },
    ],
  },
  {
    label: 'Trust & Safety',
    icon: Shield,
    items: [
      { label: 'Verification',    href: '/verification', icon: UserCheck,    capability: 'read:verification' },
      { label: 'Disputes',        href: '/disputes',     icon: Scale,        capability: 'read:disputes' },
      { label: 'Safety',          href: '/safety',       icon: Shield,       capability: 'safety.handle' },
      { label: 'Fraud & Denylist',href: '/fraud',        icon: AlertTriangle,capability: 'read:fraud' },
    ],
  },
  {
    label: 'Marketplace',
    icon: Briefcase,
    items: [
      { label: 'Users',      href: '/users',      icon: Users,    capability: 'read:users' },
      { label: 'Bookings',   href: '/bookings',   icon: Calendar, capability: 'read:bookings' },
      { label: 'Services',   href: '/services',   icon: Briefcase,capability: 'read:services' },
      { label: 'Categories', href: '/categories', icon: Tag,      capability: 'read:categories' },
      { label: 'Reviews',    href: '/reviews',    icon: Star,     capability: 'read:reviews' },
    ],
  },
  {
    label: 'Growth',
    icon: Megaphone,
    items: [
      { label: 'Promotions', href: '/promotions', icon: Megaphone, capability: 'read:promotions' },
      { label: 'Banners',    href: '/banners',    icon: ImageIcon, capability: 'read:banners' },
    ],
  },
  {
    label: 'Finance',
    icon: Wallet,
    items: [
      { label: 'Commissions',   href: '/commissions',   icon: Percent,   capability: 'read:commissions' },
      { label: 'Payouts',       href: '/payouts',       icon: Wallet,    capability: 'read:payouts' },
      { label: 'Subscriptions', href: '/subscriptions', icon: CreditCard,capability: 'read:subscriptions' },
    ],
  },
  {
    label: 'Platform',
    icon: Settings,
    items: [
      { label: 'Insights', href: '/insights', icon: BarChart3, capability: 'read:insights' },
      { label: 'Settings', href: '/settings', icon: Settings,  capability: 'read:settings' },
    ],
  },
]

// ── Single nav link ───────────────────────────────────────────────────────────

interface NavLinkProps {
  item: NavItem
  active: boolean
  pending: boolean
  onNavigate: (href: string) => void
}

function NavLink({ item, active, pending, onNavigate }: NavLinkProps) {
  const canView = useCan(item.capability)
  if (!canView) return null

  return (
    <Link
      href={item.href}
      onClick={() => !active && onNavigate(item.href)}
      className={cn(
        'group flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm',
        'transition-colors duration-150 select-none outline-none',
        'focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-1',
        active
          ? 'bg-teal-50 font-medium text-teal-700 dark:bg-teal-900/30 dark:text-teal-400'
          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700/60 dark:hover:text-slate-200',
      )}
      aria-current={active ? 'page' : undefined}
    >
      {pending ? (
        <Loader2
          className="size-4 shrink-0 animate-spin text-teal-500"
          aria-label="Loading…"
        />
      ) : (
        <item.icon
          className={cn(
            'size-4 shrink-0 transition-colors duration-150',
            active
              ? 'text-teal-600 dark:text-teal-400'
              : 'text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300',
          )}
          strokeWidth={1.75}
          aria-hidden="true"
        />
      )}
      <span className="truncate">{item.label}</span>
    </Link>
  )
}

// ── Accordion group ───────────────────────────────────────────────────────────

interface NavGroupProps {
  group: NavGroup
  isOpen: boolean
  onToggle: () => void
  pathname: string
  pendingHref: string | null
  onNavigate: (href: string) => void
}

function NavGroupItem({
  group,
  isOpen,
  onToggle,
  pathname,
  pendingHref,
  onNavigate,
}: NavGroupProps) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const mountedRef = useRef(false)
  const [height, setHeight] = useState<number | 'auto'>(isOpen ? 'auto' : 0)

  const hasActiveChild = group.items.some(
    (item) => pathname === item.href || pathname.startsWith(item.href + '/'),
  )

  useEffect(() => {
    // Skip height animation on first mount — only animate on subsequent changes
    if (!mountedRef.current) {
      mountedRef.current = true
      return
    }

    const el = bodyRef.current
    if (!el) return

    if (isOpen) {
      // 0 → explicit height → auto
      const fullH = el.scrollHeight
      setHeight(fullH)
      const tid = setTimeout(() => setHeight('auto'), 220)
      return () => clearTimeout(tid)
    } else {
      // auto → explicit height → 0
      const fullH = el.scrollHeight
      setHeight(fullH)
      // Wait one frame so the browser paints the explicit height first
      const raf = requestAnimationFrame(() =>
        requestAnimationFrame(() => setHeight(0))
      )
      return () => cancelAnimationFrame(raf)
    }
  }, [isOpen])

  return (
    <div>
      {/* Group header */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className={cn(
          'flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2',
          'text-left transition-colors duration-150 select-none outline-none',
          'focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-1',
          hasActiveChild && !isOpen
            ? 'text-teal-700 dark:text-teal-400'
            : 'text-slate-500 dark:text-slate-400',
          'hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-700/60 dark:hover:text-slate-200',
        )}
      >
        <group.icon
          className={cn(
            'size-4 shrink-0 transition-colors duration-150',
            hasActiveChild && !isOpen
              ? 'text-teal-500 dark:text-teal-400'
              : 'text-slate-400',
          )}
          strokeWidth={1.75}
          aria-hidden="true"
        />
        <span className="flex-1 truncate text-[11px] font-semibold uppercase tracking-wider">
          {group.label}
        </span>
        <ChevronRight
          className={cn(
            'size-3 shrink-0 text-slate-400 transition-transform duration-200 ease-in-out',
            isOpen && 'rotate-90',
          )}
          aria-hidden="true"
        />
      </button>

      {/* Collapsible content */}
      <div
        ref={bodyRef}
        style={{ height: height === 'auto' ? undefined : height }}
        className={cn(
          'overflow-hidden',
          height !== 'auto' && 'transition-[height] duration-200 ease-in-out',
        )}
        aria-hidden={!isOpen}
        inert={!isOpen ? ('' as unknown as boolean) : undefined}
      >
        <div className="mt-0.5 ml-2 space-y-0.5 border-l border-slate-100 pl-2.5 dark:border-slate-800">
          {group.items.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(item.href + '/')
            return (
              <NavLink
                key={item.href}
                item={item}
                active={active}
                pending={pendingHref === item.href}
                onNavigate={onNavigate}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Sidebar root ──────────────────────────────────────────────────────────────

function groupIndexForPath(pathname: string): number {
  return NAV_GROUPS.findIndex((g) =>
    g.items.some(
      (item) => pathname === item.href || pathname.startsWith(item.href + '/'),
    ),
  )
}

export function Sidebar() {
  const pathname = usePathname()

  const [openIndex,    setOpenIndex]    = useState(() => groupIndexForPath(pathname))
  const [pendingHref,  setPendingHref]  = useState<string | null>(null)

  // When the route actually changes: clear pending indicator, open correct group
  useEffect(() => {
    setPendingHref(null)
    const idx = groupIndexForPath(pathname)
    if (idx >= 0) setOpenIndex(idx)
  }, [pathname])

  const handleToggle = useCallback((idx: number) => {
    setOpenIndex((prev) => (prev === idx ? -1 : idx))
  }, [])

  const handleNavigate = useCallback((href: string) => {
    setPendingHref(href)
  }, [])

  return (
    <aside
      className="flex h-full w-56 shrink-0 flex-col border-r border-slate-200 bg-white dark:border-slate-700/60 dark:bg-slate-900"
      aria-label="Main navigation"
    >
      {/* Brand */}
      <div className="flex h-14 shrink-0 items-center border-b border-slate-200 px-4 dark:border-slate-700/60">
        <span className="text-sm font-semibold tracking-tight text-teal-700 dark:text-teal-400">
          SSM Admin
        </span>
      </div>

      {/* Nav accordion */}
      <nav
        className="flex-1 overflow-y-auto px-2 py-3 space-y-1"
        aria-label="Navigation"
      >
        {NAV_GROUPS.map((group, idx) => (
          <NavGroupItem
            key={group.label}
            group={group}
            isOpen={openIndex === idx}
            onToggle={() => handleToggle(idx)}
            pathname={pathname}
            pendingHref={pendingHref}
            onNavigate={handleNavigate}
          />
        ))}
      </nav>
    </aside>
  )
}
