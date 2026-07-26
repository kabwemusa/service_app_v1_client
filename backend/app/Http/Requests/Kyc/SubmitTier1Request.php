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
            // § CTR-1 — NRC is mandatory at Tier 1. Zambian NRC canonical format
            // is 6 digits / 2 digits / 1 check digit, e.g. 123456/78/1.
            'nrc_number' => ['required', 'string', 'regex:/^\d{6}\/\d{2}\/\d$/'],
            'selfie'     => ['required', 'file', 'image', 'max:5120', 'mimes:jpg,jpeg,png,webp'],
        ];
    }

    public function messages(): array
    {
        return [
            'nrc_number.regex' => 'Enter your NRC in the format 123456/78/1.',
        ];
    }

    protected function prepareForValidation(): void
    {
        if ($this->has('nrc_number')) {
            // Collapse spaces so "123456 / 78 / 1" still validates.
            $this->merge(['nrc_number' => preg_replace('/\s+/', '', (string) $this->input('nrc_number'))]);
        }
    }
}
