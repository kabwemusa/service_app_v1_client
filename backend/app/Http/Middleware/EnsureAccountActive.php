<?php

namespace App\Http\Middleware;

use App\Enums\ErrorCode;
use App\Exceptions\Api\ApiException;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;
use Tymon\JWTAuth\Facades\JWTAuth;

/**
 * Runs after `auth:api` on every authenticated request. Makes a ban/suspend
 * take effect within seconds instead of waiting out the JWT's TTL:
 *
 *   - Rejects the token if it was issued before the user's
 *     session_invalidated_at watermark (set by AuthService::invalidateAllSessions
 *     when an admin bans/suspends the account).
 *   - Rejects the request outright if the account is currently BANNED or
 *     SUSPENDED, even for a token issued after the watermark (covers a
 *     re-ban or a token issued in the same second).
 */
class EnsureAccountActive
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if ($user) {
            if (in_array($user->account_state, ['BANNED', 'SUSPENDED'], true)) {
                throw new ApiException(
                    ErrorCode::UNAUTHENTICATED,
                    'Your account is no longer active. Please contact support.',
                );
            }

            if ($user->session_invalidated_at) {
                $issuedAt = JWTAuth::getPayload(JWTAuth::getToken())->get('iat');
                if ($issuedAt !== null && $issuedAt < $user->session_invalidated_at->getTimestamp()) {
                    throw new ApiException(
                        ErrorCode::UNAUTHENTICATED,
                        'Your session is no longer valid. Please log in again.',
                    );
                }
            }
        }

        return $next($request);
    }
}
