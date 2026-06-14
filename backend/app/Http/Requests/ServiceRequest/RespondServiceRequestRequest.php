<?php

namespace App\Http\Requests\ServiceRequest;

use Illuminate\Foundation\Http\FormRequest;

class RespondServiceRequestRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            // ACCEPT = at the targeted service's listed price; QUOTE names a price
            'type'      => ['required', 'string', 'in:ACCEPT,QUOTE'],
            'price_zmw' => ['required_if:type,QUOTE', 'nullable', 'numeric', 'min:1', 'max:100000'],
            'message'   => ['nullable', 'string', 'max:300'],
        ];
    }
}
