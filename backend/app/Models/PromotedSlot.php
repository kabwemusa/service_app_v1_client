<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

class PromotedSlot extends Model
{
    public $incrementing = false;
    public $timestamps = false;
    protected $keyType = 'string';

    protected static function boot(): void
    {
        parent::boot();
        static::creating(function ($model) {
            if (empty($model->id)) {
                $model->id = (string) Str::uuid();
            }
        });
    }

    protected $fillable = [
        'provider_id',
        'category_id',
        'region',
        'bid_amount_per_day',
        'starts_at',
        'ends_at',
        'status',
        'impressions',
        'clicks',
        'bookings_sourced',
    ];

    protected function casts(): array
    {
        return [
            'bid_amount_per_day' => 'float',
            'starts_at'          => 'datetime',
            'ends_at'            => 'datetime',
        ];
    }

    public function isActive(): bool
    {
        return $this->status === 'ACTIVE'
            && $this->ends_at->isFuture();
    }

    public function provider()
    {
        return $this->belongsTo(User::class, 'provider_id');
    }

    public function category()
    {
        return $this->belongsTo(Category::class, 'category_id');
    }
}
