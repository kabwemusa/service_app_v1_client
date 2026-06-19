<?php

namespace App\Http\Requests\Admin;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Reassign a service to a different category (must be a valid §8.1-banded
 * category — band validity is re-checked server-side in the service layer).
 */
class ServiceReassignCategoryRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // capability enforced by the admin.can middleware
    }

    public function rules(): array
    {
        return [
            'category_id' => ['required', 'integer', 'exists:categories,id'],
            'reason'      => ['required', 'string', 'min:10', 'max:1000'],
        ];
    }
}
