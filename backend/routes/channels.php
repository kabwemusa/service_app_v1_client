<?php

use App\Models\AdminUser;
use App\Support\AdminCapabilities;
use Illuminate\Support\Facades\Broadcast;

/*
|--------------------------------------------------------------------------
| Broadcast Channels
|--------------------------------------------------------------------------
|
| Private channel authorization. The user can only subscribe to their own
| notification channel (private-user.{id}).
|
*/

Broadcast::channel('user.{userId}', function ($user, $userId) {
    return $user->id === $userId;
});

/*
|--------------------------------------------------------------------------
| Admin queue channels
|--------------------------------------------------------------------------
|
| One private channel per admin module (verification/finance/safety/reviews/
| services). Authorized against the `admin` guard + the same capability
| strings the REST endpoints for that module already require.
|
*/

Broadcast::channel('admin.{module}', function (AdminUser $admin, string $module) {
    $capability = match ($module) {
        'verification' => 'read:verification',
        'finance'      => 'read:commissions',
        'safety'       => 'safety.handle',
        'reviews'      => 'read:reviews',
        'services'     => 'read:services',
        'promotions'   => 'read:promotions',
        default        => null,
    };

    return $capability !== null
        && in_array($capability, AdminCapabilities::forRole($admin->role), true);
}, ['guards' => ['admin']]);

// Registers POST /api/admin/broadcasting/auth, guarded by the admin JWT guard
// (mirrors the `auth:admin` middleware used by every other admin/* route).
Broadcast::routes([
    'middleware' => ['auth:admin'],
    'prefix'     => 'api/admin',
]);

// Registers POST /api/broadcasting/auth for the customer/provider apps + PWA,
// authorized against the `api` JWT guard (same guard as every other /api route).
// Private-channel subscriptions (private-user.{id}) authenticate here with the
// caller's Bearer token — this is what lets the mobile Reverb client subscribe.
Broadcast::routes([
    'middleware' => ['auth:api'],
    'prefix'     => 'api',
]);
