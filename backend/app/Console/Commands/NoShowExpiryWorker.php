<?php

namespace App\Console\Commands;

use App\Models\Booking;
use App\Models\ConversationState;
use App\Models\User;
use App\Services\BookingService;
use App\Services\WhatsApp\TemplateManager;
use Carbon\Carbon;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

/**
 * Provider-offline safety net: a FUNDS_HELD booking whose scheduled window
 * ended a grace period ago and was never started means the provider went
 * dark mid-booking. Cancel it, refund the customer's escrow hold, and tell
 * both parties — money must never sit in limbo.
 */
class NoShowExpiryWorker extends Command
{
    protected $signature   = 'escrow:expire-noshows';
    protected $description = 'Auto-cancel + refund FUNDS_HELD bookings whose scheduled window passed without the job starting.';

    public function handle(BookingService $bookings, TemplateManager $templates): int
    {
        $graceHours = (int) config('booking.no_show_grace_hours', 6);
        $cutoff     = Carbon::now()->subHours($graceHours);

        // DEPOSIT_HELD (quote-deposit) holds are refunded the same way — the
        // deposit is the customer's money in limbo when the provider goes dark.
        $stale = Booking::whereIn('status', ['FUNDS_HELD', 'DEPOSIT_HELD'])
            ->where('scheduled_end', '<=', $cutoff)
            ->with(['buyer', 'provider', 'service'])
            ->get();

        foreach ($stale as $booking) {
            try {
                $buyer = $booking->buyer ?? User::find($booking->buyer_id);
                if (! $buyer) {
                    continue;
                }

                // cancel() releases the escrow hold (gateway refund) for FUNDS_HELD.
                $bookings->cancel($booking->id, $buyer);

                Log::warning('NoShowExpiryWorker: stale FUNDS_HELD booking cancelled + refunded', [
                    'booking_id'  => $booking->id,
                    'provider_id' => $booking->provider_id,
                ]);

                $this->notifyParty(
                    $templates,
                    $buyer->phone,
                    "Your provider didn't start the job for \"" . ($booking->service->title ?? 'your booking') . "\" in time, "
                    . "so we've cancelled it and refunded your payment in full to your Mobile Money. Sorry about that — you can rebook anytime.",
                );

                $this->notifyParty(
                    $templates,
                    $booking->provider?->phone,
                    "The booking for \"" . ($booking->service->title ?? 'a service') . "\" was cancelled because it wasn't started in time. "
                    . "The customer has been refunded. Repeated no-shows affect your standing on Sebenza.",
                );
            } catch (\Throwable $e) {
                Log::error('NoShowExpiryWorker: failed to expire booking', [
                    'booking_id' => $booking->id,
                    'error'      => $e->getMessage(),
                ]);
            }
        }

        if ($stale->isNotEmpty()) {
            $this->info("Processed {$stale->count()} stale FUNDS_HELD booking(s).");
        }

        return self::SUCCESS;
    }

    private function notifyParty(TemplateManager $templates, ?string $phone, string $text): void
    {
        if (! $phone) {
            return;
        }

        try {
            $wa    = ltrim($phone, '+');
            $convo = ConversationState::where('whatsapp_id', $wa)->first();
            $templates->sendMessage($wa, $text, $convo);
        } catch (\Throwable $e) {
            Log::warning('NoShowExpiryWorker: notify failed', ['error' => $e->getMessage()]);
        }
    }
}
