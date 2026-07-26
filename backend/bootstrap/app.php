<?php

use App\Enums\ErrorCode;
use App\Exceptions\Api\ApiException;
use App\Support\ApiResponse;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Symfony\Component\HttpKernel\Exception\ThrottleRequestsException;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        channels: __DIR__.'/../routes/channels.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->alias([
            'role'           => \App\Http\Middleware\EnsureRole::class,
            'admin.can'      => \App\Http\Middleware\EnsureAdminCapability::class,
            'account.active' => \App\Http\Middleware\EnsureAccountActive::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {

        // Every /api/* route returns JSON errors, even when the caller sent no
        // Accept header (e.g. an <img>/fetch hitting a streaming endpoint). This
        // keeps the API on one error envelope and avoids falling through to the
        // HTML error renderer (§ API-1). The render closures below still guard on
        // expectsJson(), which this makes true for API requests.
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson()
        );

        // Domain exceptions — thrown intentionally by services
        $exceptions->render(function (ApiException $e, Request $request) {
            if ($request->expectsJson() || $request->is('api/*')) {
                return ApiResponse::error(
                    $e->getMessage(),
                    $e->getErrorCode()->value,
                    $e->getHttpStatus(),
                    $e->getErrors(),
                );
            }
        });

        // Laravel validation — triggered by Form Request classes
        $exceptions->render(function (ValidationException $e, Request $request) {
            if ($request->expectsJson() || $request->is('api/*')) {
                return ApiResponse::error(
                    'The given data was invalid.',
                    ErrorCode::VALIDATION_ERROR->value,
                    422,
                    $e->errors(),
                );
            }
        });

        // Unauthenticated — JWT guard could not resolve user
        $exceptions->render(function (AuthenticationException $e, Request $request) {
            if ($request->expectsJson() || $request->is('api/*')) {
                return ApiResponse::error(
                    'You are not authenticated. Please log in.',
                    ErrorCode::UNAUTHENTICATED->value,
                    401,
                );
            }
        });

        // JWT errors (missing / invalid / expired token) — base class covers
        // TokenExpiredException, TokenInvalidException, etc. Without this they
        // surface as 500 instead of an actionable 401.
        $exceptions->render(function (\Tymon\JWTAuth\Exceptions\JWTException $e, Request $request) {
            if ($request->expectsJson() || $request->is('api/*')) {
                return ApiResponse::error(
                    'Your session is invalid or has expired. Please log in again.',
                    ErrorCode::UNAUTHENTICATED->value,
                    401,
                );
            }
        });

        // Rate limiting (429) — friendly, with Retry-After preserved.
        $exceptions->render(function (ThrottleRequestsException $e, Request $request) {
            if ($request->expectsJson() || $request->is('api/*')) {
                return ApiResponse::error(
                    'Too many requests. Please slow down and try again shortly.',
                    ErrorCode::RATE_LIMITED->value,
                    429,
                )->withHeaders($e->getHeaders());
            }
        });

        // Missing model / missing route → a clean 404 (never a framework page or
        // a leaked model class name).
        $exceptions->render(function (ModelNotFoundException $e, Request $request) {
            if ($request->expectsJson() || $request->is('api/*')) {
                return ApiResponse::error('The requested resource was not found.', ErrorCode::NOT_FOUND->value, 404);
            }
        });
        $exceptions->render(function (NotFoundHttpException $e, Request $request) {
            if ($request->expectsJson() || $request->is('api/*')) {
                return ApiResponse::error('The requested resource was not found.', ErrorCode::NOT_FOUND->value, 404);
            }
        });

        // Authorization failures (Gate/policy) → 403.
        $exceptions->render(function (AuthorizationException $e, Request $request) {
            if ($request->expectsJson() || $request->is('api/*')) {
                return ApiResponse::error('You are not allowed to perform this action.', ErrorCode::FORBIDDEN->value, 403);
            }
        });

        // ── Catch-all (MUST be last) ─────────────────────────────────────────
        // Anything not handled above — QueryException, TypeError, RuntimeException
        // — must NEVER leak SQL, stack traces, column names or internal messages
        // to a client. We return a generic 500 with a correlation id and log the
        // full detail server-side under that id. Non-500 HttpExceptions keep
        // their status but still get a safe generic message.
        $exceptions->render(function (\Throwable $e, Request $request) {
            if (! $request->expectsJson() && ! $request->is('api/*')) {
                return null; // let the default (web) handler deal with it
            }

            $status = $e instanceof HttpExceptionInterface ? $e->getStatusCode() : 500;
            $correlationId = (string) Str::uuid();

            Log::error('Unhandled API exception', [
                'correlation_id' => $correlationId,
                'exception'      => $e::class,
                'message'        => $e->getMessage(),
                'status'         => $status,
                'path'           => $request->path(),
                'method'         => $request->method(),
                'user_id'        => optional($request->user())->getAuthIdentifier(),
                'trace'          => $e->getTraceAsString(),
            ]);

            $message = $status < 500
                ? ($e->getMessage() ?: 'Request could not be completed.')
                : 'Something went wrong on our end. Please try again.';

            return ApiResponse::error(
                $message,
                $status < 500 ? ErrorCode::VALIDATION_ERROR->value : ErrorCode::SERVER_ERROR->value,
                $status,
                ['correlation_id' => $correlationId],
            );
        });

    })->create();
