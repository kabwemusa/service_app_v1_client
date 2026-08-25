<?php

namespace App\Services;

use App\Enums\ErrorCode;
use App\Exceptions\Api\ApiException;
use App\Models\AdminUser;
use App\Models\Booking;
use App\Models\Category;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Backend for the admin Finance & Commissions module (UI: admin/src/components/finance).
 *
 * Ops and revenue-health view — NOT a payout initiation tool. Reads the
 * existing commissions ledger, bookings, and the passive payment_events log
 * (App\Models\PaymentEvent) for escrow reconciliation. The only mutations are
 * commission-band edits (Category.commission_rates) and retrying a failed
 * payout (delegates to BookingService::disbursePayout — no new disbursement
 * path). Both run through AuditedMutationService.
 */
class AdminFinanceService
{
    public function __construct(
        private readonly AuditedMutationService $audit,
        private readonly BookingService $bookings,
    ) {}

    // ── Overview ─────────────────────────────────────────────────────────────────

    public function overview(array $filters): array
    {
        [$from, $to] = $this->periodRange($filters);

        $row = DB::table('commissions')
            ->whereBetween('calculated_at', [$from, $to])
            ->selectRaw('COALESCE(SUM(gross_amount), 0) as gmv')
            ->selectRaw("COALESCE(SUM(CASE WHEN collection_status = 'COLLECTED' THEN commission_amount ELSE 0 END), 0) as commission_collected")
            ->selectRaw('COALESCE(AVG(commission_rate), 0) as avg_commission_rate')
            ->first();

        $escrowFloat = (float) DB::table('bookings')
            ->where('status', 'FUNDS_HELD')
            ->sum(DB::raw('COALESCE(agreed_amount, amount, 0)'));

        $refunds = DB::table('payment_events')
            ->where('type', 'refund')
            ->where('provider_status', 'COMPLETED')
            ->whereBetween('created_at', [$from, $to])
            ->selectRaw('COUNT(*) as count, COALESCE(SUM(amount), 0) as total')
            ->first();

        $trend = DB::table('commissions')
            ->whereBetween('calculated_at', [Carbon::parse($to)->subDays(30), $to])
            ->selectRaw("DATE(calculated_at) as day")
            ->selectRaw('COALESCE(SUM(gross_amount), 0) as gmv')
            ->selectRaw('COALESCE(SUM(commission_amount), 0) as commission')
            ->groupBy('day')
            ->orderBy('day')
            ->get();

        $topCategories = DB::table('commissions as c')
            ->join('categories as cat', 'cat.id', '=', 'c.category_id')
            ->whereBetween('c.calculated_at', [$from, $to])
            ->selectRaw('cat.id, cat.name, COALESCE(SUM(c.gross_amount), 0) as gmv')
            ->groupBy('cat.id', 'cat.name')
            ->orderByDesc('gmv')
            ->limit(8)
            ->get();

        return [
            'period' => ['from' => $from->toDateString(), 'to' => $to->toDateString()],
            'kpis' => [
                'gmv'                  => (float) $row->gmv,
                'commission_collected' => (float) $row->commission_collected,
                'active_escrow_float'  => $escrowFloat,
                'refunds_issued'       => (int) $refunds->count,
                'refunds_total'        => (float) $refunds->total,
                'avg_commission_rate'  => round((float) $row->avg_commission_rate, 4),
            ],
            'trend' => $trend->map(fn ($r) => [
                'date'       => $r->day,
                'gmv'        => (float) $r->gmv,
                'commission' => (float) $r->commission,
            ])->all(),
            'top_categories' => $topCategories->map(fn ($r) => [
                'id' => $r->id, 'name' => $r->name, 'gmv' => (float) $r->gmv,
            ])->all(),
        ];
    }

    // ── Commissions ledger ───────────────────────────────────────────────────────

    public function commissionsList(array $filters): array
    {
        $query = DB::table('commissions as c')
            ->join('bookings as b', 'b.id', '=', 'c.booking_id')
            ->leftJoin('users as buyer', 'buyer.id', '=', 'b.buyer_id')
            ->leftJoin('users as prov', 'prov.id', '=', 'c.provider_id')
            ->leftJoin('provider_profiles as pp', 'pp.user_id', '=', 'c.provider_id')
            ->leftJoin('categories as cat', 'cat.id', '=', 'c.category_id')
            ->leftJoin('disputes as d', 'd.booking_id', '=', 'c.booking_id')
            ->select([
                'c.id', 'c.booking_id', 'c.gross_amount', 'c.commission_rate', 'c.commission_amount',
                'c.tier_at_time', 'c.collection_status', 'c.payment_mode', 'c.calculated_at',
                'cat.name as category_name',
                'buyer.legal_name as buyer_name', 'buyer.email as buyer_email',
                'pp.display_name as provider_name', 'prov.legal_name as provider_legal_name',
                'd.status as dispute_status',
            ])
            ->selectRaw("CASE
                WHEN d.status IN ('OPEN','UNDER_REVIEW','AWAITING_EVIDENCE') THEN 'disputed'
                WHEN c.collection_status = 'COLLECTED' THEN 'collected'
                ELSE 'uncollected' END as ledger_status");

        if (!empty($filters['category_id'])) {
            $query->where('c.category_id', $filters['category_id']);
        }
        if (($filters['tier'] ?? '') !== '') {
            $query->where('c.tier_at_time', (int) $filters['tier']);
        }
        if (!empty($filters['status'])) {
            match ($filters['status']) {
                'collected'   => $query->where('c.collection_status', 'COLLECTED'),
                'uncollected' => $query->where('c.collection_status', '!=', 'COLLECTED'),
                'disputed'    => $query->whereIn('d.status', ['OPEN', 'UNDER_REVIEW', 'AWAITING_EVIDENCE']),
                default       => null,
            };
        }
        if (!empty($filters['date_from'])) {
            $query->where('c.calculated_at', '>=', $filters['date_from']);
        }
        if (!empty($filters['date_to'])) {
            $query->where('c.calculated_at', '<=', $filters['date_to'] . ' 23:59:59');
        }

        $query->orderByDesc('c.calculated_at');

        $page = $query->paginate(20, ['*'], 'page', (int) ($filters['page'] ?? 1));

        return [
            'data' => collect($page->items())->map(fn ($r) => [
                'id'                => $r->id,
                'booking_id'        => $r->booking_id,
                'provider_name'     => $r->provider_name ?? $r->provider_legal_name ?? 'Provider',
                'buyer_name'        => $r->buyer_name ?? $r->buyer_email ?? 'Customer',
                'category_name'     => $r->category_name,
                'gross_amount'      => (float) $r->gross_amount,
                'commission_rate'   => (float) $r->commission_rate,
                'commission_amount' => (float) $r->commission_amount,
                'tier'              => (int) $r->tier_at_time,
                'status'            => $r->ledger_status,
                'payment_mode'      => $r->payment_mode,
                'calculated_at'     => $this->iso($r->calculated_at),
            ])->all(),
            'meta' => $this->pageMeta($page),
        ];
    }

    // ── Commission bands (category × tier rate matrix) ──────────────────────────

    public function commissionBands(): array
    {
        return Category::orderBy('name')->get()->map(fn (Category $c) => [
            'id'   => $c->id,
            'name' => $c->name,
            'rates' => [
                1 => $c->tierCommissionRate(1),
                2 => $c->tierCommissionRate(2),
                3 => $c->tierCommissionRate(3),
                4 => $c->tierCommissionRate(4),
            ],
        ])->all();
    }

    public function updateCommissionBand(Category $category, AdminUser $actor, array $rates, string $reason): array
    {
        $before = $category->commission_rates;

        $this->audit->perform(
            actor: $actor,
            action: 'finance.commission_band_update',
            targetType: 'category',
            targetId: (string) $category->id,
            reason: $reason,
            metadata: ['before' => $before, 'after' => $rates],
            mutation: fn () => $category->forceFill(['commission_rates' => $rates])->save(),
        );

        return $this->commissionBands();
    }

    // ── Escrow reconciliation ────────────────────────────────────────────────────

    public function escrowList(array $filters): array
    {
        $query = DB::table('payment_events as pe')
            ->leftJoin('bookings as b', 'b.id', '=', 'pe.booking_id')
            ->select(['pe.id', 'pe.booking_id', 'pe.external_ref', 'pe.type', 'pe.provider_status',
                      'pe.provider', 'pe.mno', 'pe.amount', 'pe.created_at', 'b.status as booking_status']);

        if (!empty($filters['type'])) {
            $query->where('pe.type', $filters['type']);
        }
        if (!empty($filters['date_from'])) {
            $query->where('pe.created_at', '>=', $filters['date_from']);
        }

        $query->orderByDesc('pe.created_at');

        $page = $query->paginate(20, ['*'], 'page', (int) ($filters['page'] ?? 1));

        $rows = collect($page->items())->map(function ($r) {
            $match = $this->matchStatus($r->type, $r->provider_status, $r->booking_status);
            return [
                'id'             => $r->id,
                'booking_id'     => $r->booking_id,
                'external_ref'   => $r->external_ref,
                'type'           => $r->type,
                'amount'         => $r->amount !== null ? (float) $r->amount : null,
                'mno'            => $r->mno,
                'provider'       => $r->provider,
                'provider_status' => $r->provider_status,
                'booking_status' => $r->booking_status,
                'match'          => $match,
                'created_at'     => $this->iso($r->created_at),
            ];
        });

        // Surface mismatches first within the page (they need manual resolution).
        $sorted = $rows->sortBy(fn ($r) => $r['match'] === 'MISMATCH' ? 0 : ($r['match'] === 'PENDING' ? 1 : 2))->values();

        return ['data' => $sorted->all(), 'meta' => $this->pageMeta($page)];
    }

    private function matchStatus(string $type, string $providerStatus, ?string $bookingStatus): string
    {
        // SETTLED is a post-success treasury event (our wallet credited) written
        // by earlier processors; the booking already advanced on the success
        // event, so it reconciles exactly like COMPLETED rather than sitting
        // forever as PENDING. Lipila has no equivalent event, but historical rows
        // still carry the status.
        $terminal = in_array($providerStatus, ['COMPLETED', 'SETTLED', 'FAILED', 'REJECTED'], true);
        if (!$terminal) {
            return 'PENDING';
        }
        if (in_array($providerStatus, ['FAILED', 'REJECTED'], true)) {
            // A failed collection/payout/refund that left the booking in an
            // "advanced" state would be a real mismatch worth a look.
            $advanced = in_array($bookingStatus, ['FUNDS_HELD', 'IN_PROGRESS', 'DELIVERED', 'COMPLETED', 'DISBURSED'], true);
            return $advanced ? 'MISMATCH' : 'MATCHED';
        }

        return match ($type) {
            'collection' => in_array($bookingStatus, ['FUNDS_HELD', 'IN_PROGRESS', 'DELIVERED', 'COMPLETED', 'DISBURSED'], true) ? 'MATCHED' : 'MISMATCH',
            'payout'     => $bookingStatus === 'DISBURSED' ? 'MATCHED' : 'MISMATCH',
            'refund'     => $bookingStatus === 'CANCELLED' ? 'MATCHED' : 'MISMATCH',
            default      => 'PENDING',
        };
    }

    // ── Payouts ──────────────────────────────────────────────────────────────────

    public function payoutsList(array $filters): array
    {
        $query = DB::table('bookings as b')
            ->join('users as prov', 'prov.id', '=', 'b.provider_id')
            ->leftJoin('provider_profiles as pp', 'pp.user_id', '=', 'b.provider_id')
            ->leftJoin('commissions as c', 'c.booking_id', '=', 'b.id')
            ->whereIn('b.status', ['COMPLETED', 'DISBURSED'])
            ->select([
                'b.id as booking_id', 'b.provider_id', 'b.status as booking_status',
                'b.disbursed_at', 'b.agreed_amount', 'b.amount',
                'pp.display_name', 'prov.legal_name', 'pp.momo_number',
                'c.net_to_provider',
            ]);

        if (!empty($filters['provider_id'])) {
            $query->where('b.provider_id', $filters['provider_id']);
        }
        if (!empty($filters['date_from'])) {
            $query->where('b.completed_at', '>=', $filters['date_from']);
        }

        $query->orderByDesc(DB::raw('COALESCE(b.disbursed_at, b.completed_at)'));

        $page = $query->paginate(20, ['*'], 'page', (int) ($filters['page'] ?? 1));
        $bookingIds = collect($page->items())->pluck('booking_id')->all();

        $latestPayoutEvents = DB::table('payment_events')
            ->where('type', 'payout')
            ->whereIn('booking_id', $bookingIds)
            ->orderByDesc('created_at')
            ->get()
            ->groupBy('booking_id')
            ->map(fn ($g) => $g->first());

        $rows = collect($page->items())->map(function ($r) use ($latestPayoutEvents) {
            $event  = $latestPayoutEvents->get($r->booking_id);
            $status = $r->booking_status === 'DISBURSED'
                ? 'success'
                : ($event && $event->provider_status === 'FAILED' ? 'failed' : 'pending');

            return [
                'booking_id'     => $r->booking_id,
                'provider_id'    => $r->provider_id,
                'provider_name'  => $r->display_name ?? $r->legal_name ?? 'Provider',
                'amount'         => (float) ($r->net_to_provider ?? $r->agreed_amount ?? $r->amount ?? 0),
                'momo_masked'    => $this->maskMomo($r->momo_number),
                'status'         => $status,
                'provider_ref'    => $event?->external_ref,
                'timestamp'      => $this->iso($r->disbursed_at ?? $event?->created_at),
            ];
        });

        if (!empty($filters['status'])) {
            $rows = $rows->where('status', $filters['status'])->values();
        }

        return ['data' => $rows->all(), 'meta' => $this->pageMeta($page)];
    }

    public function retryPayout(string $bookingId, AdminUser $actor, string $reason): array
    {
        $booking = Booking::with('provider.providerProfile', 'service')->find($bookingId);
        if (!$booking) {
            throw new ApiException(ErrorCode::NOT_FOUND, 'Booking not found.');
        }
        if ($booking->status === 'DISBURSED') {
            throw new ApiException(ErrorCode::CONFLICT, 'This payout has already been disbursed.');
        }

        $this->audit->perform(
            actor: $actor,
            action: 'finance.payout_retry',
            targetType: 'booking',
            targetId: $booking->id,
            reason: $reason,
            metadata: ['before' => ['status' => $booking->status]],
            mutation: fn () => $this->bookings->disbursePayout($booking),
        );

        return $this->payoutsList(['provider_id' => $booking->provider_id]);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────

    private function periodRange(array $filters): array
    {
        $period = $filters['period'] ?? 'month';
        $now    = Carbon::now();

        return match ($period) {
            'today' => [$now->copy()->startOfDay(), $now->copy()->endOfDay()],
            'week'  => [$now->copy()->startOfWeek(), $now->copy()->endOfWeek()],
            'custom' => [
                Carbon::parse($filters['from'] ?? $now->copy()->startOfMonth()),
                Carbon::parse($filters['to'] ?? $now),
            ],
            default => [$now->copy()->startOfMonth(), $now->copy()->endOfMonth()],
        };
    }

    private function maskMomo(?string $momo): ?string
    {
        if (!$momo) return null;
        return '••• ••• ' . mb_substr($momo, -3);
    }

    private function pageMeta($page): array
    {
        return [
            'current_page' => $page->currentPage(),
            'last_page'    => $page->lastPage(),
            'per_page'     => $page->perPage(),
            'total'        => $page->total(),
        ];
    }

    private function iso($value): ?string
    {
        if ($value === null) return null;
        return $value instanceof \DateTimeInterface
            ? $value->format(\DateTimeInterface::ATOM)
            : Carbon::parse($value)->toIso8601String();
    }
}
