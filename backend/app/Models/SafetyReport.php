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
        'description',
        'status',
        'account_restricted',
        'reviewed_by',
        'review_notes',
        'tos_acknowledged',
        'reported_at',
        'reviewed_at',
    ];

    protected function casts(): array
    {
        return [
            'account_restricted' => 'boolean',
            'tos_acknowledged'   => 'boolean',
            'reported_at'        => 'datetime',
            'reviewed_at'        => 'datetime',
        ];
    }

    public function reporter()  { return $this->belongsTo(User::class, 'reporter_id'); }
    public function reported()  { return $this->belongsTo(User::class, 'reported_id'); }
    public function booking()   { return $this->belongsTo(Booking::class); }
    public function reviewer()  { return $this->belongsTo(User::class, 'reviewed_by'); }
}
