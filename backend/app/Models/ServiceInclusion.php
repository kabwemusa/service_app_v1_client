<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** v3.1 §5.2 — an ordered "what's included" bullet on a service listing. */
class ServiceInclusion extends Model
{
    public $timestamps = false;

    protected $fillable = ['service_id', 'position', 'text'];

    public function service()
    {
        return $this->belongsTo(Service::class);
    }
}
