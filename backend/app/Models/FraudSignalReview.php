<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

class FraudSignalReview extends Model
{
    public $incrementing = false;
    protected $keyType   = 'string';

    protected static function boot(): void
    {
        parent::boot();
        static::creating(fn ($m) => $m->id ??= (string) Str::uuid());
    }

    protected $fillable = [
        'signal_type', 'signal_key', 'severity', 'affected_users',
        'source_module', 'source_id', 'status', 'assigned_admin_id', 'detected_at',
    ];

    protected function casts(): array
    {
        return [
            'affected_users' => 'array',
            'detected_at'    => 'datetime',
        ];
    }

    public function assignedAdmin()
    {
        return $this->belongsTo(AdminUser::class, 'assigned_admin_id');
    }
}
