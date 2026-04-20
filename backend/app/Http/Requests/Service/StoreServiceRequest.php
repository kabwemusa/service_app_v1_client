<?php

namespace App\Http\Requests\Service;

use Illuminate\Foundation\Http\FormRequest;

class StoreServiceRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'category_id'  => ['required', 'integer', 'exists:categories,id'],
            'title'        => ['required', 'string', 'max:100'],
            'description'  => ['sometimes', 'nullable', 'string', 'max:1000'],
            'base_price'   => ['required', 'numeric', 'min:0.01', 'max:99999.99'],
            'latitude'     => ['required', 'numeric', 'between:-90,90'],
            'longitude'    => ['required', 'numeric', 'between:-180,180'],
            'is_active'    => ['sometimes', 'boolean'],
        ];
    }
}
