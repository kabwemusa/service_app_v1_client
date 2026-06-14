<?php

namespace App\Console\Commands;

use App\Support\Stats;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * v3.2 §7 — weekly north-star metrics, snapshotted to metric_snapshots for
 * the Next.js admin. Run after the week closes:
 *
 *   metrics:weekly                  → the last full Mon–Sun week
 *
 * Metrics:
 *  - search_booking_conversion     impressions with a BOOKING_STARTED event / impressions
 *  - median_first_response_mins    median provider response_time_p50 weighted by week's bookings (proxy until per-booking response events exist)
 *  - rebook_rate_30d               buyers completing a booking ~30 days ago who booked again within 30 days
 *  - provider_4wk_retention        providers onboarded 4 weeks before the window with ≥1 funded booking in each of their first 4 weeks
 *  - booking_gini (per category)   bookings-per-provider Gini over the window
 */
class MetricsWeeklyCommand extends Command
{
    protected $signature   = 'metrics:weekly';
    protected $description = 'Compute and snapshot the v3.2 §7 weekly north-star metrics';

    public function handle(): int
    {
        $end   = now()->startOfWeek();          // exclusive — start of the current week
        $start = $end->copy()->subWeek();       // inclusive — start of the last full week

        $write = function (string $metric, ?float $value, ?array $dimensions = null) use ($start, $end) {
            DB::table('metric_snapshots')->insert([
                'metric'       => $metric,
                'period_start' => $start->toDateString(),
                'period_end'   => $end->copy()->subDay()->toDateString(),
                'value'        => $value,
                'dimensions'   => $dimensions !== null ? json_encode($dimensions) : null,
            ]);
        };

        // ── 1. search → booking conversion ─────────────────────────────────
        try {
            $row = DB::selectOne("
                SELECT COUNT(*) AS impressions,
                       COUNT(*) FILTER (
                           WHERE EXISTS (
                               SELECT 1 FROM search_impression_events e
                               WHERE e.impression_id = i.id AND e.event_type = 'BOOKING_STARTED'
                           )
                       ) AS converted
                FROM search_impressions i
                WHERE i.requested_at >= ? AND i.requested_at < ?
            ", [$start, $end]);

            $write(
                'search_booking_conversion',
                ((int) $row->impressions) > 0 ? round($row->converted / $row->impressions, 4) : null,
            );
        } catch (\Throwable $e) {
            Log::warning('metrics:weekly conversion failed', ['error' => $e->getMessage()]);
        }

        // ── 2. median time-to-first-response (proxy) ────────────────────────
        try {
            $row = DB::selectOne("
                SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY pp.response_time_p50_mins) AS median_mins
                FROM   bookings b
                JOIN   provider_profiles pp ON pp.user_id = b.provider_id
                WHERE  b.created_at >= ? AND b.created_at < ?
            ", [$start, $end]);

            $write('median_first_response_mins', $row->median_mins !== null ? round((float) $row->median_mins, 2) : null);
        } catch (\Throwable $e) {
            Log::warning('metrics:weekly response failed', ['error' => $e->getMessage()]);
        }

        // ── 3. 30-day rebook rate ───────────────────────────────────────────
        // Cohort: buyers who completed a booking in the same week 30 days
        // earlier; success = any further booking within 30 days of completion.
        try {
            $cohortStart = $start->copy()->subDays(30);
            $cohortEnd   = $end->copy()->subDays(30);

            $row = DB::selectOne("
                WITH cohort AS (
                    SELECT b.buyer_id, MIN(b.updated_at) AS completed_at
                    FROM   bookings b
                    WHERE  b.status = 'COMPLETED'
                      AND  b.updated_at >= ? AND b.updated_at < ?
                    GROUP  BY b.buyer_id
                )
                SELECT COUNT(*) AS cohort_size,
                       COUNT(*) FILTER (
                           WHERE EXISTS (
                               SELECT 1 FROM bookings b2
                               WHERE b2.buyer_id    = cohort.buyer_id
                                 AND b2.created_at  > cohort.completed_at
                                 AND b2.created_at <= cohort.completed_at + INTERVAL '30 days'
                           )
                       ) AS rebooked
                FROM cohort
            ", [$cohortStart, $cohortEnd]);

            $write(
                'rebook_rate_30d',
                ((int) $row->cohort_size) > 0 ? round($row->rebooked / $row->cohort_size, 4) : null,
            );
        } catch (\Throwable $e) {
            Log::warning('metrics:weekly rebook failed', ['error' => $e->getMessage()]);
        }

        // ── 4. provider 4-week retention ────────────────────────────────────
        try {
            $onboardStart = $start->copy()->subWeeks(4);
            $onboardEnd   = $end->copy()->subWeeks(4);

            $row = DB::selectOne("
                WITH cohort AS (
                    SELECT u.id, u.created_at
                    FROM   users u
                    JOIN   provider_profiles pp ON pp.user_id = u.id
                    WHERE  u.role = 'PROVIDER'
                      AND  u.created_at >= ? AND u.created_at < ?
                )
                SELECT COUNT(*) AS cohort_size,
                       COUNT(*) FILTER (WHERE (
                           SELECT COUNT(DISTINCT FLOOR(EXTRACT(EPOCH FROM (b.created_at - cohort.created_at)) / 604800))
                           FROM   bookings b
                           WHERE  b.provider_id = cohort.id
                             AND  b.status IN ('FUNDS_HELD', 'IN_PROGRESS', 'COMPLETED')
                             AND  b.created_at >= cohort.created_at
                             AND  b.created_at <  cohort.created_at + INTERVAL '28 days'
                       ) = 4) AS retained
                FROM cohort
            ", [$onboardStart, $onboardEnd]);

            $write(
                'provider_4wk_retention',
                ((int) $row->cohort_size) > 0 ? round($row->retained / $row->cohort_size, 4) : null,
            );
        } catch (\Throwable $e) {
            Log::warning('metrics:weekly retention failed', ['error' => $e->getMessage()]);
        }

        // ── 5. per-category booking Gini ────────────────────────────────────
        try {
            $rows = DB::select("
                SELECT s.category_id, b.provider_id, COUNT(*) AS cnt
                FROM   bookings b
                JOIN   services s ON s.id = b.service_id
                WHERE  b.created_at >= ? AND b.created_at < ?
                GROUP  BY s.category_id, b.provider_id
            ", [$start, $end]);

            $byCategory = [];
            foreach ($rows as $row) {
                $byCategory[(int) $row->category_id][] = (int) $row->cnt;
            }

            foreach ($byCategory as $categoryId => $counts) {
                $write('booking_gini', round(Stats::gini($counts), 4), ['category_id' => $categoryId]);
            }
        } catch (\Throwable $e) {
            Log::warning('metrics:weekly gini failed', ['error' => $e->getMessage()]);
        }

        $this->info("Weekly metrics snapshotted for {$start->toDateString()} – {$end->copy()->subDay()->toDateString()}.");

        return self::SUCCESS;
    }
}
