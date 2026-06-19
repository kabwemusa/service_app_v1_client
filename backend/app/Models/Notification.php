<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

class Notification extends Model
{
    public $incrementing = false;
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
        'type',
        'title',
        'body',
        'read_at',
        'entity_type',
        'entity_id',
        'payment_mode',
        'meta',
        'sent_at',
        'event_time',
        'dispatch_time',
        'ack_time',
        'priority',
        'sms_sent_at',
        'push_status',
    ];

    protected function casts(): array
    {
        return [
            'read_at'       => 'datetime',
            'sent_at'       => 'datetime',
            'event_time'    => 'datetime',
            'dispatch_time' => 'datetime',
            'ack_time'      => 'datetime',
            'sms_sent_at'   => 'datetime',
            'meta'          => 'array',
        ];
    }

    // ── Scopes ────────────────────────────────────────────────────────────

    public function scopeUnread($query)
    {
        return $query->whereNull('read_at');
    }

    public function scopeForUser($query, string $userId)
    {
        return $query->where('user_id', $userId);
    }

    // ── Relationships ─────────────────────────────────────────────────────

    public function user()
    {
        return $this->belongsTo(User::class, 'user_id');
    }
}
