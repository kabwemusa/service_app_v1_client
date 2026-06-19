<?php

namespace App\Http\Requests\Admin;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Reason (+ optional suspension duration) for a moderation action on a user
 * (warn / suspend / ban / reinstate). Min-10 reason mirrors the frontend
 * ConfirmWithReason and AuditedMutationService.
 *
 * `duration_days` is only meaningful for suspend; other actions ignore it.
 */
class UserModerationRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // capability enforced by the admin.can middleware
    }

    public function rules(): array
    {
        return [
            'reason'        => ['required', 'string', 'min:10', 'max:1000'],
            'duration_days' => ['nullable', 'integer', 'min:1', 'max:365'],
        ];
    }
}
