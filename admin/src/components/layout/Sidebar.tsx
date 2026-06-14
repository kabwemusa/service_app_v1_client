'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, UserCheck, Scale, Shield, AlertTriangle,
  Users, Calendar, Briefcase, Tag, Star,
  Megaphone, Image as ImageIcon,
  Percent, Wallet, CreditCard,
  BarChart3, Settings,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCan } from '@/lib/rbac/use-can'
import type { Capability } from '@/lib/api/types'
import type { LucideIcon } from 'lucide-react'

interface NavItem {
  label: string
  href: string
  icon: LucideIcon
  capability: Capability
}

interface NavGroup {
  label: string
  items: NavItem[]
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, capability: 'read:dashboard' },
    ],
  },
  {
    label: 'Trust & safety',
    items: [
      { label: 'Verification', href: '/verification', icon: UserCheck, capability: 'read:verification' },
      { label: 'Disputes', href: '/disputes', icon: Scale, capability: 'read:disputes' },
      { label: 'Safety', href: '/safety', icon: Shield, capability: 'read:safety' },
      { label: 'Fraud & denylist', href: '/fraud', icon: AlertTriangle, capability: 'read:fraud' },
    ],
  },
  {
    label: 'Marketplace',
    items: [
      { label: 'Users', href: '/users', icon: Users, capability: 'read:users' },
      { label: 'Bookings', href: '/bookings', icon: Calendar, capability: 'read:bookings' },
      { label: 'Services', href: '/services', icon: Briefcase, capability: 'read:services' },
      { label: 'Categories', href: '/categories', icon: Tag, capability: 'read:categories' },
      { label: 'Reviews', href: '/reviews', icon: Star, capability: 'read:reviews' },
    ],
  },
  {
    label: 'Growth',
    items: [
      { label: 'Promotions', href: '/promotions', icon: Megaphone, capability: 'read:promotions' },
      { label: 'Banners', href: '/banners', icon: ImageIcon, capability: 'read:banners' },
    ],
  },
  {
    label: 'Finance',
    items: [
      { label: 'Commissions', href: '/commissions', icon: Percent, capability: 'read:commissions' },
      { label: 'Payouts', href: '/payouts', icon: Wallet, capability: 'read:payouts' },
      { label: 'Subscriptions', href: '/subscriptions', icon: CreditCard, capability: 'read:subscriptions' },
    ],
  },
  {
    label: 'Platform',
    items: [
      { label: 'Insights', href: '/insights', icon: BarChart3, capability: 'read:insights' },
      { label: 'Settings', href: '/settings', icon: Settings, capability: 'read:settings' },
    ],
  },
]

function NavItemButton({ item, active }: { item: NavItem; active: boolean }) {
  const canView = useCan(item.capability)
  if (!canView) return null

  return (
    <Link
      href={item.href}
      className={cn(
        'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
        active
          ? 'bg-teal-50 text-teal-700 font-medium dark:bg-teal-900/30 dark:text-teal-400'
          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200',
      )}
      aria-current={active ? 'page' : undefined}
    >
      <item.icon
        className={cn('size-4 shrink-0', active ? 'text-teal-600' : 'text-slate-400')}
        strokeWidth={1.75}
      />
      {item.label}
    </Link>
  )
}

export function Sidebar() {
  const pathname = usePathname()

  return (
    <aside
      className="flex h-full w-56 shrink-0 flex-col border-r border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"
      aria-label="Main navigation"
    >
      {/* Logo */}
      <div className="flex h-14 shrink-0 items-center border-b border-slate-200 px-4 dark:border-slate-700">
        <span className="text-sm font-medium text-teal-700 dark:text-teal-400">
          SSM Admin
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto p-3 space-y-5">
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            <p className="mb-1 px-3 text-xs font-medium uppercase tracking-wider text-slate-400 dark:text-slate-500">
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <NavItemButton
                  key={item.href}
                  item={item}
                  active={pathname === item.href || pathname.startsWith(item.href + '/')}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  )
}
