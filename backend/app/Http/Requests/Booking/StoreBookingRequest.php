<?php

namespace App\Http\Requests\Booking;

use App\Models\Service;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

class StoreBookingRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'service_id'      => ['required', 'uuid', 'exists:services,id'],
            'scheduled_start' => ['required', 'date', 'after:now'],
            // Optional — duration is a provider-set guide, never a customer input.
            // Omitted: derived from the service's estimate / cap hours.
            'scheduled_end'   => ['sometimes', 'nullable', 'date', 'after:scheduled_start'],
            // Location is optional for REMOTE (online) services — enforced for
            // in-person services in withValidator() below.
            'delivery_lat'             => ['nullable', 'numeric', 'between:-90,90'],
            'delivery_lng'             => ['nullable', 'numeric', 'between:-180,180'],
            'delivery_location_label'  => ['nullable', 'string', 'max:255'],
            'delivery_location_region' => ['nullable', 'string', 'max:255'],
            'delivery_location_source' => ['nullable', 'string', 'in:DEVICE,SEARCH,SAVED'],
            'addon_ids'                => ['sometimes', 'array'],
            'addon_ids.*'              => ['integer', 'exists:service_addons,id'],
            'notes'                    => ['nullable', 'string', 'max:2000'],
            // PROVIDER_SCOPE / QUOTE_DEPOSIT — structured brief answers
            // (question/answer pairs from the provider's scope prompts).
            'scope_brief'              => ['sometimes', 'array', 'max:12'],
            'scope_brief.*.question'   => ['required_with:scope_brief', 'string', 'max:200'],
            'scope_brief.*.answer'     => ['required_with:scope_brief', 'string', 'max:500'],
            // Double-submit protection (may also arrive as the Idempotency-Key header).
            'idempotency_key'          => ['sometimes', 'nullable', 'string', 'max:80'],
        ];
    }

    /**
     * In-person services need a pinned delivery location; remote (online)
     * services skip the location step entirely.
     */
    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $v) {
            $service = Service::find($this->input('service_id'));
            if ($service && ! $service->isRemote()) {
                foreach (['delivery_lat', 'delivery_lng', 'delivery_location_label', 'delivery_location_source'] as $field) {
                    if ($this->input($field) === null || $this->input($field) === '') {
                        $v->errors()->add($field, 'A delivery location is required for in-person services.');
                    }
                }
            }
        });
    }
}
