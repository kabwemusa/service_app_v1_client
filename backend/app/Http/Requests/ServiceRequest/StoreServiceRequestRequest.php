<?php

namespace App\Http\Requests\ServiceRequest;

use Illuminate\Foundation\Http\FormRequest;

class StoreServiceRequestRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'category_id'     => ['required', 'integer', 'exists:categories,id'],
            'description'     => ['required', 'string', 'min:10', 'max:500'],
            // Resolved delivery location L — same contract as bookings (v3.1 §4.5-B)
            'delivery_lat'    => ['required', 'numeric', 'between:-90,90'],
            'delivery_lng'    => ['required', 'numeric', 'between:-180,180'],
            'delivery_label'  => ['nullable', 'string', 'max:255'],
            'delivery_region' => ['nullable', 'string', 'max:60'],
            'delivery_source' => ['nullable', 'string', 'in:DEVICE,SEARCH,SAVED'],
            'window_start'    => ['required', 'date', 'after:now'],
            'window_end'      => ['required', 'date', 'after:window_start'],
            'budget_zmw'      => ['nullable', 'numeric', 'min:1', 'max:100000'],
        ];
    }
}
