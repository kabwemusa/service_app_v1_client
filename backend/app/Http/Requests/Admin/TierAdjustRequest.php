<?php

namespace App\Http\Requests\Admin;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Admin tier adjustment (§4.1: tier is monotonic and only changes by admin
 * action — a fraud downgrade, or correcting verification state). The full KYC
 * review lives in the Verification module; this only sets the integer tier.
 */
class TierAdjustRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // capability enforced by the admin.can middleware
    }

    public function rules(): array
    {
        return [
            'tier'   => ['required', 'integer', 'between:0,4'],
            'reason' => ['required', 'string', 'min:10', 'max:1000'],
        ];
    }
}
