<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

class WhatsAppWebhookLog extends Model
{
    // Eloquent's snake_case deriver splits "WhatsApp" into "whats_app", not
    // "whatsapp" — override to match the actual migration-created table.
    protected $table = 'whatsapp_webhook_logs';

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
        'message_id', 'from_number', 'kind', 'type', 'processing_status', 'error', 'created_at',
    ];

    protected function casts(): array
    {
        return ['created_at' => 'datetime'];
    }
}
