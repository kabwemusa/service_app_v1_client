<?php

namespace App\Http\Requests\Search;

use Illuminate\Foundation\Http\FormRequest;

class SearchRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // public endpoint
    }

    public function rules(): array
    {
        $maxRadius = config('search.search.max_radius_km', 10);

        return [
            'query'       => ['nullable', 'string', 'max:100'],
            'lat'         => ['required', 'numeric', 'between:-90,90'],
            'lng'         => ['required', 'numeric', 'between:-180,180'],
            'radius_km'   => ['nullable', 'integer', "between:1,{$maxRadius}"],
            'category_id' => ['nullable', 'integer', 'exists:categories,id'],
            'page'        => ['nullable', 'integer', 'min:1'],
        ];
    }
}
