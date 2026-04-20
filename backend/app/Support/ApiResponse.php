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
