<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

/**
 * A data-subject-rights request captured from the app (Privacy & consent screen).
 * The Act grants the rights to be informed, access, rectify, erase, object,
 * restrict, port, and withdraw consent. This table records the REQUEST; actual
 * fulfilment (export/erasure) is handled out of band — see the documented stub
 * in ConsentService::openDataSubjectRequest().
 */
class DataSubjectRequest extends Model
{
    public $incrementing = false;
    protected $keyType   = 'string';

    protected $fillable = [
        'id', 'user_id', 'type', 'status', 'details',
        'resolution_note', 'resolved_at',
    ];

    protected function casts(): array
    {
        return [
            'resolved_at' => 'datetime',
        ];
    }

    protected static function boot(): void
    {
        parent::boot();
        static::creating(function ($model) {
            if (empty($model->id)) {
                $model->id = (string) Str::uuid();
            }
        });
    }

    public function user()
    {
        return $this->belongsTo(User::class, 'user_id');
    }
}
