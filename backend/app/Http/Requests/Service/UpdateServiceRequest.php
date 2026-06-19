<?php

namespace App\Http\Requests\Service;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateServiceRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'category_id'             => ['sometimes', 'integer', 'exists:categories,id'],
            'title'                   => ['sometimes', 'string', 'max:80'],
            'description'             => ['sometimes', 'nullable', 'string', 'max:1000'],
            // §5.1: when switching pricing_model in the same request, price travels with it.
            'pricing_model'           => ['sometimes', 'string', 'in:FIXED,HOURLY,QUOTE'],
            // A DRAFT/PAUSED listing may carry no price; price is only required when the
            // request publishes the listing ACTIVE under FIXED/HOURLY (publish-validation model).
            'base_price'              => [
                'sometimes', 'nullable', 'numeric', 'min:0.01', 'max:99999.99',
                'prohibited_if:pricing_model,QUOTE',
                Rule::requiredIf(fn () =>
                    $this->input('status') === 'ACTIVE'
                    && in_array($this->input('pricing_model'), ['FIXED', 'HOURLY'], true)
                ),
            ],
            'duration_estimate_mins'  => ['sometimes', 'nullable', 'integer', 'min:1', 'max:1440'],
            'status'                  => ['sometimes', 'string', 'in:DRAFT,ACTIVE,PAUSED,HIDDEN'],
            'is_pinned'               => ['sometimes', 'boolean'],
            'latitude'                => ['sometimes', 'numeric', 'between:-90,90'],
            'longitude'               => ['sometimes', 'numeric', 'between:-180,180'],

            // §5.2 — full ordered replacement (add/remove/reorder land in one save)
            'inclusions'              => ['sometimes', 'array', 'max:20'],
            'inclusions.*'            => ['string', 'max:120'],

            // §5.3 — full ordered replacement (add/remove/reorder land in one save)
            'addons'                  => ['sometimes', 'array', 'max:20'],
            'addons.*.name'           => ['required', 'string', 'max:80'],
            'addons.*.price'          => ['required', 'numeric', 'min:0', 'max:99999.99'],
        ];
    }
}
