<?php

namespace App\Http\Requests\Admin;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Add one or more of a user's identifiers to the hashed fraud denylist (§6.4).
 *
 * The caller picks WHICH identifier kinds to add; the service resolves the raw
 * value from the user record and stores only the SHA-256 hash (never the raw
 * value). `category` is the denylist reason enum; `reason` is the free-text
 * audit reason.
 */
class DenylistAddRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // capability enforced by the admin.can middleware (write:denylist, step-up)
    }

    public function rules(): array
    {
        return [
            'identifiers'   => ['required', 'array', 'min:1'],
            'identifiers.*' => ['string', 'in:PHONE_HASH,EMAIL_HASH,MOMO_NUMBER_HASH'],
            'category'      => ['required', 'string', 'in:CONFIRMED_FRAUD,SERIAL_DISPUTE,IDENTITY_FRAUD,OFF_PLATFORM_ATTEMPT,CHARGEBACK_ABUSE,ADMIN_MANUAL'],
            'reason'        => ['required', 'string', 'min:10', 'max:1000'],
        ];
    }
}
