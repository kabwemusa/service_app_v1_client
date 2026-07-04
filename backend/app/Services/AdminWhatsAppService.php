<?php

namespace App\Services;

use App\Enums\ErrorCode;
use App\Exceptions\Api\ApiException;
use App\Models\AdminUser;
use App\Models\ConversationState;
use App\Services\WhatsApp\TemplateManager;
use App\Support\MnoResolver;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Backend for the admin WhatsApp & Conversation Ops module
 * (UI: admin/src/components/whatsapp). Ops visibility, not a chat tool.
 *
 * Reads:
 *   - conversation_states — the real conversation state machine (state,
 *     sub_state, last_inbound_at, booking_id). Message CONTENT is never
 *     read or shown — only state + metadata.
 *   - whatsapp_webhook_logs — the passive log added alongside
 *     WhatsAppWebhookController (App\Models\WhatsAppWebhookLog).
 *   - TemplateManager::getTemplateRegistry() — the static template set.
 *     Meta approval status / send volume are NOT tracked anywhere in this
 *     codebase (templates are managed in Meta Business Manager), so the
 *     Templates tab is read-only and links out rather than fabricating a
 *     status this system doesn't actually know.
 *
 * STUCK_THRESHOLD_MINUTES matches nothing in config/whatsapp.php (no such
 * setting exists yet) — kept as a local constant, documented here rather
 * than silently invented as a "platform setting".
 */
class AdminWhatsAppService
{
    private const STUCK_THRESHOLD_MINUTES = 30;
    private const TERMINAL_STATES = ['COMPLETED', 'EXPIRED', 'CANCELLED', 'NO_PROVIDERS', 'PAYMENT_FAILED'];

    public function __construct(
        private readonly AuditedMutationService $audit,
        private readonly TemplateManager $templates,
    ) {}

    // ── Overview ─────────────────────────────────────────────────────────────────

    public function overview(): array
    {
        $activeConversations = ConversationState::where('last_inbound_at', '>=', now()->subDay())->count();

        $messagesReceivedToday = DB::table('whatsapp_webhook_logs')
            ->where('kind', 'message')
            ->whereDate('created_at', today())
            ->count();

        $failedSends = DB::table('whatsapp_webhook_logs')
            ->where('kind', 'status')->where('type', 'failed')
            ->whereDate('created_at', today())
            ->count();

        $totalConvos = ConversationState::where('created_at', '>=', now()->subDays(30))->count();
        $bookedConvos = ConversationState::where('created_at', '>=', now()->subDays(30))->whereNotNull('booking_id')->count();

        $volume = DB::table('whatsapp_webhook_logs')
            ->where('created_at', '>=', now()->subDays(7))
            ->selectRaw('DATE(created_at) as day, kind, COUNT(*) as count')
            ->groupBy('day', 'kind')
            ->orderBy('day')
            ->get();

        $byDay = [];
        foreach ($volume as $row) {
            $byDay[$row->day] ??= ['date' => $row->day, 'sent' => 0, 'received' => 0];
            if ($row->kind === 'status') $byDay[$row->day]['sent'] += (int) $row->count;
            if ($row->kind === 'message') $byDay[$row->day]['received'] += (int) $row->count;
        }

        // MNO delivery health — derived from the recipient number on delivery
        // status callbacks (Meta doesn't expose the carrier itself).
        $statusRows = DB::table('whatsapp_webhook_logs')
            ->where('kind', 'status')
            ->where('created_at', '>=', now()->subDays(7))
            ->get(['from_number', 'type']);

        $mnoHealth = [];
        foreach ($statusRows as $row) {
            $mno = MnoResolver::forPhone($row->from_number);
            $mnoHealth[$mno] ??= ['mno' => $mno, 'delivered' => 0, 'failed' => 0, 'other' => 0];
            match ($row->type) {
                'delivered', 'read' => $mnoHealth[$mno]['delivered']++,
                'failed'            => $mnoHealth[$mno]['failed']++,
                default             => $mnoHealth[$mno]['other']++,
            };
        }

        return [
            'kpis' => [
                'active_conversations_24h'   => $activeConversations,
                'messages_received_today'    => $messagesReceivedToday,
                'failed_sends_today'         => $failedSends,
                'conversation_to_booking_rate' => $totalConvos > 0 ? round($bookedConvos / $totalConvos, 3) : null,
            ],
            'volume'     => array_values($byDay),
            'mno_health' => array_values($mnoHealth),
        ];
    }

    // ── Templates (read-only — managed in Meta Business Manager) ────────────────

    public function templates(): array
    {
        return collect($this->templates->getTemplateRegistry())->map(fn ($t) => [
            'name'     => $t['name'],
            'category' => $t['category'],
            'language' => config('whatsapp.template_language', 'en'),
            'body'     => $t['body'],
            'params'   => $t['params'],
        ])->values()->all();
    }

    // ── Conversations (state + metadata only — never message content) ───────────

    public function conversations(array $filters): array
    {
        $query = ConversationState::query()->with('user:id,legal_name,email')->orderByDesc('last_inbound_at');

        match ($filters['view'] ?? '') {
            'stuck' => $query->whereNotIn('state', self::TERMINAL_STATES)
                ->where('last_inbound_at', '<', now()->subMinutes(self::STUCK_THRESHOLD_MINUTES)),
            'failed' => $query->whereIn('state', ['EXPIRED', 'NO_PROVIDERS', 'PAYMENT_FAILED']),
            'completed' => $query->where('state', 'COMPLETED'),
            default => null,
        };

        $page = $query->paginate(20, ['*'], 'page', (int) ($filters['page'] ?? 1));

        return [
            'data' => collect($page->items())->map(fn (ConversationState $c) => [
                'id'              => $c->id,
                'whatsapp_masked' => $this->maskPhone($c->whatsapp_id),
                'user_name'       => $c->user?->legal_name ?? $c->user?->email ?? 'Unknown',
                'state'           => $c->state,
                'sub_state'       => $c->sub_state,
                'last_activity'   => $this->iso($c->last_inbound_at),
                'duration_mins'   => $c->last_inbound_at ? now()->diffInMinutes($c->last_inbound_at) : null,
                'booking_created' => $c->booking_id !== null,
                'stuck'           => !in_array($c->state, self::TERMINAL_STATES, true)
                    && $c->last_inbound_at && $c->last_inbound_at->lt(now()->subMinutes(self::STUCK_THRESHOLD_MINUTES)),
            ])->all(),
            'meta' => [
                'current_page' => $page->currentPage(),
                'last_page'    => $page->lastPage(),
                'per_page'     => $page->perPage(),
                'total'        => $page->total(),
            ],
        ];
    }

    public function nudge(string $conversationId, AdminUser $actor, string $reason): array
    {
        $conversation = ConversationState::with('user')->find($conversationId);
        if (!$conversation) {
            throw new ApiException(ErrorCode::NOT_FOUND, 'Conversation not found.');
        }

        $this->audit->perform(
            actor: $actor,
            action: 'whatsapp.conversation_nudge',
            targetType: 'conversation_state',
            targetId: $conversation->id,
            reason: $reason,
            metadata: ['before' => ['state' => $conversation->state]],
            mutation: fn () => $this->templates->sendTemplateMessage(
                $conversation->whatsapp_id,
                're_engagement',
                ['customer_name' => $conversation->user?->legal_name ?? 'there'],
                $conversation,
            ),
        );

        return ['nudged' => true];
    }

    public function markAbandoned(string $conversationId, AdminUser $actor, string $reason): array
    {
        $conversation = ConversationState::find($conversationId);
        if (!$conversation) {
            throw new ApiException(ErrorCode::NOT_FOUND, 'Conversation not found.');
        }
        if (in_array($conversation->state, self::TERMINAL_STATES, true)) {
            throw new ApiException(ErrorCode::CONFLICT, 'This conversation is already in a terminal state.');
        }

        $this->audit->perform(
            actor: $actor,
            action: 'whatsapp.conversation_mark_abandoned',
            targetType: 'conversation_state',
            targetId: $conversation->id,
            reason: $reason,
            metadata: ['before' => ['state' => $conversation->state], 'after' => ['state' => 'EXPIRED']],
            mutation: fn () => $conversation->forceFill(['state' => 'EXPIRED'])->save(),
        );

        return ['marked_abandoned' => true];
    }

    // ── Logs (inbound webhook debugging) ──────────────────────────────────────────

    public function logs(array $filters): array
    {
        $query = DB::table('whatsapp_webhook_logs')->orderByDesc('created_at')
            ->where('created_at', '>=', now()->subHours(48));

        if (!empty($filters['kind'])) {
            $query->where('kind', $filters['kind']);
        }
        if (!empty($filters['status'])) {
            $query->where('processing_status', $filters['status']);
        }

        $page = $query->paginate(30, ['*'], 'page', (int) ($filters['page'] ?? 1));

        return [
            'data' => collect($page->items())->map(fn ($r) => [
                'id'                => $r->id,
                'message_id'        => $r->message_id,
                'from_masked'       => $this->maskPhone($r->from_number),
                'kind'              => $r->kind,
                'type'              => $r->type,
                'processing_status' => $r->processing_status,
                'error'             => $r->error,
                'created_at'        => $this->iso($r->created_at),
            ])->all(),
            'meta' => [
                'current_page' => $page->currentPage(),
                'last_page'    => $page->lastPage(),
                'per_page'     => $page->perPage(),
                'total'        => $page->total(),
            ],
        ];
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────

    private function maskPhone(?string $phone): ?string
    {
        if (!$phone) return null;
        return '••• ••• ' . mb_substr($phone, -3);
    }

    private function iso($value): ?string
    {
        if ($value === null) return null;
        return $value instanceof \DateTimeInterface
            ? $value->format(\DateTimeInterface::ATOM)
            : Carbon::parse($value)->toIso8601String();
    }
}
