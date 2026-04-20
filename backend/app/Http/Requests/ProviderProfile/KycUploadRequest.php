<?php

namespace App\Http\Requests\ProviderProfile;

use Illuminate\Foundation\Http\FormRequest;

class KycUploadRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'student_id' => ['required', 'file', 'mimes:jpeg,jpg,png,pdf', 'max:5120'], // 5 MB
        ];
    }
}
