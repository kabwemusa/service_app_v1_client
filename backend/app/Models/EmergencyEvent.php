<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

/**
 * §11.4 emergency event — the platform-side record of an in-app emergency
 * trigger, surfaced at the top of the admin Safety triage queue.
 */
class EmergencyEvent extends Model
{
    public $incrementing = false;
    public $timestamps   = false;
    protected $keyType   = 'string';

    protected static function boot(): void
    {
        parent::boot();
        static::creating(fn ($m) => $m->id ??= (string) Str::uuid());
    }

    protected $fillable = [
        'triggered_by',
        'reported_id',
        'booking_id',
        'status',
        'location_label',
        'assigned_admin_id',
        'acknowledged_at',
        'resolved_by_admin_id',
        'resolved_at',
        'outcome',
        'outreach_due_at',
        'created_at',
    ];

    protected function casts(): array
    {
        return [
            'acknowledged_at' => 'datetime',
            'resolved_at'     => 'datetime',
            'outreach_due_at' => 'datetime',
            'created_at'      => 'datetime',
        ];
    }

    public function triggeredBy()  { return $this->belongsTo(User::class, 'triggered_by'); }
    public function reported()     { return $this->belongsTo(User::class, 'reported_id'); }
    public function booking()      { return $this->belongsTo(Booking::class); }
    public function assignedAdmin(){ return $this->belongsTo(AdminUser::class, 'assigned_admin_id'); }
    public function resolverAdmin(){ return $this->belongsTo(AdminUser::class, 'resolved_by_admin_id'); }
}
