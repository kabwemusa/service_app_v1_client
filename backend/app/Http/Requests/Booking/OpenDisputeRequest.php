<?php

namespace App\Http\Requests\Booking;

use Illuminate\Foundation\Http\FormRequest;

class OpenDisputeRequest extends FormRequest
{
    public function authorize(): bool { return true; }

    public function rules(): array
    {
        return [
            'reason_category' => ['required', 'string', 'in:NOT_DELIVERED,QUALITY_ISSUE,WRONG_ITEM,DAMAGE,NO_SHOW,SAFETY,OTHER'],
            'description'     => ['required', 'string', 'min:20', 'max:2000'],
            'evidence'        => ['sometimes', 'array', 'max:10'],
            'evidence.*'      => ['string', 'max:500'],   // S3 keys
        ];
    }
}
