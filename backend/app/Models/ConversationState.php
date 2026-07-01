<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

class ConversationState extends Model
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
        'whatsapp_id',
        'user_id',
        'state',
        'sub_state',
        'context',
        'booking_id',
        'last_inbound_at',
        'timeout_at',
    ];

    protected function casts(): array
    {
        return [
            'context'         => 'array',
            'last_inbound_at' => 'datetime',
            'timeout_at'      => 'datetime',
        ];
    }

    public function user()
    {
        return $this->belongsTo(User::class);
    }

    public function booking()
    {
        return $this->belongsTo(Booking::class);
    }

    public function setContextValue(string $key, mixed $value): void
    {
        $ctx = $this->context ?? [];
        $ctx[$key] = $value;
        $this->context = $ctx;
    }

    public function getContextValue(string $key, mixed $default = null): mixed
    {
        return ($this->context ?? [])[$key] ?? $default;
    }

    public function isWithin24hWindow(): bool
    {
        if (! $this->last_inbound_at) {
            return false;
        }
        return $this->last_inbound_at->diffInHours(now()) < 24;
    }
}
