<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

class SavedLocation extends Model
{
    public $incrementing = false;
    public $timestamps   = false;
    protected $keyType   = 'string';

    const CREATED_AT = 'created_at';
    const UPDATED_AT = null;

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
        'user_id',
        'label',
        'place_name',
        'lat',
        'lng',
        'region',
        'is_primary',
    ];

    protected function casts(): array
    {
        return [
            'lat'        => 'float',
            'lng'        => 'float',
            'is_primary' => 'boolean',
            'created_at' => 'datetime',
        ];
    }

    public function user()
    {
        return $this->belongsTo(User::class, 'user_id');
    }
}
