<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ServicePhoto extends Model
{
    protected $fillable = ['service_id', 'path', 'display_order'];

    public function service()
    {
        return $this->belongsTo(Service::class);
    }
}
