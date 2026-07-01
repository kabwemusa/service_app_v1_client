<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

class ProviderVerification extends Model
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
        'verification_type',
        'status',
        'metadata',
        'verified_at',
        'expires_at',
        'verified_by',
    ];

    protected function casts(): array
    {
        return [
            'metadata'    => 'array',
            'verified_at' => 'datetime',
            'expires_at'  => 'datetime',
        ];
    }

    public function isVerified(): bool
    {
        if ($this->status !== 'VERIFIED') {
            return false;
        }

        if ($this->expires_at && $this->expires_at->isPast()) {
            return false;
        }

        return true;
    }

    public function provider()
    {
        return $this->belongsTo(User::class, 'provider_id');
    }
}
