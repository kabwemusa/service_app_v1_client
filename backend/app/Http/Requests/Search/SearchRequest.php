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
            // never typed by the user. There is NO radius: candidacy widens by
            // region tier — area → city → province → national (§4.4) — resolved
            // server-side from lat/lng, or supplied via region_ward/region_city/region.
            'query'       => ['nullable', 'string', 'max:100'],
            'lat'         => ['nullable', 'numeric', 'between:-90,90'],
            'lng'         => ['nullable', 'numeric', 'between:-180,180'],
            'category_id' => ['nullable', 'integer', 'exists:categories,id'],
            // Delivery-location region tiers. `region` = province (also drives
            // promoted-slot inventory, §1.5). ward/city are optional finer tiers;
            // when omitted the server resolves them from lat/lng.
            'region'      => ['nullable', 'string', 'max:60'],
            'region_city' => ['nullable', 'string', 'max:80'],
            'region_ward' => ['nullable', 'string', 'max:80'],
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
