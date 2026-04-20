<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

class FraudDenylist extends Model
{
    protected $table = 'fraud_denylist';
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
        'hash_type',
        'hash_value',
        'reason',
        'added_by',
        'added_at',
        'expires_at',
    ];

    protected function casts(): array
    {
        return [
            'added_at'   => 'datetime',
            'expires_at' => 'datetime',
        ];
    }

    public function isExpired(): bool
    {
        return $this->expires_at !== null && $this->expires_at->isPast();
    }

    public function addedBy()
    {
        return $this->belongsTo(User::class, 'added_by');
    }

    public static function matchesHash(string $hashType, string $hashValue): bool
    {
        return static::where('hash_type', $hashType)
            ->where('hash_value', $hashValue)
            ->where(function ($q) {
                $q->whereNull('expires_at')->orWhere('expires_at', '>', now());
            })
            ->exists();
    }
}
