<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

class ProviderService extends Model
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
        'service_id',
        'price',
        'pricing_model',
        'inclusions',
        'add_ons',
        'status',
        'bookings_completed',
        'avg_rating',
        'review_count',
    ];

    protected function casts(): array
    {
        return [
            'price'       => 'float',
            'inclusions'  => 'array',
            'add_ons'     => 'array',
            'avg_rating'  => 'float',
        ];
    }

    public function provider()
    {
        return $this->belongsTo(User::class, 'provider_id');
    }

    public function service()
    {
        return $this->belongsTo(Service::class, 'service_id');
    }

    public function providerProfile()
    {
        return $this->belongsTo(ProviderProfile::class, 'provider_id', 'user_id');
    }

    public function effectivePrice(): ?float
    {
        return $this->price ?? $this->service?->base_price;
    }
}
