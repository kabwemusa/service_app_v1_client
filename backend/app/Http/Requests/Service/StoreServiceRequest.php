<?php

namespace App\Http\Requests\Service;

use Illuminate\Foundation\Http\FormRequest;

class StoreServiceRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'category_id'             => ['required', 'integer', 'exists:categories,id'],
            'title'                   => ['required', 'string', 'max:80'],
            'description'             => ['sometimes', 'nullable', 'string', 'max:1000'],
            // §5.1: FIXED/HOURLY carry a rate; QUOTE hides price and routes through "Send quote".
            'pricing_model'           => ['required', 'string', 'in:FIXED,HOURLY,QUOTE'],
            'base_price'              => [
                'nullable', 'numeric', 'min:0.01', 'max:99999.99',
                'required_if:pricing_model,FIXED,HOURLY',
                'prohibited_if:pricing_model,QUOTE',
            ],
            'duration_estimate_mins'  => ['nullable', 'integer', 'min:1', 'max:1440'],
            'status'                  => ['sometimes', 'string', 'in:DRAFT,ACTIVE,PAUSED,HIDDEN'],
            'is_pinned'               => ['sometimes', 'boolean'],
            'latitude'                => ['required', 'numeric', 'between:-90,90'],
            'longitude'               => ['required', 'numeric', 'between:-180,180'],

            // §5.2 — "what's included" bullets, ordered by array position
            'inclusions'              => ['sometimes', 'array', 'max:20'],
            'inclusions.*'            => ['string', 'max:120'],

            // §5.3 — optional paid extras, ordered by array position
            'addons'                  => ['sometimes', 'array', 'max:20'],
            'addons.*.name'           => ['required', 'string', 'max:80'],
            'addons.*.price'          => ['required', 'numeric', 'min:0', 'max:99999.99'],
        ];
    }
}
