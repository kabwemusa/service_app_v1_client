<?php

namespace App\Http\Requests\Service;

use Illuminate\Foundation\Http\FormRequest;

class UpdateServiceRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'category_id'  => ['sometimes', 'integer', 'exists:categories,id'],
            'title'        => ['sometimes', 'string', 'max:100'],
            'description'  => ['sometimes', 'nullable', 'string', 'max:1000'],
            'base_price'   => ['sometimes', 'numeric', 'min:0.01', 'max:99999.99'],
            'latitude'     => ['sometimes', 'numeric', 'between:-90,90'],
            'longitude'    => ['sometimes', 'numeric', 'between:-180,180'],
            'is_active'    => ['sometimes', 'boolean'],
        ];
    }
}
