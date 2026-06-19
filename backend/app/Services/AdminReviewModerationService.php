<?php

namespace App\Services;

use App\Enums\ErrorCode;
use App\Exceptions\Api\ApiException;
use App\Models\AdminUser;
use App\Models\Review;
use App\Services\Ranking\RankingService;
use Illuminate\Support\Facades\DB;

/**
 * Backend for the admin Reviews moderation module
 * (UI: admin/src/components/reviews).
 *
 * It moderates the reviews that feed the provider rating (§7.1) and links out to
 * Users (author / provider) and Fraud (coordinated manipulation). Every action
 * runs through AuditedMutationService so each writes an audit entry in one
 * transaction.
 *
 * SCOPE (consumes, never invents — impl_v3 §7.1 / §10.4 / §12):
 *   - Only COMPLETED-booking reviews exist (§12) → the verified-booking marker.
 *   - §7.1 Bayesian rating is shown and RECOMPUTED on removal via the SAME
 *     formula the nightly job uses (AVG/COUNT + RankingService::decayedRatingMean)
 *     — reviews are NEVER edited, only soft-removed / restored.
 *   - The flag queue = OPEN rows in review_flags (reports / upstream jobs) PLUS
 *     computed auto-flags (profanity / PII / spam-links) and a pattern-flag
 *     (review-spike / rating-bombing, §10.4 — also a Fraud signal, link out).
 *
 * PRIVACY: the reviewer is shown as normally displayed (first name + initial);
 * no extra PII; internal 0–1 scores (trust_score / risk_score) are never exposed.
 */
class AdminReviewModerationService
{
    /** Audit actions counting as a moderation state change (for "latest reason"). */
    private const MODERATION_ACTIONS = [
        'review.remove', 'review.restore', 'review.remove_response', 'review.clear_flags',
    ];

    /** §10.4 review-spike: provider gets this many reviews within the window. */
    private const SPIKE_THRESHOLD = 5;
    private const SPIKE_WINDOW = "interval '24 hours'";

    /** Modest profanity set — the real classifier (source = auto) is upstream. */
    private const PROFANITY = 'fuck|shit|bitch|asshole|bastard|cunt|dick|piss|slut|whore|nigger|faggot|motherfucker';

    public function __construct(
        private readonly AuditedMutationService $audit,
        private readonly RankingService $ranking,
    ) {}

    // ── List ─────────────────────────────────────────────────────────────────────

    public function list(array $filters): array
    {
        $tab = $filters['tab'] ?? 'needs_review';

        $query = DB::table('reviews as r')
            ->leftJoin('bookings as b', 'b.id', '=', 'r.booking_id')
            ->leftJoin('services as s', 's.id', '=', 'b.service_id')
            ->leftJoin('users as rev', 'rev.id', '=', 'r.reviewer_id')
            ->leftJoin('users as pro', 'pro.id', '=', 'r.reviewee_id')
            ->leftJoin('provider_profiles as pp', 'pp.user_id', '=', 'r.reviewee_id')
            ->select([
                'r.id', 'r.rating', 'r.comment', 'r.created_at', 'r.removed_at',
                'r.flags_cleared_at', 'r.reviewer_id', 'r.reviewee_id', 'r.booking_id',
                's.title as service_title',
                'rev.legal_name as reviewer_legal_name', 'rev.email as reviewer_email',
                'pp.display_name as provider_name', 'pro.legal_name as provider_legal_name',
                'pro.email as provider_email',
            ])
            ->selectRaw('(' . $this->openFlagExists() . ')::int as has_open_flag');

        // ── Search (comment / reviewer / provider) ──
        if (!empty($filters['search'])) {
            $term = '%' . $filters['search'] . '%';
            $query->where(function ($w) use ($term) {
                $w->where('r.comment', 'ilike', $term)
                  ->orWhere('rev.legal_name', 'ilike', $term)
                  ->orWhere('pp.display_name', 'ilike', $term)
                  ->orWhere('pro.legal_name', 'ilike', $term);
            });
        }

        // ── Browse filters (mostly the "All reviews" tab) ──
        if (($filters['rating'] ?? '') !== '') {
            $query->where('r.rating', (float) $filters['rating']);
        }
        if (!empty($filters['provider'])) {
            $query->where('r.reviewee_id', $filters['provider']);
        }
        if (!empty($filters['date_from'])) {
            $query->where('r.created_at', '>=', $filters['date_from']);
        }
        if (!empty($filters['date_to'])) {
            $query->where('r.created_at', '<=', $filters['date_to'] . ' 23:59:59');
        }
        if (!empty($filters['flag_type'])) {
            $this->applyFlagTypeFilter($query, $filters['flag_type']);
        }

        if ($tab === 'needs_review') {
            // Active reviews with at least one live or persisted flag.
            $query->whereNull('r.removed_at')->where(function ($w) {
                $w->whereRaw($this->openFlagExists())
                  ->orWhere(function ($c) {
                      $c->whereNull('r.flags_cleared_at')->where(function ($f) {
                          $f->whereRaw($this->profanityPredicate('r'))
                            ->orWhereRaw($this->piiPredicate('r'))
                            ->orWhereRaw($this->linkPredicate('r'))
                            ->orWhereRaw($this->spikePredicate('r'));
                      });
                  });
            });
            $query->orderBy('r.created_at'); // oldest-waiting first
        } else {
            $query->orderByDesc('r.created_at');
        }

        $page = $query->paginate(20, ['*'], 'page', (int) ($filters['page'] ?? 1));

        return [
            'data' => collect($page->items())->map(fn ($row) => $this->presentRow($row))->all(),
            'meta' => [
                'current_page' => $page->currentPage(),
                'last_page'    => $page->lastPage(),
                'per_page'     => $page->perPage(),
                'total'        => $page->total(),
            ],
        ];
    }

    private function applyFlagTypeFilter($query, string $type): void
    {
        match ($type) {
            'reported'       => $query->whereRaw($this->openFlagExists("'REPORTED'")),
            'profanity'      => $query->whereRaw($this->profanityPredicate('r')),
            'pii'            => $query->whereRaw($this->piiPredicate('r')),
            'spam_link'      => $query->whereRaw($this->linkPredicate('r')),
            'review_spike'   => $query->whereRaw($this->spikePredicate('r')),
            'removed'        => $query->whereNotNull('r.removed_at'),
            default          => null,
        };
    }

    private function presentRow(object $row): array
    {
        return [
            'id'            => $row->id,
            'rating'        => (float) $row->rating,
            'snippet'       => $this->snippet($row->comment),
            'service_title' => $row->service_title,
            'verified_booking' => true, // §12 — only COMPLETED bookings yield reviews
            'reviewer'      => [
                'id'   => $row->reviewer_id,
                'name' => $this->reviewerName($row->reviewer_legal_name, $row->reviewer_email),
            ],
            'provider'      => [
                'id'   => $row->reviewee_id,
                'name' => $this->providerName($row->provider_name, $row->provider_legal_name, $row->provider_email),
            ],
            'status'        => $row->removed_at ? 'REMOVED' : 'VISIBLE',
            'flags'         => $this->rowFlags($row),
            'created_at'    => $this->iso($row->created_at),
        ];
    }

    // ── Detail ───────────────────────────────────────────────────────────────────

    public function detail(Review $review): array
    {
        $review->loadMissing(['booking.service', 'reviewer', 'reviewee.providerProfile']);

        $booking  = $review->booking;
        $service  = $booking?->service;
        $reviewer = $review->reviewer;
        $provider = $review->reviewee;

        $hasResponse = $review->response_at !== null && $review->response_removed_at === null;

        return [
            'id'         => $review->id,
            'rating'     => (float) $review->rating,
            'comment'    => $review->comment,
            'status'     => $review->removed_at ? 'REMOVED' : 'VISIBLE',
            'created_at' => $this->iso($review->created_at),
            'removed_at' => $this->iso($review->removed_at),
            'moderation_reason' => $review->removed_at ? $this->latestModerationReason($review->id) : null,

            // ── Booking / service context (§12 — verified booking) ──
            'verified_booking' => true,
            'booking' => $booking ? [
                'id'     => $booking->id,
                'status' => $booking->status,
            ] : null,
            'service' => $service ? [
                'id'    => $service->id,
                'title' => $service->title,
            ] : null,

            // ── Parties (link out to Users) ──
            'reviewer' => [
                'id'   => $reviewer?->id,
                'name' => $this->reviewerName($reviewer?->legal_name, $reviewer?->email),
            ],
            'provider' => [
                'id'            => $provider?->id,
                'name'          => $this->providerName($provider?->providerProfile?->display_name, $provider?->legal_name, $provider?->email),
                'avatar_url'    => $provider?->providerProfile?->avatar_url,
                'trust_tier'    => (int) ($provider?->providerProfile?->trust_tier ?? 0),
                'account_state' => $provider?->account_state ?? 'ACTIVE',
            ],

            // ── Provider response (moderated separately) ──
            'response' => $hasResponse ? [
                'text'        => $review->response_text,
                'responded_at'=> $this->iso($review->response_at),
            ] : null,

            // ── §7.1 current Bayesian rating for the provider reviewed ──
            'provider_rating' => $this->providerRating($provider),

            // ── Flags (persisted + computed) ──
            'flags' => $this->reviewFlags($review),
        ];
    }

    /** §7.1 — current rating triple for display. Removing this review recomputes it. */
    private function providerRating($provider): array
    {
        $rRaw     = (float) ($provider?->r_raw ?? 0);
        $vReviews = (int) ($provider?->v_reviews ?? 0);
        $cMean    = $this->ranking->getCMean();

        return [
            'r_raw'         => $vReviews > 0 ? round($rRaw, 2) : null,
            'reviews_count' => $vReviews,
            // Bayesian rating (§7.1) — shrinks a thin record toward the platform mean.
            'r_bayes'       => $vReviews > 0 ? round($this->ranking->computeRBayes($rRaw, $vReviews, $cMean), 2) : null,
        ];
    }

    // ── Flag derivation ──────────────────────────────────────────────────────────

    /** Detail-level flags: persisted OPEN review_flags + computed auto/pattern. */
    private function reviewFlags(Review $review): array
    {
        $flags = [];

        foreach (DB::table('review_flags')->where('review_id', $review->id)->where('status', 'OPEN')->get() as $f) {
            $flags[] = [
                'reason' => $f->reason,
                'source' => $f->source,
                'detail' => $this->flagDetail($f),
            ];
        }

        // Computed flags are suppressed once a moderator marks "not a violation".
        if ($review->flags_cleared_at === null) {
            $text = (string) ($review->comment ?? '');
            if ($text !== '' && preg_match('/\b(' . self::PROFANITY . ')\b/i', $text)) {
                $flags[] = ['reason' => 'PROFANITY', 'source' => 'auto', 'detail' => 'Comment contains flagged language'];
            }
            if ($this->detectPii($text) !== null) {
                $flags[] = ['reason' => 'PII', 'source' => 'auto', 'detail' => $this->detectPii($text)];
            }
            if ($this->detectLink($text)) {
                $flags[] = ['reason' => 'SPAM_LINK', 'source' => 'auto', 'detail' => 'Comment contains a link or external handle'];
            }
            if ($this->isSpike($review->reviewee_id)) {
                $flags[] = ['reason' => 'REVIEW_SPIKE', 'source' => 'pattern', 'detail' => 'Provider received ' . self::SPIKE_THRESHOLD . '+ reviews in 24h — possible rating manipulation'];
            }
        }

        return $flags;
    }

    /** Lightweight flags for a list row. */
    private function rowFlags(object $row): array
    {
        $flags = [];

        if ((int) $row->has_open_flag === 1) {
            foreach (DB::table('review_flags')->where('review_id', $row->id)->where('status', 'OPEN')->pluck('reason') as $reason) {
                $flags[] = ['reason' => $reason, 'source' => 'flag', 'detail' => null];
            }
        }

        if ($row->flags_cleared_at === null && $row->removed_at === null) {
            $text = (string) ($row->comment ?? '');
            if ($text !== '' && preg_match('/\b(' . self::PROFANITY . ')\b/i', $text)) {
                $flags[] = ['reason' => 'PROFANITY', 'source' => 'auto', 'detail' => null];
            }
            if ($this->detectPii($text) !== null) {
                $flags[] = ['reason' => 'PII', 'source' => 'auto', 'detail' => null];
            }
            if ($this->detectLink($text)) {
                $flags[] = ['reason' => 'SPAM_LINK', 'source' => 'auto', 'detail' => null];
            }
            if ($this->isSpike($row->reviewee_id)) {
                $flags[] = ['reason' => 'REVIEW_SPIKE', 'source' => 'pattern', 'detail' => null];
            }
        }

        return $flags;
    }

    private function isSpike(?string $revieweeId): bool
    {
        if (!$revieweeId) return false;
        $count = DB::table('reviews')
            ->where('reviewee_id', $revieweeId)
            ->whereNull('removed_at')
            ->whereRaw("created_at > NOW() - " . self::SPIKE_WINDOW)
            ->count();

        return $count >= self::SPIKE_THRESHOLD;
    }

    private function flagDetail(object $flag): ?string
    {
        $details = $flag->details ? json_decode($flag->details, true) : null;
        return is_array($details) && isset($details['note']) ? (string) $details['note'] : null;
    }

    private function detectPii(string $text): ?string
    {
        if (preg_match('/(\+?\d[\d\s().\-]{6,}\d)/', $text)) {
            return 'Possible phone number in review text';
        }
        if (preg_match('/[\w.+-]+@[\w-]+\.[\w.-]+/i', $text)) {
            return 'Possible email address in review text';
        }
        return null;
    }

    private function detectLink(string $text): bool
    {
        return (bool) preg_match('#(https?://|www\.|t\.me/|wa\.me/|instagram\.com/|fb\.me/|@[A-Za-z0-9_]{3,})#i', $text);
    }

    // ── Moderation actions (all audited) ─────────────────────────────────────────

    public function remove(Review $review, AdminUser $actor, string $reason): array
    {
        if ($review->removed_at !== null) {
            throw new ApiException(ErrorCode::CONFLICT, 'This review has already been removed.');
        }

        $before = $this->providerRating($review->reviewee);

        $this->audit->perform(
            actor: $actor,
            action: 'review.remove',
            targetType: 'review',
            targetId: $review->id,
            reason: $reason,
            metadata: [
                'before' => ['provider_rating' => $before['r_raw'], 'reviews_count' => $before['reviews_count']],
                'after'  => ['removed' => true],
            ],
            mutation: function () use ($review, $actor) {
                $review->forceFill(['removed_at' => now(), 'removed_by' => $actor->id])->save();
                // Mark any open flags as actioned.
                DB::table('review_flags')->where('review_id', $review->id)->where('status', 'OPEN')
                    ->update(['status' => 'ACTIONED', 'reviewed_by' => $actor->id, 'reviewed_at' => now(), 'updated_at' => now()]);
                // §7.1 — recompute the provider's rating now that this review is gone.
                $this->recomputeRating($review->reviewee_id);
            },
        );

        return $this->detail($review->fresh());
    }

    public function restore(Review $review, AdminUser $actor, string $reason): array
    {
        if ($review->removed_at === null) {
            throw new ApiException(ErrorCode::CONFLICT, 'This review is not removed.');
        }

        $this->audit->perform(
            actor: $actor,
            action: 'review.restore',
            targetType: 'review',
            targetId: $review->id,
            reason: $reason,
            metadata: ['before' => ['removed' => true], 'after' => ['removed' => false]],
            mutation: function () use ($review) {
                $review->forceFill(['removed_at' => null, 'removed_by' => null])->save();
                $this->recomputeRating($review->reviewee_id);
            },
        );

        return $this->detail($review->fresh());
    }

    public function removeResponse(Review $review, AdminUser $actor, string $reason): array
    {
        if ($review->response_at === null || $review->response_removed_at !== null) {
            throw new ApiException(ErrorCode::CONFLICT, 'There is no active provider response to remove.');
        }

        $this->audit->perform(
            actor: $actor,
            action: 'review.remove_response',
            targetType: 'review',
            targetId: $review->id,
            reason: $reason,
            metadata: ['after' => ['response_removed' => true]],
            mutation: fn () => $review->forceFill(['response_removed_at' => now()])->save(),
        );

        return $this->detail($review->fresh());
    }

    public function markNotViolation(Review $review, AdminUser $actor, string $reason): array
    {
        $openFlags = DB::table('review_flags')->where('review_id', $review->id)->where('status', 'OPEN')->count();
        if ($review->flags_cleared_at !== null && $openFlags === 0) {
            throw new ApiException(ErrorCode::CONFLICT, 'This review has no outstanding flags to clear.');
        }

        $this->audit->perform(
            actor: $actor,
            action: 'review.clear_flags',
            targetType: 'review',
            targetId: $review->id,
            reason: $reason,
            metadata: ['after' => ['flags_cleared' => true]],
            mutation: function () use ($review, $actor) {
                $review->forceFill(['flags_cleared_at' => now()])->save();
                DB::table('review_flags')->where('review_id', $review->id)->where('status', 'OPEN')
                    ->update(['status' => 'DISMISSED', 'reviewed_by' => $actor->id, 'reviewed_at' => now(), 'updated_at' => now()]);
            },
        );

        return $this->detail($review->fresh());
    }

    // ── §7.1 recompute (reuses the nightly job's exact formula) ──────────────────

    /**
     * Refresh the provider's rating triple from NON-REMOVED reviews — identical
     * computation to ComputeTrustScoreJob::refreshRatings(), scoped to one user
     * and reusing RankingService::decayedRatingMean(). Runs inside the action's
     * transaction so the audit entry and the rating change are atomic.
     */
    private function recomputeRating(string $revieweeId): void
    {
        $rows = DB::select("
            SELECT rating,
                   EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400.0 AS age_days
            FROM   reviews
            WHERE  reviewee_id = ? AND removed_at IS NULL
        ", [$revieweeId]);

        $count = count($rows);
        $avg   = $count > 0 ? round(array_sum(array_map(fn ($r) => (float) $r->rating, $rows)) / $count, 2) : 0.00;

        $decayed = $this->ranking->decayedRatingMean(array_map(
            fn ($r) => ['rating' => (float) $r->rating, 'age_days' => (float) $r->age_days],
            $rows,
        ));

        DB::table('users')->where('id', $revieweeId)->update([
            'r_raw'     => $avg,
            'v_reviews' => $count,
            'r_decayed' => $decayed !== null ? round($decayed, 2) : null,
        ]);

        // The platform mean shifts slightly — let the hourly cache rebuild.
        $this->ranking->invalidateCMean();
    }

    // ── SQL predicates ───────────────────────────────────────────────────────────

    private function openFlagExists(?string $reasonLiteral = null): string
    {
        $reason = $reasonLiteral ? " AND rf.reason = $reasonLiteral" : '';
        return "EXISTS (SELECT 1 FROM review_flags rf WHERE rf.review_id = r.id AND rf.status = 'OPEN'$reason)";
    }

    private function profanityPredicate(string $a): string
    {
        return "$a.comment ~* '\\y(" . self::PROFANITY . ")\\y'";
    }

    private function piiPredicate(string $a): string
    {
        $phone = "$a.comment ~ '(\\+?[0-9][0-9 ().\\-]{6,}[0-9])'";
        $email = "$a.comment ~* '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}'";
        return "($phone OR $email)";
    }

    private function linkPredicate(string $a): string
    {
        return "$a.comment ~* '(https?://|www\\.|t\\.me/|wa\\.me/|instagram\\.com/|fb\\.me/|@[A-Za-z0-9_]{3,})'";
    }

    private function spikePredicate(string $a): string
    {
        $t = self::SPIKE_THRESHOLD;
        return "((SELECT COUNT(*) FROM reviews r2 WHERE r2.reviewee_id = $a.reviewee_id AND r2.removed_at IS NULL
                  AND r2.created_at > NOW() - " . self::SPIKE_WINDOW . ") >= $t)";
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────

    private function latestModerationReason(string $reviewId): ?string
    {
        $row = DB::table('admin_audit_log')
            ->where('target_type', 'review')
            ->where('target_id', $reviewId)
            ->whereIn('action', self::MODERATION_ACTIONS)
            ->orderByDesc('created_at')
            ->first(['reason']);

        return $row?->reason;
    }

    private function snippet(?string $comment): string
    {
        if (!$comment) return '';
        $comment = trim($comment);
        return mb_strlen($comment) > 140 ? mb_substr($comment, 0, 140) . '…' : $comment;
    }

    /** Reviewer shown as normally displayed: first name + last initial (no extra PII). */
    private function reviewerName(?string $legalName, ?string $email): string
    {
        if ($legalName) {
            $parts = preg_split('/\s+/', trim($legalName));
            $first = $parts[0] ?? '';
            if (count($parts) > 1) {
                return $first . ' ' . mb_substr(end($parts), 0, 1) . '.';
            }
            return $first;
        }
        if ($email) return explode('@', $email)[0];
        return 'Customer';
    }

    private function providerName(?string $displayName, ?string $legalName, ?string $email): string
    {
        if ($displayName) return $displayName;
        if ($legalName)   return $legalName;
        if ($email)       return explode('@', $email)[0];
        return 'Provider';
    }

    private function iso($value): ?string
    {
        if ($value === null) return null;
        return $value instanceof \DateTimeInterface
            ? $value->format(\DateTimeInterface::ATOM)
            : \Illuminate\Support\Carbon::parse($value)->toIso8601String();
    }
}
