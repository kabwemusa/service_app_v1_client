<?php

/*
|--------------------------------------------------------------------------
| Observability log retention (§ DB-8)
|--------------------------------------------------------------------------
| Passive log tables (WhatsApp webhook logs, payment events) grow unbounded.
| Rows older than this many days are pruned nightly by PruneObservabilityLogs.
*/

return [
    'retention_days' => (int) env('OBSERVABILITY_RETENTION_DAYS', 90),
];
