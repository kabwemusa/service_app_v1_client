<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

class PawapayEvent extends Model
{
    public $incrementing = false;
    protected $keyType   = 'string';
    public $timestamps   = false;

    protected static function boot(): void
    {
        parent::boot();
        static::creating(function ($model) {
            $model->id ??= (string) Str::uuid();
            $model->created_at ??= now();
        });
    }

    protected $fillable = [
        'booking_id', 'external_ref', 'type', 'pawapay_status', 'mno', 'amount', 'created_at',
    ];

    protected function casts(): array
    {
        return [
            'amount'     => 'float',
            'created_at' => 'datetime',
        ];
    }

    public function booking()
    {
        return $this->belongsTo(Booking::class, 'booking_id');
    }
}
