<?php

namespace App\Http\Requests\Category;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateCategoryRequest extends FormRequest
{
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
            // commission_band may be updated but must not be blanked out
            'commission_band' => ['sometimes', 'required', 'string', 'max:50'],
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
