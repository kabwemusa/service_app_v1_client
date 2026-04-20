<?php

namespace App\Http\Requests\Kyc;

use Illuminate\Foundation\Http\FormRequest;

class SubmitTier1Request extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'legal_name' => ['required', 'string', 'min:2', 'max:120'],
            'selfie'     => ['required', 'file', 'image', 'max:5120', 'mimes:jpg,jpeg,png,webp'],
        ];
    }
}
