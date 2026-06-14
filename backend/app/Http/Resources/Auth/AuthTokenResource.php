<?php

namespace App\Http\Resources\Auth;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Shapes the JWT token payload returned to the client.
 * $this->resource = ['access_token' => ..., 'refresh_token' => ..., 'user' => User]
 */
class AuthTokenResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'access_token'  => $this->resource['access_token'],
            'refresh_token' => $this->resource['refresh_token'],
            'token_type'    => 'bearer',
            'expires_in'    => config('jwt.ttl') * 60,
            'user'          => [
                'id'              => $this->resource['user']->id,
                'email'           => $this->resource['user']->email,
                'phone'           => $this->resource['user']->phone,
                'role'            => $this->resource['user']->role,
                'is_verified'     => $this->resource['user']->is_verified,
                'completion_rate' => $this->resource['user']->completion_rate,
                'r_raw'           => $this->resource['user']->r_raw,
                'v_reviews'       => $this->resource['user']->v_reviews,
            ],
        ];
    }
}
