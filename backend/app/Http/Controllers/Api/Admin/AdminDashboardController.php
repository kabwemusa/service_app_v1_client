<?php

namespace App\Http\Controllers\Api\Admin;

use App\Enums\DisputeStatus;
use App\Enums\DocStatus;
use App\Http\Controllers\Controller;
use App\Models\Booking;
use App\Models\CircumventionFlag;
use App\Models\Dispute;
use App\Models\EmergencyEvent;
use App\Models\IdentityDocument;
use App\Models\ProviderProfile;
use App\Models\SafetyReport;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Admin dashboard overview (consumed by admin/src/lib/api/dashboard.ts).
 *
 * Read-only marketplace-health aggregation — plain counts, no PII — so it is
 * gated on `auth:admin` alone rather than a module capability: every admin sees
 * the same at-a-glance numbers, then drills into a module (which enforces its
 * own capability) for the detail.
 */
class AdminDashboardController extends Controller
{
    public function index(): JsonResponse
    {
        // Open dispute + pending-KYC state sets mirror the definitions the
        // Disputes/Verification modules use, so the headline count and the queue
        // the admin lands on agree.
        $openDisputeStates = array_map(
            fn (DisputeStatus $s) => $s->value,
            array_filter(DisputeStatus::cases(), fn (DisputeStatus $s) => $s->isOpen()),
        );
        $pendingDocStates = array_map(
            fn (DocStatus $s) => $s->value,
            array_filter(DocStatus::cases(), fn (DocStatus $s) => $s->isPending()),
        );

        // Active providers — the live supply that can actually be found & booked:
        // Tier ≥ 1 with at least one ACTIVE service (the core listing gate).
        $activeProviders = ProviderProfile::query()
            ->where('trust_tier', '>=', 1)
            ->whereHas('services', fn ($q) => $q->where('status', 'ACTIVE'))
            ->count();

        $bookingsToday = Booking::query()
            ->whereDate('created_at', Carbon::today())
            ->count();

        $openDisputes = Dispute::query()
            ->whereIn('status', $openDisputeStates)
            ->count();

        $fraudFlags24h = CircumventionFlag::query()
            ->where('created_at', '>=', now()->subDay())
            ->count();

        $kycPending = IdentityDocument::query()
            ->whereIn('status', $pendingDocStates)
            ->count();

        // Open safety work = unresolved reports + still-active emergencies.
        $safetyOpen = SafetyReport::query()
                ->whereIn('status', ['OPEN', 'UNDER_REVIEW'])
                ->count()
            + EmergencyEvent::query()
                ->whereIn('status', ['ACTIVE', 'ACKNOWLEDGED'])
                ->count();

        // Payouts needing attention — a COMPLETED booking whose latest gateway
        // payout event FAILED (i.e. not yet DISBURSED). Mirrors the finance
        // payouts list's "failed" derivation.
        $payoutsFailed = DB::table('payment_events as pe')
            ->join('bookings as b', 'b.id', '=', 'pe.booking_id')
            ->where('pe.type', 'payout')
            ->where('pe.provider_status', 'FAILED')
            ->where('b.status', 'COMPLETED')
            ->distinct('pe.booking_id')
            ->count('pe.booking_id');

        return response()->json([
            'kpis' => [
                'active_providers' => $activeProviders,
                'bookings_today'   => $bookingsToday,
                'open_disputes'    => $openDisputes,
                'fraud_flags_24h'  => $fraudFlags24h,
            ],
            'queues' => [
                'kyc_pending'    => $kycPending,
                'safety_open'    => $safetyOpen,
                'payouts_failed' => $payoutsFailed,
            ],
            'generated_at' => now()->toIso8601String(),
        ]);
    }
}
