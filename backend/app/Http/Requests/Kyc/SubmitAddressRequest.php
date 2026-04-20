<?php

namespace App\Http\Requests\Kyc;

use Illuminate\Foundation\Http\FormRequest;

class SubmitAddressRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'document' => ['required', 'file', 'max:10240', 'mimes:jpg,jpeg,png,webp,pdf'],
        ];
    }

    public function messages(): array
    {
        return [
            'document.mimes' => 'Accepted formats: JPG, PNG, or PDF (utility bill, lease, bank statement).',
        ];
    }
}
