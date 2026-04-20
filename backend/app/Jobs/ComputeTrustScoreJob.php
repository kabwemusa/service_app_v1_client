<?php

namespace App\Jobs;

use App\Models\ProviderProfile;
use App\Services\RankingService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Nightly batch job — recomputes trust_score (§5.4) for every active provider
 * and flushes the cached c_mean so the next search picks up fresh data.
 *
 * Schedule in Console/Kernel: $schedule->job(new ComputeTrustScoreJob)->dailyAt('02:00');
 */
class ComputeTrustScoreJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $timeout = 600;
    public int $tries   = 1;

    public function handle(RankingService $ranking): void
    {
        $ranking->invalidateCMean();
        $cMean = $ranking->getCMean();

        // Pull all active providers with the metrics needed for §5.4
        $providers = DB::select("
            SELECT
                pp.id                       AS profile_id,
                pp.trust_tier,
                pp.completion_rate,
                pp.response_rate_7d,
                pp.cancellation_rate_30d,
                pp.response_time_p50_mins,
                u.r_raw,
                u.v_reviews,
                (
                    SELECT COUNT(*)
                    FROM   bookings b
                    WHERE  b.provider_id = pp.user_id
                      AND  b.status      = 'COMPLETED'
                ) AS completed_jobs
            FROM  provider_profiles pp
            JOIN  users u ON u.id = pp.user_id
            WHERE u.account_state = 'ACTIVE'
        ");

        $updated = 0;

        foreach ($providers as $row) {
            try {
                $score = $ranking->computeTrustScore(
                    trustTier:            (int)   $row->trust_tier,
                    rRaw:                 (float) $row->r_raw,
                    vReviews:             (int)   $row->v_reviews,
                    cMean:                $cMean,
                    completionRate:       (float) ($row->completion_rate ?? 0.0),
                    responseRate7d:       (float) ($row->response_rate_7d ?? 0.0),
                    cancellationRate30d:  (float) ($row->cancellation_rate_30d ?? 0.0),
                    responseTimeP50Mins:  (int)   ($row->response_time_p50_mins ?? 60),
                    completedJobs:        (int)   $row->completed_jobs,
                );

                DB::table('provider_profiles')
                    ->where('id', $row->profile_id)
                    ->update(['trust_score' => $score]);

                $updated++;
            } catch (\Throwable $e) {
                Log::warning('ComputeTrustScoreJob: skipped profile', [
                    'profile_id' => $row->profile_id,
                    'error'      => $e->getMessage(),
                ]);
            }
        }

        Log::info('ComputeTrustScoreJob: done', ['updated' => $updated]);
    }
}
