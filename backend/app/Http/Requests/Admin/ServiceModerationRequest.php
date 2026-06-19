<?php

namespace App\Http\Requests\Admin;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Reason for a moderation action on a service listing (hide / require-changes /
 * restore / remove-photo). Min-10 reason mirrors the frontend ConfirmWithReason
 * and AuditedMutationService.
 */
class ServiceModerationRequest extends FormRequest
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
