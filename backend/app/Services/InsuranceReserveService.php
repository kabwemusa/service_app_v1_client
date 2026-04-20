<?php

namespace App\Services;

use App\Models\Booking;
use App\Models\Dispute;
use App\Models\InsuranceReserveEntry;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Insurance reserve ledger — §11.5
 *
 * Tracks the pool funded by buyer protection fees (2%, capped ZMW 50).
 * Claims draw from the pool. Monthly ratio alert if claims > 60% of credits.
 */
class InsuranceReserveService
{
    private float $alertThreshold;

    public function __construct()
    {
        $this->alertThreshold = 0.60;
    }

    /**
     * Credit the protection fee collected at booking creation.
     * Called from BookingService::complete() after funds are confirmed.
     */
    public function credit(Booking $booking): InsuranceReserveEntry
    {
        return InsuranceReserveEntry::create([
            'entry_type' => 'CREDIT',
            'amount'     => (float) $booking->buyer_protection_fee,
            'booking_id' => $booking->id,
            'note'       => "Protection fee for booking {$booking->id}",
            'created_at' => now(),
        ]);
    }

    /**
     * Debit a claim (RESOLVED_BUYER dispute or property damage).
     * Called from DisputeService after a full refund outcome.
     */
    public function claim(Dispute $dispute, float $amount, ?string $note = null): InsuranceReserveEntry
    {
        return InsuranceReserveEntry::create([
            'entry_type' => 'CLAIM',
            'amount'     => $amount,
            'booking_id' => $dispute->booking_id,
            'dispute_id' => $dispute->id,
            'note'       => $note ?? "Claim from dispute {$dispute->id}",
            'created_at' => now(),
        ]);
    }

    /**
     * Admin manual adjustment (e.g. seeding the reserve, removing an error entry).
     */
    public function adjust(float $amount, string $note, string $adminId): InsuranceReserveEntry
    {
        return InsuranceReserveEntry::create([
            'entry_type' => 'ADJUSTMENT',
            'amount'     => $amount,
            'note'       => $note,
            'created_by' => $adminId,
            'created_at' => now(),
        ]);
    }

    /**
     * Running balance: credits − claims − adjustments (adjustments can be positive or negative in notes).
     */
    public function balance(): float
    {
        $credits = InsuranceReserveEntry::where('entry_type', 'CREDIT')->sum('amount');
        $claims  = InsuranceReserveEntry::where('entry_type', 'CLAIM')->sum('amount');
        return (float) ($credits - $claims);
    }

    /**
     * 90-day rolling claim ratio (§11.5 — alert if > 60%).
     */
    public function claimRatio90d(): float
    {
        $since   = now()->subDays(90);
        $credits = InsuranceReserveEntry::where('entry_type', 'CREDIT')->where('created_at', '>=', $since)->sum('amount');
        $claims  = InsuranceReserveEntry::where('entry_type', 'CLAIM')->where('created_at', '>=', $since)->sum('amount');

        if ($credits <= 0) return 0.0;

        $ratio = $claims / $credits;

        if ($ratio > $this->alertThreshold) {
            Log::alert('InsuranceReserveService: claim ratio exceeds 60%', [
                'ratio'   => round($ratio * 100, 1) . '%',
                'credits' => $credits,
                'claims'  => $claims,
            ]);
        }

        return $ratio;
    }

    /**
     * Summary for the admin financial ops panel (§14.4).
     */
    public function summary(): array
    {
        $credits    = InsuranceReserveEntry::where('entry_type', 'CREDIT')->sum('amount');
        $claims     = InsuranceReserveEntry::where('entry_type', 'CLAIM')->sum('amount');
        $adjustments= InsuranceReserveEntry::where('entry_type', 'ADJUSTMENT')->sum('amount');

        return [
            'total_credits'    => (float) $credits,
            'total_claims'     => (float) $claims,
            'total_adjustments'=> (float) $adjustments,
            'balance'          => (float) ($credits - $claims + $adjustments),
            'claim_ratio_90d'  => $this->claimRatio90d(),
        ];
    }
}
