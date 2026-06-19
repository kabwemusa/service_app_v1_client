<?php

namespace App\Http\Requests\Admin;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Reason for a moderation action on a review (remove / restore / remove-response
 * / clear-flags). Min-10 reason mirrors ConfirmWithReason and AuditedMutationService.
 */
class ReviewModerationRequest extends FormRequest
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
