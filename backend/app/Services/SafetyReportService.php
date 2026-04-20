<?php

namespace App\Services;

use App\Enums\ErrorCode;
use App\Enums\UserRole;
use App\Exceptions\Api\ApiException;
use App\Exceptions\Api\ForbiddenException;
use App\Exceptions\Api\NotFoundException;
use App\Models\SafetyReport;
use App\Models\User;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Notification;

/**
 * Safety reports — §11.3
 *
 * One-way, no adversarial process. A single credible report immediately
 * restricts the reported account pending moderator review.
 */
class SafetyReportService
{
    /**
     * File a safety report.
     *
     * @param  array{
     *   reported_id:     string,
     *   booking_id?:     string|null,
     *   category:        string,
     *   description:     string,
     *   tos_acknowledged: bool,
     * } $data
     */
    public function file(User $reporter, array $data): SafetyReport
    {
        if (! $data['tos_acknowledged']) {
            throw new ApiException(
                ErrorCode::VALIDATION_ERROR,
                'You must acknowledge that filing a false safety report is grounds for restriction.',
            );
        }

        $reported = User::find($data['reported_id']);
        if (! $reported) {
            throw new NotFoundException('User');
        }

        if ($reporter->id === $reported->id) {
            throw new ApiException(ErrorCode::VALIDATION_ERROR, 'You cannot file a safety report against yourself.');
        }

        return DB::transaction(function () use ($reporter, $reported, $data) {
            // Immediately restrict the reported account (§11.3)
            $restricted = false;
            if ($reported->account_state === 'ACTIVE') {
                $reported->update(['account_state' => 'RESTRICTED']);
                $restricted = true;
            }

            $report = SafetyReport::create([
                'reporter_id'       => $reporter->id,
                'reported_id'       => $reported->id,
                'booking_id'        => $data['booking_id'] ?? null,
                'category'          => $data['category'],
                'description'       => $data['description'],
                'status'            => 'OPEN',
                'account_restricted'=> $restricted,
                'tos_acknowledged'  => true,
                'reported_at'       => now(),
            ]);

            Log::warning('SafetyReportService: report filed', [
                'report_id'   => $report->id,
                'reporter'    => $reporter->id,
                'reported'    => $reported->id,
                'category'    => $data['category'],
                'restricted'  => $restricted,
            ]);

            // Notify all moderators and admins for same-hour review (§11.3)
            $this->alertModerators($report);

            return $report;
        });
    }

    /**
     * Moderator/admin reviews and closes the report.
     *
     * @param  array{
     *   outcome:       string,   // RESOLVED | DISMISSED
     *   review_notes:  string,
     *   lift_restriction?: bool,
     * } $data
     */
    public function review(string $reportId, User $reviewer, array $data): SafetyReport
    {
        if (! UserRole::from($reviewer->role)->canResolveDisputes()) {
            throw new ForbiddenException('Only admin or moderator can review safety reports.');
        }

        $report = SafetyReport::find($reportId);
        if (! $report) throw new NotFoundException('SafetyReport');

        if (! in_array($report->status, ['OPEN', 'UNDER_REVIEW'])) {
            throw new ApiException(ErrorCode::VALIDATION_ERROR, 'This report is already closed.');
        }

        DB::transaction(function () use ($report, $reviewer, $data) {
            // Lift the account restriction if dismissing and reviewer opts to
            if ($data['outcome'] === 'DISMISSED' && ($data['lift_restriction'] ?? false)) {
                $reported = User::find($report->reported_id);
                if ($reported && $reported->account_state === 'RESTRICTED') {
                    $reported->update(['account_state' => 'ACTIVE']);
                }
            }

            // If confirmed — escalate to SUSPENDED (permanent restriction)
            if ($data['outcome'] === 'RESOLVED') {
                $reported = User::find($report->reported_id);
                if ($reported && in_array($reported->account_state, ['ACTIVE', 'RESTRICTED'])) {
                    $reported->update(['account_state' => 'SUSPENDED']);
                }
            }

            $report->update([
                'status'       => $data['outcome'],
                'reviewed_by'  => $reviewer->id,
                'review_notes' => $data['review_notes'],
                'reviewed_at'  => now(),
            ]);
        });

        return $report->fresh();
    }

    /**
     * Admin queue — open + under-review safety reports.
     */
    public function queue(User $reviewer): LengthAwarePaginator
    {
        if (! UserRole::from($reviewer->role)->canResolveDisputes()) {
            throw new ForbiddenException('Only admin or moderator can view the safety report queue.');
        }

        return SafetyReport::with(['reporter', 'reported', 'booking.service'])
            ->whereIn('status', ['OPEN', 'UNDER_REVIEW'])
            ->orderBy('reported_at')
            ->paginate(20);
    }

    private function alertModerators(SafetyReport $report): void
    {
        // In production: push notification to all MODERATOR/ADMIN accounts via FCM.
        // Logging here as the observable side-effect in the stub environment.
        Log::critical('SAFETY_ALERT: moderator review required', [
            'report_id'  => $report->id,
            'category'   => $report->category,
            'reported_id'=> $report->reported_id,
        ]);
    }
}
