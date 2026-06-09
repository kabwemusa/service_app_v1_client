<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** v3.1 §5.3 — an optional paid extra a customer can add to a booking at checkout. */
class ServiceAddon extends Model
{
    public $timestamps = false;

    protected $fillable = ['service_id', 'name', 'price', 'position'];

    protected function casts(): array
    {
        return [
            'price' => 'float',
        ];
    }

    public function service()
    {
        return $this->belongsTo(Service::class);
    }
}
