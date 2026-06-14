<?php

namespace App\Http\Requests\Admin;

use Illuminate\Foundation\Http\FormRequest;

class AdminLoginRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            // The panel labels this "Email or username"; accept either. Not
            // constrained to an email format so usernames work.
            'email'    => ['required', 'string', 'max:255'],
            'password' => ['required', 'string'],
        ];
    }
}
