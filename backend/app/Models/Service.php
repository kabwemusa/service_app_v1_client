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
        'duration_estimate_mins',
        'status',
        'is_pinned',
    ];

    protected function casts(): array
    {
        return [
            'base_price' => 'float',
            'is_pinned'  => 'boolean',
        ];
    }

    /** v3.1 §5.1 — `status` (DRAFT/ACTIVE/PAUSED/HIDDEN) supersedes the old `is_active` flag. */
    public function isActive(): bool
    {
        return $this->status === 'ACTIVE';
    }

    /** §5.5 — a `QUOTE` service hides its base price and routes through the quote step. */
    public function isQuoted(): bool
    {
        return $this->pricing_model === 'QUOTE';
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
