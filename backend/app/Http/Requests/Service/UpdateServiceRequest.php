<?php

namespace App\Http\Requests\Service;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class UpdateServiceRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        $publishing = fn () => $this->input('status') === 'ACTIVE';

        return [
            'category_id'             => ['sometimes', 'integer', 'exists:categories,id'],
            'title'                   => ['sometimes', 'string', 'max:80'],
            'description'             => ['sometimes', 'nullable', 'string', 'max:1000'],
            // Outcome-based pricing: when switching pricing_model, its parameters travel with it.
            'pricing_model'           => ['sometimes', 'string', 'in:OUTCOME_FIXED,PROVIDER_SCOPE,HOURLY_CAPPED,QUOTE_DEPOSIT'],
            // A DRAFT/PAUSED listing may carry no price; required only when publishing ACTIVE.
            'base_price'              => [
                'sometimes', 'nullable', 'numeric', 'min:0.01', 'max:99999.99',
                Rule::requiredIf(fn () => $publishing() && $this->input('pricing_model') === 'OUTCOME_FIXED'),
            ],
            'hourly_rate'             => [
                'sometimes', 'nullable', 'numeric', 'min:0.01', 'max:99999.99',
                Rule::requiredIf(fn () => $publishing() && in_array($this->input('pricing_model'), ['HOURLY_CAPPED', 'PROVIDER_SCOPE'], true)),
            ],
            'minimum_hours'           => [
                'sometimes', 'nullable', 'numeric', 'min:0.5', 'max:24', 'multiple_of:0.5',
                Rule::requiredIf(fn () => $publishing() && $this->input('pricing_model') === 'HOURLY_CAPPED'),
            ],
            'cap_hours'               => [
                'sometimes', 'nullable', 'numeric', 'min:0.5', 'max:24', 'multiple_of:0.5',
                Rule::requiredIf(fn () => $publishing() && $this->input('pricing_model') === 'HOURLY_CAPPED'),
            ],
            'deposit_percent'         => [
                'sometimes', 'nullable', 'integer', 'min:10', 'max:90',
                Rule::requiredIf(fn () => $publishing() && $this->input('pricing_model') === 'QUOTE_DEPOSIT'),
            ],
            'scope_prompts'           => ['sometimes', 'nullable', 'array', 'max:8'],
            'scope_prompts.*'         => ['string', 'max:120'],
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

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $v) {
            $min = $this->input('minimum_hours');
            $cap = $this->input('cap_hours');
            if ($min !== null && $cap !== null && (float) $cap < (float) $min) {
                $v->errors()->add('cap_hours', 'The spend cap must be at least the minimum hours.');
            }
        });
    }
}
