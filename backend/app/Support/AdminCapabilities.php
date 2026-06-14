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
        'read:bookings',
        'read:services',
        'read:categories', 'write:categories',
        'read:reviews', 'write:reviews',
        'read:verification', 'write:verification',
        'read:disputes', 'write:disputes',
        'read:safety', 'write:safety',
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
            'read:bookings',
            'read:services',
            'read:categories',
            'read:reviews', 'write:reviews',
            'read:verification', 'write:verification',
            'read:disputes', 'write:disputes',
            'read:safety', 'write:safety',
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
        ],

        'moderator' => [
            'read:dashboard',
            'read:users',
            'read:bookings',
            'read:services',
            'read:categories',
            'read:reviews', 'write:reviews',
            'read:disputes', 'write:disputes',
            'read:safety',
            'read:banners', 'write:banners',
        ],

        'support' => [
            'read:dashboard',
            'read:users',
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
