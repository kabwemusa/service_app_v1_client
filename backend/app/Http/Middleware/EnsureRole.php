<?php

namespace App\Http\Middleware;

use App\Exceptions\Api\ForbiddenException;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Verify the authenticated user holds one of the required roles.
 *
 * Usage in routes:
 *   Route::middleware('role:ADMIN')->...
 *   Route::middleware('role:PROVIDER,ADMIN')->...
 */
class EnsureRole
{
    public function handle(Request $request, Closure $next, string ...$roles): Response
    {
        $user = $request->user();

        if (! $user || ! in_array($user->role, $roles, true)) {
            throw new ForbiddenException();
        }

        return $next($request);
    }
}
