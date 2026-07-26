<?php

namespace App\Http\Requests\Category;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

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
            // commission_band is optional on create — categories may be created as DRAFT (inactive)
            // without a band. Activation (is_active=true) is rejected server-side in CategoryService
            // if commission_band is not set (v3 §8.1).
            'commission_band' => ['sometimes', 'nullable', 'string', 'max:50'],
            'commission_rates' => ['sometimes', 'nullable', 'array'],
            'commission_rates.*' => ['numeric', 'min:0', 'max:1'],
            // Category-driven pricing guidance (selection guidance + copy only).
            'default_pricing_model'        => ['sometimes', 'nullable', 'string', Rule::in(UpdateCategoryRequest::MODELS)],
            'recommended_pricing_models'   => ['sometimes', 'nullable', 'array', 'max:4'],
            'recommended_pricing_models.*' => ['string', Rule::in(UpdateCategoryRequest::MODELS)],
            'pricing_rationale'            => ['sometimes', 'nullable', 'string', 'max:400'],
            'pricing_mismatch_warning'     => ['sometimes', 'nullable', 'string', 'max:600'],
            'reason'          => ['sometimes', 'string', 'min:10', 'max:1000'],
        ];
    }
}
