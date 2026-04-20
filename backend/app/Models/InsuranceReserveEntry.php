<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

class InsuranceReserveEntry extends Model
{
    protected $table     = 'insurance_reserve_ledger';
    public $incrementing = false;
    public $timestamps   = false;
    protected $keyType   = 'string';

    protected static function boot(): void
    {
        parent::boot();
        static::creating(fn ($m) => $m->id ??= (string) Str::uuid());
    }

    protected $fillable = [
        'entry_type',
        'amount',
        'booking_id',
        'dispute_id',
        'note',
        'created_by',
        'created_at',
    ];

    protected function casts(): array
    {
        return [
            'amount'     => 'float',
            'created_at' => 'datetime',
        ];
    }

    public function booking() { return $this->belongsTo(Booking::class); }
    public function dispute() { return $this->belongsTo(Dispute::class); }
}
