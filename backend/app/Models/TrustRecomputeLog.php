<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

class TrustRecomputeLog extends Model
{
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

    protected $fillable = ['provider_id', 'reason', 'old_score', 'new_score', 'created_at'];

    protected function casts(): array
    {
        return [
            'old_score'  => 'float',
            'new_score'  => 'float',
            'created_at' => 'datetime',
        ];
    }

    public function provider()
    {
        return $this->belongsTo(User::class, 'provider_id');
    }
}
