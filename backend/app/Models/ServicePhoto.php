<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ServicePhoto extends Model
{
    protected $fillable = [
        'service_id', 'path', 'display_order',
        // v3.1 §5.3 pipeline-result columns — WRITTEN by the upload pipeline,
        // CONSUMED read-only by the admin Services moderation module.
        'pipeline_status', 'nsfw_score', 'phash', 'duplicate_of_service_id', 'exif_stripped',
    ];

    protected function casts(): array
    {
        return [
            'nsfw_score'    => 'float',
            'exif_stripped' => 'boolean',
        ];
    }

    public function service()
    {
        return $this->belongsTo(Service::class);
    }
}
