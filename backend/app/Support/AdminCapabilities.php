<?php

namespace App\Support;

/**
 * Server-side mirror of admin/src/lib/rbac/permissions.ts.
 *
 * Capability strings are the single source of truth for admin authorization.
 * The JWT carries the resolved capability list; the API enforces it via the
 * `admin.can` middleware, and the panel uses the same list for UI gating.
 *
 * RBAC is additive — no inheritance, no wildcard denial. Keep this in lockstep
 * with the frontend ROLE_CAPABILITIES map.
 */
final class AdminCapabilities
{
    /** Every capability in the system. */
    public const ALL = [
        'read:dashboard',
        'read:users', 'write:users', 'suspend:users', 'ban:users',
        'users.view_pii', 'users.moderate', 'users.adjust_tier',
        'read:bookings',
        'read:services', 'services.moderate',
        'read:categories', 'write:categories',
        'categories.manage', 'categories.set_band',
        'read:reviews', 'write:reviews', 'reviews.moderate',
        'read:verification', 'write:verification',
        'read:disputes', 'write:disputes',
        'read:safety', 'write:safety',
        // Highest-sensitivity Safety triage surface (§11.3/§11.4). Strictly
        // narrower than read/write:safety: only trust_safety + super_admin.
        'safety.handle',
        'read:fraud', 'write:fraud', 'write:denylist',
        'read:promotions', 'write:promotions',
        'read:banners', 'write:banners',
        'read:commissions', 'write:commissions',
        'read:payouts', 'write:payouts',
        'read:subscriptions', 'write:subscriptions',
        'read:insights',
        'read:settings', 'write:settings',
        'manage:admins',
        'read:audit',
        'write:platform_params',
    ];

    /** Capabilities granted to each admin role. */
    public const ROLE_CAPABILITIES = [
        'super_admin' => self::ALL,

        'trust_safety' => [
            'read:dashboard',
            'read:users', 'write:users', 'suspend:users', 'ban:users',
            'users.view_pii', 'users.moderate', 'users.adjust_tier',
            'read:bookings',
            'read:services', 'services.moderate',
            'read:categories',
            'read:reviews', 'write:reviews', 'reviews.moderate',
            'read:verification', 'write:verification',
            'read:disputes', 'write:disputes',
            'read:safety', 'write:safety',
            'safety.handle',
            'read:fraud', 'write:fraud', 'write:denylist',
            'read:promotions',
        ],

        'finance' => [
            'read:dashboard',
            'read:users',
            'read:bookings',
            'read:services',
            'read:commissions', 'write:commissions',
            'read:payouts', 'write:payouts',
            'read:subscriptions',
            'categories.manage', 'categories.set_band',
        ],

        'moderator' => [
            'read:dashboard',
            'read:users',
            'read:bookings',
            'read:services', 'services.moderate',
            'read:categories',
            'categories.manage',
            'read:reviews', 'write:reviews', 'reviews.moderate',
            'read:disputes', 'write:disputes',
            'read:safety',
            'read:banners', 'write:banners',
        ],

        'support' => [
            'read:dashboard',
            'read:users', 'users.view_pii',
            'read:bookings',
            'read:services',
            'read:reviews',
            'read:promotions',
            'read:subscriptions',
        ],

        'analyst' => [
            'read:dashboard',
            'read:users',
            'read:bookings',
            'read:services',
            'read:categories',
            'read:reviews',
            'read:insights',
        ],
    ];

    public const ROLES = ['super_admin', 'trust_safety', 'finance', 'moderator', 'support', 'analyst'];

    /** Resolve the capability list for a role (empty for unknown roles). */
    public static function forRole(string $role): array
    {
        return self::ROLE_CAPABILITIES[$role] ?? [];
    }

    public static function roleHas(string $role, string $capability): bool
    {
        return in_array($capability, self::forRole($role), true);
    }
}
