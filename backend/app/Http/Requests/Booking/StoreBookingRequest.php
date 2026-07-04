<?php

namespace App\Http\Requests\Booking;

use Illuminate\Foundation\Http\FormRequest;

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
            'delivery_lat'             => ['required', 'numeric', 'between:-90,90'],
            'delivery_lng'             => ['required', 'numeric', 'between:-180,180'],
            'delivery_location_label'  => ['required', 'string', 'max:255'],
            'delivery_location_region' => ['nullable', 'string', 'max:255'],
            'delivery_location_source' => ['required', 'string', 'in:DEVICE,SEARCH,SAVED'],
            'addon_ids'                => ['sometimes', 'array'],
            'addon_ids.*'              => ['integer', 'exists:service_addons,id'],
            'notes'                    => ['nullable', 'string', 'max:2000'],
            // PROVIDER_SCOPE / QUOTE_DEPOSIT — structured brief answers
            // (question/answer pairs from the provider's scope prompts).
            'scope_brief'              => ['sometimes', 'array', 'max:12'],
            'scope_brief.*.question'   => ['required_with:scope_brief', 'string', 'max:200'],
            'scope_brief.*.answer'     => ['required_with:scope_brief', 'string', 'max:500'],
        ];
    }
}
