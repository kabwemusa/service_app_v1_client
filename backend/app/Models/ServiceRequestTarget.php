<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

class ServiceRequestTarget extends Model
{
    public $incrementing = false;
    public $timestamps = false;
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
        'request_id',
        'provider_id',
        'service_id',
        'notified_at',
        'respond_by',
        'responded_at',
    ];

    protected function casts(): array
    {
        return [
            'notified_at'  => 'datetime',
            'respond_by'   => 'datetime',
            'responded_at' => 'datetime',
        ];
    }

    public function request()
    {
        return $this->belongsTo(ServiceRequest::class, 'request_id');
    }
}
