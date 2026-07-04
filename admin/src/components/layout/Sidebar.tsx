'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect, useRef, useCallback } from 'react'
import {
  IoGridOutline, IoIdCardOutline, IoScaleOutline, IoShieldOutline, IoWarningOutline,
  IoPeopleOutline, IoCalendarOutline, IoBriefcaseOutline, IoPricetagOutline, IoStarOutline,
  IoMegaphoneOutline, IoImageOutline as ImageIcon,
  IoCashOutline, IoCardOutline, IoLogoWhatsapp,
  IoBarChartOutline, IoSettingsOutline,
  IoChevronForwardOutline, IoSyncOutline,
} from 'react-icons/io5'
import { cn } from '@/lib/utils'
import { useCan } from '@/lib/rbac/use-can'
import type { Capability } from '@/lib/api/types'
import type { IconType } from 'react-icons'
import { useQueueBadgeStore, type QueueModule } from '@/lib/realtime/queue-badge-store'

// ── Data ─────────────────────────────────────────────────────────────────────

interface NavItem {
  label: string
  href: string
  icon: IconType
  capability: Capability
  /** Live queue badge (real-time event count) shown next to this item. */
  queueModule?: QueueModule
}

interface NavGroup {
  label: string
  icon: IconType
  items: NavItem[]
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Overview',
    icon: IoGridOutline,
    items: [
      { label: 'Dashboard', href: '/dashboard', icon: IoGridOutline, capability: 'read:dashboard' },
    ],
  },
  {
    label: 'Trust & Safety',
    icon: IoShieldOutline,
    items: [
      { label: 'Verification',    href: '/verification', icon: IoIdCardOutline,    capability: 'read:verification', queueModule: 'verification' },
      { label: 'Disputes',        href: '/disputes',     icon: IoScaleOutline,        capability: 'read:disputes' },
      { label: 'Safety',          href: '/safety',       icon: IoShieldOutline,       capability: 'safety.handle', queueModule: 'safety' },
      { label: 'Fraud & Denylist',href: '/fraud',        icon: IoWarningOutline,capability: 'read:fraud' },
    ],
  },
  {
    label: 'Marketplace',
    icon: IoBriefcaseOutline,
    items: [
      { label: 'Users',      href: '/users',      icon: IoPeopleOutline,    capability: 'read:users' },
      { label: 'Bookings',   href: '/bookings',   icon: IoCalendarOutline, capability: 'read:bookings' },
      { label: 'Services',   href: '/services',   icon: IoBriefcaseOutline,capability: 'read:services', queueModule: 'services' },
      { label: 'Categories', href: '/categories', icon: IoPricetagOutline,      capability: 'read:categories' },
      { label: 'Reviews',    href: '/reviews',    icon: IoStarOutline,     capability: 'read:reviews', queueModule: 'reviews' },
    ],
  },
  {
    label: 'Growth',
    icon: IoMegaphoneOutline,
    items: [
      { label: 'Promotions', href: '/promotions', icon: IoMegaphoneOutline, capability: 'read:promotions' },
      { label: 'Banners',    href: '/banners',    icon: ImageIcon, capability: 'read:banners' },
    ],
  },
  {
    label: 'Finance',
    icon: IoCashOutline,
    items: [
      { label: 'Finance',       href: '/finance',       icon: IoCashOutline,   capability: 'read:commissions', queueModule: 'finance' },
      { label: 'Subscriptions', href: '/subscriptions', icon: IoCardOutline,capability: 'read:subscriptions' },
    ],
  },
  {
    label: 'Platform',
    icon: IoSettingsOutline,
    items: [
      { label: 'WhatsApp Ops', href: '/whatsapp', icon: IoLogoWhatsapp,   capability: 'platform.ops' },
      { label: 'Insights',     href: '/insights', icon: IoBarChartOutline, capability: 'read:insights' },
      { label: 'Settings',     href: '/settings', icon: IoSettingsOutline,  capability: 'read:settings' },
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
  const badgeCount = useQueueBadgeStore((s) =>
    item.queueModule ? s.counts[item.queueModule] : 0,
  )
  const clearBadge = useQueueBadgeStore((s) => s.clear)

  useEffect(() => {
    if (active && item.queueModule) clearBadge(item.queueModule)
  }, [active, item.queueModule, clearBadge])

  if (!canView) return null

  return (
    <Link
      href={item.href}
      onClick={() => !active && onNavigate(item.href)}
      className={cn(
        'group flex cursor-pointer items-center gap-2.5 rounded-sm px-3 py-2 text-sm',
        'transition-colors duration-150 select-none outline-none',
        'focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-1',
        active
          ? 'bg-teal-50 font-medium text-teal-700 dark:bg-teal-900/30 dark:text-teal-400'
          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700/60 dark:hover:text-slate-200',
      )}
      aria-current={active ? 'page' : undefined}
    >
      {pending ? (
        <IoSyncOutline
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
          aria-hidden="true"
        />
      )}
      <span className="flex-1 truncate">{item.label}</span>
      {badgeCount > 0 && (
        <span
          className="ml-auto inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-medium text-white"
          aria-label={`${badgeCount} new`}
        >
          {badgeCount > 99 ? '99+' : badgeCount}
        </span>
      )}
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
          'flex w-full cursor-pointer items-center gap-2.5 rounded-sm px-3 py-2',
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
          aria-hidden="true"
        />
        <span className="flex-1 truncate text-[11px] font-semibold uppercase tracking-wider">
          {group.label}
        </span>
        <IoChevronForwardOutline
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
        inert={!isOpen}
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
