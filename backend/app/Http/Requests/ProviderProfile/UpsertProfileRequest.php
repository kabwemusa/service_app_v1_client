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
            'display_name'       => ['sometimes', 'nullable', 'string', 'max:80'],
            'bio'                => ['sometimes', 'nullable', 'string', 'max:1000'],
            'nrc_number'         => ['sometimes', 'string', 'max:20',
                                     Rule::unique('provider_profiles', 'nrc_number')
                                         ->ignore($this->user()->id, 'user_id')],
            'momo_provider'      => ['sometimes', 'string', Rule::in(['MTN', 'AIRTEL', 'ZAMTEL'])],
            'momo_number'        => ['sometimes', 'string', 'max:20'],
            'base_location_lat'  => ['sometimes', 'numeric', 'between:-90,90'],
            'base_location_lng'  => ['sometimes', 'numeric', 'between:-180,180'],
            'max_radius_km'      => ['sometimes', 'integer', 'min:1', 'max:50'],
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
