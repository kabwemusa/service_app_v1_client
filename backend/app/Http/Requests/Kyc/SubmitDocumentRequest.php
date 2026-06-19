<?php

namespace App\Http\Requests\Kyc;

use Illuminate\Foundation\Http\FormRequest;

class SubmitDocumentRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'doc_type'      => ['required', 'in:NRC,PASSPORT,DRIVERS_LICENSE'],
            'document'      => ['required', 'file', 'image', 'max:5120', 'mimes:jpg,jpeg,png,webp,pdf'],
            'document_back' => ['nullable', 'file', 'image', 'max:5120', 'mimes:jpg,jpeg,png,webp,pdf'],
            'selfie'        => ['required', 'file', 'image', 'max:5120', 'mimes:jpg,jpeg,png,webp'],
        ];
    }
}
