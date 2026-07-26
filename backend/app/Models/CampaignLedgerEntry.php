<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

/**
 * One row per campaign redemption AND per unit of marketing spend. Feeds the
 * Finance module's spend tracking. UNIQUE(campaign_id, booking_id) makes a
 * checkout apply idempotent under double-taps / gateway retries.
 */
class CampaignLedgerEntry extends Model
{
    public $incrementing = false;
    public $timestamps   = false;
    protected $keyType   = 'string';

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
    }

    protected $fillable = [
        'campaign_id',
        'user_id',
        'booking_id',
        'kind',
        'amount_zmw',
        'created_at',
    ];

    protected function casts(): array
    {
        return [
            'amount_zmw' => 'float',
            'created_at' => 'datetime',
        ];
    }

    public function campaign()
    {
        return $this->belongsTo(Campaign::class);
    }
}
