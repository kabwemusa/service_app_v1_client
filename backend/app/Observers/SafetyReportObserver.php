<?php

namespace App\Observers;

use App\Events\AdminQueueEvent;
use App\Models\SafetyReport;

class SafetyReportObserver
{
    public function created(SafetyReport $report): void
    {
        AdminQueueEvent::fire('safety', 'safety.report_filed', $report->id, [
            'reporter_id' => $report->reporter_id,
            'reported_id' => $report->reported_id,
            'category'    => $report->category,
            'status'      => $report->status,
        ]);
    }
}
