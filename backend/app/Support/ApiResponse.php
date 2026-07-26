<?php

namespace App\Support;

use Illuminate\Http\JsonResponse;

final class ApiResponse
{
    /**
     * Return a successful JSON response.
     *
     * @param  mixed  $data     The payload — an ApiResource, array, or null.
     * @param  string $message  Human-readable success message.
     * @param  int    $status   HTTP status code (default 200).
     */
    public static function success(mixed $data, string $message = 'Success.', int $status = 200): JsonResponse
    {
        $body = [
            'success' => true,
            'message' => $message,
        ];

        if ($data !== null) {
            $body['data'] = $data;
        }

        return response()->json($body, $status);
    }

    /**
     * Return a paginated list in the canonical shape (§ API-1) — the same
     * `{ data, current_page, last_page, per_page, total }` envelope the booking,
     * review and notification endpoints use, so clients parse one shape.
     *
     * @param  \Illuminate\Contracts\Pagination\LengthAwarePaginator  $paginator
     * @param  array|null  $items  Pre-transformed items (e.g. a Resource collection); defaults to the paginator's items.
     */
    public static function paginated(
        \Illuminate\Contracts\Pagination\LengthAwarePaginator $paginator,
        mixed $items = null,
        string $message = 'Success.',
    ): JsonResponse {
        return self::success([
            'data'         => $items ?? $paginator->items(),
            'current_page' => $paginator->currentPage(),
            'last_page'    => $paginator->lastPage(),
            'per_page'     => $paginator->perPage(),
            'total'        => $paginator->total(),
        ], $message);
    }

    /**
     * Return an error JSON response.
     *
     * @param  string      $message   Human-readable error description.
     * @param  string      $code      ErrorCode enum value string.
     * @param  int         $status    HTTP status code.
     * @param  array|null  $errors    Field-level validation errors (optional).
     */
    public static function error(
        string $message,
        string $code,
        int $status,
        ?array $errors = null,
    ): JsonResponse {
        $body = [
            'success' => false,
            'message' => $message,
            'code'    => $code,
        ];

        if ($errors !== null) {
            $body['errors'] = $errors;
        }

        return response()->json($body, $status);
    }
}
