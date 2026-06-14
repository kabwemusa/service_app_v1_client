<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

class ServiceRequest extends Model
{
    public $incrementing = false;
    protected $keyType = 'string';

    protected static function boot(): void
    {
        parent::boot();
        static::creating(function ($model) {
            if (empty($model->id)) {
                $model->id = (string) Str::uuid();
            }
        });
    }

    protected $fillable = [
        'buyer_id',
        'category_id',
        'description',
        'delivery_location_label',
        'delivery_location_region',
        'delivery_location_source',
        'window_start',
        'window_end',
        'budget_zmw',
        'status',
    ];

    protected function casts(): array
    {
        return [
            'window_start' => 'datetime',
            'window_end'   => 'datetime',
            'budget_zmw'   => 'float',
        ];
    }

    public function buyer()
    {
        return $this->belongsTo(User::class, 'buyer_id');
    }

    public function category()
    {
        return $this->belongsTo(Category::class, 'category_id');
    }

    public function targets()
    {
        return $this->hasMany(ServiceRequestTarget::class, 'request_id');
    }

    public function responses()
    {
        return $this->hasMany(ServiceRequestResponse::class, 'request_id');
    }
}
