<?php

namespace App\Http\Requests\Admin;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Reason for an audited verification decision (approve / reject / request-info).
 * Min 10 chars mirrors the frontend ConfirmWithReason + AuditedMutationService.
 */
class VerificationDecisionRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // capability enforced by the admin.can middleware
    }

    public function rules(): array
    {
        return [
            'reason' => ['required', 'string', 'min:10', 'max:1000'],
        ];
    }
}
