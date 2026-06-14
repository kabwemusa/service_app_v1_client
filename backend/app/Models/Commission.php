<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

class Commission extends Model
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
        'booking_id',
        'provider_id',
        'category_id',
        'gross_amount',
        'commission_rate',
        'repeat_discount_rate',
        'pair_booking_number',
        'commission_amount',
        'payment_processor_fee',
        'vat',
        'net_to_provider',
        'tier_at_time',
        'promo_code',
        'payment_mode',
        'collection_status',
        'calculated_at',
    ];

    protected function casts(): array
    {
        return [
            'gross_amount'          => 'float',
            'commission_rate'       => 'float',
            'repeat_discount_rate'  => 'float',
            'commission_amount'     => 'float',
            'payment_processor_fee' => 'float',
            'vat'                   => 'float',
            'net_to_provider'       => 'float',
            'calculated_at'         => 'datetime',
        ];
    }

    public function booking()
    {
        return $this->belongsTo(Booking::class, 'booking_id');
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
