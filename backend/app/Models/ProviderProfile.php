<?php

namespace App\Models;

use App\Enums\TrustTier;
use Illuminate\Database\Eloquent\Model;

class ProviderProfile extends Model
{
    protected $primaryKey = 'user_id';
    public $incrementing = false;
    protected $keyType = 'string';

    protected $fillable = [
        'user_id',
        // Trust
        'trust_tier',
        'trust_score',
        'kyc_status',
        // Identity / display
        'display_name',
        'bio',
        'year_started',
        'languages',
        // Legacy KYC fields (kept during v2→v3 transition window)
        'nrc_number',
        'student_id_url',
        // Payment
        'momo_provider',
        'momo_number',
        // Location
        'base_location_lat',
        'base_location_lng',
        'base_location_label',
        'max_radius_km',
        'service_radius_km',
        // Schedule
        'availability_matrix',
        'accepting_bookings',
        // Responsiveness
        'response_time_p50_mins',
        'response_rate_7d',
        // Media
        'cover_image_url',
        // Public profile photo (distinct from the private KYC selfie — never expose KYC image here)
        'avatar_url',
        'portfolio_images',
        'certifications',
        // Highlights (v3.1 §5.4) — provider-curated "what shows first"
        'highlights',
        // Counters
        'profile_completeness',
        'cancellation_rate_30d',
        'repeat_client_rate',
    ];

    protected function casts(): array
    {
        return [
            'availability_matrix'   => 'array',
            'accepting_bookings'    => 'boolean',
            'portfolio_images'      => 'array',
            'certifications'        => 'array',
            'highlights'            => 'array',
            'languages'             => 'array',
            'base_location_lat'     => 'float',
            'base_location_lng'     => 'float',
            'trust_score'           => 'float',
            'response_rate_7d'      => 'float',
            'cancellation_rate_30d' => 'float',
            'repeat_client_rate'    => 'float',
        ];
    }

    public function tier(): TrustTier
    {
        return TrustTier::from($this->trust_tier ?? 0);
    }

    public function isSearchVisible(): bool
    {
        return $this->trust_score >= 0.40
            && $this->account_state_is_active
            && $this->tier()->canSell();
    }

    public function user()
    {
        return $this->belongsTo(User::class, 'user_id');
    }

    public function identityDocuments()
    {
        return $this->hasMany(IdentityDocument::class, 'user_id', 'user_id');
    }

    public function promotedSlots()
    {
        return $this->hasMany(PromotedSlot::class, 'provider_id', 'user_id');
    }

    public function services()
    {
        return $this->hasMany(Service::class, 'provider_id', 'user_id');
    }
}
