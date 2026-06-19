<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

class SafetyReport extends Model
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
        'reporter_id',
        'reported_id',
        'booking_id',
        'category',
        'severity',
        'description',
        'status',
        'assigned_admin_id',
        'assigned_at',
        'account_restricted',
        'contact_restricted',
        'authority_escalated_at',
        'super_admin_escalated',
        'reviewed_by',
        'reviewed_by_admin_id',
        'review_notes',
        'outcome',
        'tos_acknowledged',
        'reported_at',
        'reviewed_at',
    ];

    protected function casts(): array
    {
        return [
            'account_restricted'     => 'boolean',
            'contact_restricted'     => 'boolean',
            'super_admin_escalated'  => 'boolean',
            'tos_acknowledged'       => 'boolean',
            'assigned_at'            => 'datetime',
            'authority_escalated_at' => 'datetime',
            'reported_at'            => 'datetime',
            'reviewed_at'            => 'datetime',
        ];
    }

    public function reporter()     { return $this->belongsTo(User::class, 'reporter_id'); }
    public function reported()     { return $this->belongsTo(User::class, 'reported_id'); }
    public function booking()      { return $this->belongsTo(Booking::class); }
    public function reviewer()     { return $this->belongsTo(User::class, 'reviewed_by'); }
    public function assignedAdmin(){ return $this->belongsTo(AdminUser::class, 'assigned_admin_id'); }
    public function reviewerAdmin(){ return $this->belongsTo(AdminUser::class, 'reviewed_by_admin_id'); }
}
