<?php

namespace App\Http\Requests\Location;

use Illuminate\Foundation\Http\FormRequest;

class SearchPlacesRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'q' => ['required', 'string', 'min:2', 'max:200'],
            // Optional device-coordinate relevance hint (expo-location). Both
            // must be present to bias; absent ⇒ falls back to the Lusaka centre.
            // Backward-compatible: existing clients send neither.
            'lat' => ['nullable', 'numeric', 'between:-90,90', 'required_with:lng'],
            'lng' => ['nullable', 'numeric', 'between:-180,180', 'required_with:lat'],
        ];
    }
}
