<?php

namespace App\Observers;

use App\Events\AdminQueueEvent;
use App\Models\EmergencyEvent;

class EmergencyEventObserver
{
    public function created(EmergencyEvent $emergency): void
    {
        AdminQueueEvent::fire('safety', 'emergency.triggered', $emergency->id, [
            'triggered_by'    => $emergency->triggered_by,
            'reported_id'     => $emergency->reported_id,
            'booking_id'      => $emergency->booking_id,
            'status'          => $emergency->status,
            'location_label'  => $emergency->location_label,
            'priority'        => 'high',
        ]);
    }
}
