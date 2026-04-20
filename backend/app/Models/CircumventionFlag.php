<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

class CircumventionFlag extends Model
{
    protected $table = 'circumvention_flags';
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
        'user_id',
        'counterparty_id',
        'booking_id',
        'signal_type',
        'raw_context',
        'severity',
        'action_taken',
        'created_at',
    ];

    protected function casts(): array
    {
        return [
            'severity'   => 'float',
            'created_at' => 'datetime',
        ];
    }

    public function user()
    {
        return $this->belongsTo(User::class, 'user_id');
    }

    public function counterparty()
    {
        return $this->belongsTo(User::class, 'counterparty_id');
    }

    public function booking()
    {
        return $this->belongsTo(Booking::class, 'booking_id');
    }
}
