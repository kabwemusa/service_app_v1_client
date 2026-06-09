<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class HomeBanner extends Model
{
    public $incrementing = false;
    protected $keyType   = 'string';

    protected $fillable = [
        'type',
        'title',
        'subtitle',
        'image_url',
        'bg_token',
        'cta_label',
        'cta_action',
        'priority',
        'start_at',
        'end_at',
        'is_active',
        'audience',
    ];

    protected function casts(): array
    {
        return [
            'start_at'  => 'datetime',
            'end_at'    => 'datetime',
            'is_active' => 'boolean',
            'audience'  => 'array',
        ];
    }
}
