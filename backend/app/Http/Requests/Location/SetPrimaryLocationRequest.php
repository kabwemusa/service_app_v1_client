<?php

namespace App\Http\Requests\Location;

use Illuminate\Foundation\Http\FormRequest;

class SetPrimaryLocationRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'lat'    => ['required', 'numeric', 'between:-90,90'],
            'lng'    => ['required', 'numeric', 'between:-180,180'],
            'label'  => ['required', 'string', 'max:255'],
            'region' => ['nullable', 'string', 'max:255'],
            'source' => ['required', 'string', 'in:DEVICE,SEARCH'],
        ];
    }
}
