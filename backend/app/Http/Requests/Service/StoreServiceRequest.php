<?php

namespace App\Http\Requests\Service;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class StoreServiceRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        $publishing = fn () => $this->input('status') === 'ACTIVE';

        return [
            'category_id'             => ['required', 'integer', 'exists:categories,id'],
            'title'                   => ['required', 'string', 'max:80'],
            'description'             => ['sometimes', 'nullable', 'string', 'max:1000'],
            // Outcome-based pricing: OUTCOME_FIXED | PROVIDER_SCOPE | HOURLY_CAPPED | QUOTE_DEPOSIT.
            // Customers never input hours — the provider owns every price parameter here.
            'pricing_model'           => ['required', 'string', 'in:OUTCOME_FIXED,PROVIDER_SCOPE,HOURLY_CAPPED,QUOTE_DEPOSIT'],
            // OUTCOME_FIXED: the fixed outcome price. Drafts may omit it; publishing requires it.
            'base_price'              => [
                'nullable', 'numeric', 'min:0.01', 'max:99999.99',
                Rule::requiredIf(fn () => $publishing() && $this->input('pricing_model') === 'OUTCOME_FIXED'),
            ],
            // HOURLY_CAPPED: rate + minimum + cap are all required to publish — no uncapped hourly.
            'hourly_rate'             => [
                'nullable', 'numeric', 'min:0.01', 'max:99999.99',
                Rule::requiredIf(fn () => $publishing() && in_array($this->input('pricing_model'), ['HOURLY_CAPPED', 'PROVIDER_SCOPE'], true)),
            ],
            'minimum_hours'           => [
                'nullable', 'numeric', 'min:0.5', 'max:24', 'multiple_of:0.5',
                Rule::requiredIf(fn () => $publishing() && $this->input('pricing_model') === 'HOURLY_CAPPED'),
            ],
            'cap_hours'               => [
                'nullable', 'numeric', 'min:0.5', 'max:24', 'multiple_of:0.5', 'gte:minimum_hours',
                Rule::requiredIf(fn () => $publishing() && $this->input('pricing_model') === 'HOURLY_CAPPED'),
            ],
            // QUOTE_DEPOSIT: deposit % of the eventual quote (default 30).
            'deposit_percent'         => [
                'nullable', 'integer', 'min:10', 'max:90',
                Rule::requiredIf(fn () => $publishing() && $this->input('pricing_model') === 'QUOTE_DEPOSIT'),
            ],
            // PROVIDER_SCOPE / QUOTE_DEPOSIT: structured brief questions asked of the customer.
            'scope_prompts'           => ['sometimes', 'nullable', 'array', 'max:8'],
            'scope_prompts.*'         => ['string', 'max:120'],
            'duration_estimate_mins'  => ['nullable', 'integer', 'min:1', 'max:1440'],
            'status'                  => ['sometimes', 'string', 'in:DRAFT,ACTIVE,PAUSED,HIDDEN'],
            'is_pinned'               => ['sometimes', 'boolean'],
            // Optional: defaults to the provider's base location when omitted
            // (one place to set "where you offer from"). Both required together.
            'latitude'                => ['nullable', 'numeric', 'between:-90,90', 'required_with:longitude'],
            'longitude'               => ['nullable', 'numeric', 'between:-180,180', 'required_with:latitude'],

            // §5.2 — "what's included" bullets, ordered by array position
            'inclusions'              => ['sometimes', 'array', 'max:20'],
            'inclusions.*'            => ['string', 'max:120'],

            // §5.3 — optional paid extras, ordered by array position
            'addons'                  => ['sometimes', 'array', 'max:20'],
            'addons.*.name'           => ['required', 'string', 'max:80'],
            'addons.*.price'          => ['required', 'numeric', 'min:0', 'max:99999.99'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $v) {
            // Cap must cover at least the minimum billable time (cap >= minimum × rate).
            $rate = (float) $this->input('hourly_rate', 0);
            $min  = (float) $this->input('minimum_hours', 0);
            $cap  = (float) $this->input('cap_hours', 0);
            if ($this->input('pricing_model') === 'HOURLY_CAPPED' && $rate > 0 && $min > 0 && $cap > 0 && $cap < $min) {
                $v->errors()->add('cap_hours', 'The spend cap must be at least the minimum hours.');
            }
        });
    }
}
