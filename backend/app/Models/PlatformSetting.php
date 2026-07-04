<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class PlatformSetting extends Model
{
    protected $primaryKey = 'key';
    public $incrementing  = false;
    protected $keyType    = 'string';

    protected $fillable = ['key', 'group', 'value', 'updated_by', 'updated_at'];

    protected function casts(): array
    {
        return [
            'value'      => 'array',
            'updated_at' => 'datetime',
        ];
    }
}
