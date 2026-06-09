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
            'scheduled_end'   => ['required', 'date', 'after:scheduled_start'],
            'delivery_lat'             => ['required', 'numeric', 'between:-90,90'],
            'delivery_lng'             => ['required', 'numeric', 'between:-180,180'],
            'delivery_location_label'  => ['required', 'string', 'max:255'],
            'delivery_location_region' => ['nullable', 'string', 'max:255'],
            'delivery_location_source' => ['required', 'string', 'in:DEVICE,SEARCH,SAVED'],
        ];
    }
}
