<?php

namespace App\Http\Requests\ProviderProfile;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpsertProfileRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // role:PROVIDER guard handled at route level
    }

    public function rules(): array
    {
        return [
            // v3.1 §6.6 — display_name vs legal name (legal name lives on `users`)
            'display_name'       => ['sometimes', 'nullable', 'string', 'max:80'],
            'bio'                => ['sometimes', 'nullable', 'string', 'max:500'],
            'year_started'       => ['sometimes', 'nullable', 'integer', 'min:1980', 'max:' . now()->year],
            // v3.1 §6.6 AC — "language set limited to supported codes" (en/ny/bem/ton)
            'languages'          => ['sometimes', 'array', 'max:4'],
            'languages.*'        => ['string', Rule::in(['en', 'ny', 'bem', 'ton'])],
            'nrc_number'         => ['sometimes', 'string', 'max:20',
                                     Rule::unique('provider_profiles', 'nrc_number')
                                         ->ignore($this->user()->id, 'user_id')],
            'momo_provider'      => ['sometimes', 'string', Rule::in(['MTN', 'AIRTEL', 'ZAMTEL'])],
            'momo_number'        => ['sometimes', 'string', 'max:20'],
            'base_location_lat'  => ['sometimes', 'numeric', 'between:-90,90'],
            'base_location_lng'  => ['sometimes', 'numeric', 'between:-180,180'],
            // Radius retired (v3.1 §4.4): candidacy widens by region tier, not
            // distance. `max_radius_km` / `service_radius_km` are no longer
            // accepted or used — the provider's base location is all we need.
            'highlights'                       => ['sometimes', 'array'],
            'highlights.pinned_service_ids'    => ['sometimes', 'array', 'max:6'],
            'highlights.pinned_service_ids.*'  => ['string'],
            'highlights.featured_photo_keys'   => ['sometimes', 'array', 'max:6'],
            'highlights.featured_photo_keys.*' => ['string'],
            'highlights.featured_badges'       => ['sometimes', 'array', 'max:6'],
            'highlights.featured_badges.*'     => ['string'],
            'availability_matrix' => ['sometimes', 'array'],
            'availability_matrix.MON' => ['sometimes', 'array'],
            'availability_matrix.TUE' => ['sometimes', 'array'],
            'availability_matrix.WED' => ['sometimes', 'array'],
            'availability_matrix.THU' => ['sometimes', 'array'],
            'availability_matrix.FRI' => ['sometimes', 'array'],
            'availability_matrix.SAT' => ['sometimes', 'array'],
            'availability_matrix.SUN' => ['sometimes', 'array'],
            'availability_matrix.*.*.start' => ['sometimes', 'date_format:H:i'],
            'availability_matrix.*.*.end'   => ['sometimes', 'date_format:H:i'],
        ];
    }
}
