<?php

namespace App\Http\Middleware;

use App\Exceptions\Api\ForbiddenException;
use App\Support\AdminCapabilities;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Authorize the current admin against one or more capability strings.
 * The admin must be authenticated on the `admin` guard and hold ALL the listed
 * capabilities (resolved from their role).
 *
 * Usage:
 *   Route::middleware(['auth:admin', 'admin.can:read:verification'])->...
 *   Route::middleware(['auth:admin', 'admin.can:write:verification'])->...
 */
class EnsureAdminCapability
{
    public function handle(Request $request, Closure $next, string ...$capabilities): Response
    {
        $admin = $request->user();

        if (! $admin) {
            throw new ForbiddenException();
        }

        $granted = AdminCapabilities::forRole($admin->role);

        foreach ($capabilities as $capability) {
            if (! in_array($capability, $granted, true)) {
                throw new ForbiddenException();
            }
        }

        return $next($request);
    }
}
