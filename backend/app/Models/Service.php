<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

class Service extends Model
{
    public $incrementing = false;
    protected $keyType   = 'string';

    protected static function boot(): void
    {
        parent::boot();
        static::creating(function ($model) {
            if (empty($model->{$model->getKeyName()})) {
                $model->{$model->getKeyName()} = (string) Str::uuid();
            }
        });
    }

    protected $fillable = [
        'provider_id',
        'category_id',
        'title',
        'description',
        'pricing_model',
        'base_price',
        'hourly_rate',
        'minimum_hours',
        'cap_hours',
        'cap_amount',
        'deposit_percent',
        'scope_prompts',
        'needs_pricing_review',
        'duration_estimate_mins',
        'status',
        'is_pinned',
    ];

    protected function casts(): array
    {
        return [
            'base_price'           => 'float',
            'hourly_rate'          => 'float',
            'minimum_hours'        => 'float',
            'cap_hours'            => 'float',
            'cap_amount'           => 'float',
            'deposit_percent'      => 'integer',
            'scope_prompts'        => 'array',
            'needs_pricing_review' => 'boolean',
            'is_pinned'            => 'boolean',
        ];
    }

    /** v3.1 §5.1 — `status` (DRAFT/ACTIVE/PAUSED/HIDDEN) supersedes the old `is_active` flag. */
    public function isActive(): bool
    {
        return $this->status === 'ACTIVE';
    }

    /** Outcome-based pricing — the four models the provider chooses from. */
    public const PRICING_MODELS = ['OUTCOME_FIXED', 'PROVIDER_SCOPE', 'HOURLY_CAPPED', 'QUOTE_DEPOSIT'];

    /** Models where the price is only known after the provider sends a scoped quote. */
    public function needsScopeQuote(): bool
    {
        return in_array($this->pricing_model, ['PROVIDER_SCOPE', 'QUOTE_DEPOSIT'], true);
    }

    /** Kept for legacy call-sites — quote-first models hide the upfront price. */
    public function isQuoted(): bool
    {
        return $this->needsScopeQuote();
    }

    public function provider()
    {
        return $this->belongsTo(User::class, 'provider_id');
    }

    public function category()
    {
        return $this->belongsTo(Category::class, 'category_id');
    }

    public function bookings()
    {
        return $this->hasMany(Booking::class, 'service_id');
    }

    public function photos()
    {
        return $this->hasMany(ServicePhoto::class)->orderBy('display_order');
    }

    public function inclusions()
    {
        return $this->hasMany(ServiceInclusion::class)->orderBy('position');
    }

    public function addons()
    {
        return $this->hasMany(ServiceAddon::class)->orderBy('position');
    }
}
