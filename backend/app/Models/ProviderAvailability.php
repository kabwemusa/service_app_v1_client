<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

class ProviderAvailability extends Model
{
    public $incrementing = false;
    protected $keyType   = 'string';
    protected $table     = 'provider_availability';

    protected static function boot(): void
    {
        parent::boot();
        static::creating(function ($model) {
            if (empty($model->{$model->getKeyName()})) {
                $model->{$model->getKeyName()} = (string) Str::uuid();
            }
        });
    }

    protected $fillable = [
        'provider_id',
        'day_of_week',
        'start_time',
        'end_time',
        'is_recurring',
        'specific_date',
        'is_blocked',
    ];

    protected function casts(): array
    {
        return [
            'is_recurring'  => 'boolean',
            'is_blocked'    => 'boolean',
            'specific_date' => 'date',
        ];
    }

    public function provider()
    {
        return $this->belongsTo(User::class, 'provider_id');
    }
}
