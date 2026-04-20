<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

class Transaction extends Model
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
        'booking_id',
        'momo_reference',
        'amount_gross',
        'platform_fee',
        'amount_net',
        'type',
        'status',
        'retry_count',
        'next_retry_at',
    ];

    protected function casts(): array
    {
        return [
            'amount_gross'  => 'decimal:2',
            'platform_fee'  => 'decimal:2',
            'amount_net'    => 'decimal:2',
            'retry_count'   => 'integer',
            'next_retry_at' => 'datetime',
        ];
    }

    public function booking()
    {
        return $this->belongsTo(Booking::class);
    }
}
