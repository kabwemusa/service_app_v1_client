<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ServicePhotoResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'            => $this->id,
            'path'          => $this->path,          // relative: service_photos/xxx.jpg
            'display_order' => $this->display_order,
        ];
    }
}
