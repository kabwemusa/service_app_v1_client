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
            // A government ID may be submitted as photo(s) OR a single scanned
            // copy (PDF). NOTE: the `image` rule is deliberately NOT used here —
            // it rejects PDFs; `mimes` (incl. pdf) is the real allow-list.
            'document'      => ['required', 'file', 'max:8192', 'mimes:jpg,jpeg,png,webp,pdf'],
            'document_back' => ['nullable', 'file', 'max:8192', 'mimes:jpg,jpeg,png,webp,pdf'],
            // The selfie must be a photo (liveness face-match) — images only.
            'selfie'        => ['required', 'file', 'image', 'max:5120', 'mimes:jpg,jpeg,png,webp'],
        ];
    }
}
