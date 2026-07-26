<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

/**
 * APPEND-ONLY audit row for a single consent event (see ConsentEvent). The Data
 * Protection Act No. 3 of 2021 requires the controller to be able to DEMONSTRATE
 * that consent was given; this table is that evidence.
 *
 * IMMUTABILITY: rows are only ever inserted. There is no `updated_at`; the model
 * disables timestamps and guards against update()/delete(). A correction is a new
 * row, never a mutation — the history is the record.
 */
class ConsentRecord extends Model
{
    public $incrementing = false;
    protected $keyType   = 'string';
    public $timestamps   = false; // append-only: created_at is set on insert only

    protected $fillable = [
        'id', 'user_id', 'event', 'documents', 'marketing_opt_in',
        'analytics_opt_in', 'withdrawn_scope', 'platform', 'app_version',
        'ip_address', 'user_agent', 'created_at',
    ];

    protected function casts(): array
    {
        return [
            'documents'        => 'array',
            'marketing_opt_in' => 'boolean',
            'analytics_opt_in' => 'boolean',
            'created_at'       => 'datetime',
        ];
    }

    protected static function boot(): void
    {
        parent::boot();

        static::creating(function ($model) {
            if (empty($model->id)) {
                $model->id = (string) Str::uuid();
            }
            if (empty($model->created_at)) {
                $model->created_at = now();
            }
        });

        // Append-only guarantee — block mutation of a persisted consent record.
        static::updating(fn () => throw new \RuntimeException('consent_records is append-only; insert a new event instead of updating.'));
        static::deleting(fn () => throw new \RuntimeException('consent_records is append-only; records must not be deleted.'));
    }

    public function user()
    {
        return $this->belongsTo(User::class, 'user_id');
    }
}
