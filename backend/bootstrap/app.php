<?php

use App\Enums\ErrorCode;
use App\Exceptions\Api\ApiException;
use App\Support\ApiResponse;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->alias([
            'role'      => \App\Http\Middleware\EnsureRole::class,
            'admin.can' => \App\Http\Middleware\EnsureAdminCapability::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {

        // Domain exceptions — thrown intentionally by services
        $exceptions->render(function (ApiException $e, Request $request) {
            if ($request->expectsJson()) {
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
            if ($request->expectsJson()) {
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
            if ($request->expectsJson()) {
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
            if ($request->expectsJson()) {
                return ApiResponse::error(
                    'Your session is invalid or has expired. Please log in again.',
                    ErrorCode::UNAUTHENTICATED->value,
                    401,
                );
            }
        });

    })->create();
