<?php

namespace App\Http\Requests\Auth;

use Illuminate\Foundation\Http\FormRequest;

class RegisterRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            // Either email or phone is required, but not necessarily both
            'email'    => ['required_without:phone', 'nullable', 'email', 'unique:users,email', 'max:255'],
            'phone'    => ['required_without:email', 'nullable', 'string', 'regex:/^\+?[1-9]\d{7,14}$/', 'unique:users,phone'],
            'password' => ['required', 'string', 'min:10'],
            'role'     => ['sometimes', 'in:CUSTOMER,PROVIDER'],
            'referral_code' => ['sometimes', 'nullable', 'string', 'size:8', 'exists:users,referral_code'],
        ];
    }

    public function messages(): array
    {
        return [
            'email.required_without'  => 'An email or phone number is required.',
            'phone.required_without'  => 'An email or phone number is required.',
            'phone.regex'             => 'Phone number must be in E.164 format (e.g. +260971234567).',
            'password.min'            => 'Password must be at least 10 characters.',
            'referral_code.exists'    => 'Invalid referral code.',
        ];
    }
}
