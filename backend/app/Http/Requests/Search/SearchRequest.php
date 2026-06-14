<?php

namespace App\Http\Requests\Search;

use Illuminate\Foundation\Http\FormRequest;

class SearchRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // public endpoint
    }

    public function rules(): array
    {
        return [
            // v3.1 §4.6: no customer-facing radius control. `lat`/`lng` are the
            // resolved delivery location L (device GPS, saved place, or search pick) —
            // never typed by the user. Candidate radius is derived server-side from
            // the provider's own service_radius_km capped by MAX_SEARCH_RADIUS_KM (§4.4).
            'query'       => ['nullable', 'string', 'max:100'],
            'lat'         => ['nullable', 'numeric', 'between:-90,90'],
            'lng'         => ['nullable', 'numeric', 'between:-180,180'],
            'category_id' => ['nullable', 'integer', 'exists:categories,id'],
            // Province label of the active delivery location — promoted-slot
            // inventory is auctioned per category × region (v3.2 §1.5).
            'region'      => ['nullable', 'string', 'max:60'],
            'page'        => ['nullable', 'integer', 'min:1'],
            // Browse filters (v3.1 §6 Filters sheet)
            'max_price'         => ['nullable', 'numeric', 'min:0'],
            'availability'      => ['nullable', 'string', 'in:any,today,week,date'],
            'availability_date' => ['nullable', 'date', 'required_if:availability,date'],
            'verified_id'       => ['nullable', 'boolean'],
            'top_rated'         => ['nullable', 'boolean'],
            'min_tier'          => ['nullable', 'integer', 'in:0,2,3,4'],
            'languages'         => ['nullable', 'string', 'max:50'], // comma-joined codes: en,ny,bem,ton
            'sort'              => ['nullable', 'string', 'in:recommended,top_rated,price_asc,fastest,nearest'],
        ];
    }
}
