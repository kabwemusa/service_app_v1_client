<?php

namespace App\Http\Requests\Category;

use Illuminate\Foundation\Http\FormRequest;

class StoreCategoryRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'parent_id'       => ['sometimes', 'nullable', 'integer', 'exists:categories,id'],
            'name'            => ['required', 'string', 'max:80', 'unique:categories,name'],
            'slug'            => ['sometimes', 'nullable', 'string', 'max:100', 'unique:categories,slug', 'regex:/^[a-z0-9-]+$/'],
            'synonyms'        => ['sometimes', 'array'],
            'synonyms.*'      => ['string', 'max:80'],
            'icon_url'        => ['sometimes', 'nullable', 'string', 'max:500'],
            'icon'            => ['sometimes', 'nullable', 'string', 'max:100'],
            'is_active'       => ['sometimes', 'boolean'],
            'display_order'   => ['sometimes', 'integer', 'min:0'],
            // commission_band is REQUIRED — a category without one breaks the revenue ledger (v3 §8.1)
            'commission_band' => ['required', 'string', 'max:50'],
        ];
    }

    public function messages(): array
    {
        return [
            'commission_band.required' => 'Every category must have a commission_band (v3 §8.1).',
        ];
    }
}
