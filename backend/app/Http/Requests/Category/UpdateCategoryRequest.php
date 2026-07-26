<?php

namespace App\Http\Requests\Category;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateCategoryRequest extends FormRequest
{
    /** The immutable pricing-model enum (labels/guidance vary; these do not). */
    public const MODELS = ['OUTCOME_FIXED', 'PROVIDER_SCOPE', 'HOURLY_CAPPED', 'QUOTE_DEPOSIT'];

    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        $id = $this->route('category');

        return [
            'parent_id'     => ['sometimes', 'nullable', 'integer', 'exists:categories,id',
                                Rule::notIn([$id])], // cannot be its own parent
            'name'          => ['sometimes', 'string', 'max:80',
                                Rule::unique('categories', 'name')->ignore($id)],
            'slug'          => ['sometimes', 'string', 'max:100', 'regex:/^[a-z0-9-]+$/',
                                Rule::unique('categories', 'slug')->ignore($id)],
            'synonyms'      => ['sometimes', 'array'],
            'synonyms.*'    => ['string', 'max:80'],
            'icon_url'      => ['sometimes', 'nullable', 'string', 'max:500'],
            'icon'          => ['sometimes', 'nullable', 'string', 'max:100'],
            'is_active'     => ['sometimes', 'boolean'],
            'display_order' => ['sometimes', 'integer', 'min:0'],
            // commission_band may be updated but must not be blanked out once set.
            // Changing it additionally requires categories.set_band (enforced in controller).
            'commission_band'    => ['sometimes', 'nullable', 'string', 'max:50'],
            'commission_rates'   => ['sometimes', 'nullable', 'array'],
            'commission_rates.*' => ['numeric', 'min:0', 'max:1'],
            // Category-driven pricing guidance (selection guidance + copy only).
            'default_pricing_model'        => ['sometimes', 'nullable', 'string', Rule::in(self::MODELS)],
            'recommended_pricing_models'   => ['sometimes', 'nullable', 'array', 'max:4'],
            'recommended_pricing_models.*' => ['string', Rule::in(self::MODELS)],
            'pricing_rationale'            => ['sometimes', 'nullable', 'string', 'max:400'],
            'pricing_mismatch_warning'     => ['sometimes', 'nullable', 'string', 'max:600'],
            'reason'             => ['sometimes', 'string', 'min:10', 'max:1000'],
        ];
    }

    public function messages(): array
    {
        return [
            'commission_band.required' => 'commission_band cannot be removed from a category (v3 §8.1).',
            'parent_id.not_in'         => 'A category cannot be its own parent.',
        ];
    }
}
