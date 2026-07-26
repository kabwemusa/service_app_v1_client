<?php

namespace App\Http\Requests\Search;

use Illuminate\Foundation\Http\FormRequest;

class MatchRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // public endpoint (impression attributed when a token is present)
    }

    public function rules(): array
    {
        return [
            // The natural-language need. Required — this endpoint is the matcher.
            'query'       => ['required', 'string', 'min:1', 'max:160'],
            // Resolved delivery location L (never a user-typed radius). Optional —
            // matching finds WHAT regardless; location only biases WHO (ranking).
            'lat'         => ['nullable', 'numeric', 'between:-90,90'],
            'lng'         => ['nullable', 'numeric', 'between:-180,180'],
            'region'      => ['nullable', 'string', 'max:60'],
            'region_city' => ['nullable', 'string', 'max:80'],
            'region_ward' => ['nullable', 'string', 'max:80'],
            'page'        => ['nullable', 'integer', 'min:1'],
        ];
    }
}
