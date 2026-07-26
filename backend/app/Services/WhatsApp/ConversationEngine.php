<?php

namespace App\Services\WhatsApp;

use App\Contracts\DispatchService;
use App\Contracts\PaymentGateway;
use App\Contracts\TrustEngine;
use App\Contracts\WhatsAppGateway;
use App\Models\Booking;
use App\Models\ConversationState;
use App\Models\ProviderProfile;
use App\Models\User;
use App\Services\AvailabilityService;
use App\Services\BookingService;
use App\Services\CatalogService;
use App\Services\Dispatch\RequestClassifier;
use App\Services\Matching\MatchingService;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;

class ConversationEngine
{
    private const VALID_TRANSITIONS = [
        'MENU'         => ['BROWSING', 'COLLECTING'],
        'BROWSING'     => ['MENU', 'MATCHING', 'BROWSING'],
        'COLLECTING'   => ['MENU', 'MATCHING', 'COLLECTING', 'BROWSING'],
        'MATCHING'     => ['DISPATCHING', 'NO_PROVIDERS', 'MENU'],
        'DISPATCHING'  => ['FUNDING', 'NO_PROVIDERS', 'CANCELLED', 'MENU'],
        'FUNDING'      => ['IN_PROGRESS', 'EXPIRED', 'PAYMENT_FAILED', 'CANCELLED', 'MENU'],
        'IN_PROGRESS'  => ['COMPLETED', 'DISPUTED', 'MENU'],
        'COMPLETED'    => ['MENU'],
        'NO_PROVIDERS' => ['MENU', 'MATCHING'],
        'EXPIRED'      => ['MENU'],
        'CANCELLED'    => ['MENU'],
        'PAYMENT_FAILED' => ['MENU', 'FUNDING'],
        'DISPUTED'     => ['MENU'],
    ];

    public function __construct(
        private readonly CatalogService      $catalog,
        private readonly AvailabilityService  $availability,
        private readonly BookingService       $bookingService,
        private readonly DispatchService      $dispatch,
        private readonly PaymentGateway       $paymentGateway,
        private readonly TrustEngine          $trust,
        private readonly TemplateManager      $templates,
        private readonly RequestClassifier    $classifier,
        private readonly WhatsAppGateway      $gateway,
        private readonly MatchingService      $matcher,
    ) {}

    public function handle(array $inbound, ConversationState $conversation): void
    {
        $wa = $conversation->whatsapp_id;
        $type = $inbound['type'];

        // Immediately show blue ticks + a real "typing…" indicator so the user knows
        // we received their message and are working on a reply (covers the synchronous
        // DB / dispatch / payment latency that follows).
        $this->acknowledgeInbound($inbound);

        Log::info('ConversationEngine::handle', [
            'wa'    => $wa,
            'state' => $conversation->state,
            'sub'   => $conversation->sub_state,
            'type'  => $type,
        ]);

        match ($conversation->state) {
            'MENU'         => $this->handleMenu($inbound, $conversation),
            'BROWSING'     => $this->handleBrowsing($inbound, $conversation),
            'COLLECTING'   => $this->handleCollecting($inbound, $conversation),
            'MATCHING'     => $this->handleMatching($inbound, $conversation),
            'DISPATCHING'  => $this->handleDispatching($inbound, $conversation),
            'FUNDING'      => $this->handleFunding($inbound, $conversation),
            'IN_PROGRESS'  => $this->handleInProgress($inbound, $conversation),
            'COMPLETED', 'NO_PROVIDERS', 'EXPIRED', 'CANCELLED', 'PAYMENT_FAILED', 'DISPUTED'
                           => $this->handleTerminal($inbound, $conversation),
            default        => $this->sendMenu($conversation),
        };
    }

    // ── MENU ────────────────────────────────────────────────────────────────

    private function handleMenu(array $inbound, ConversationState $c): void
    {
        $action = $this->resolveAction($inbound);

        if ($action === 'menu_browse') {
            $this->transitionTo($c, 'BROWSING', 'categories');
            $this->showCategories($c);
            return;
        }

        if ($action === 'menu_book_now') {
            $this->transitionTo($c, 'COLLECTING', 'need');
            $this->templates->sendMessage(
                $c->whatsapp_id,
                "*Step 1 of 3 — What do you need?*\nDescribe what you're looking for and we'll find the best providers for you.",
                $c,
            );
            return;
        }

        if ($action === 'menu_my_bookings') {
            $this->showMyBookings($c);
            return;
        }

        $this->sendMenu($c);
    }

    // ── BROWSING ────────────────────────────────────────────────────────────

    private function handleBrowsing(array $inbound, ConversationState $c): void
    {
        $sub    = $c->sub_state;
        $action = $this->resolveAction($inbound);

        if ($action === 'back_menu') {
            $this->resetToMenu($c);
            return;
        }

        match ($sub) {
            'categories'     => $this->browseCategories($inbound, $c),
            'services'       => $this->browseServices($inbound, $c),
            'service_detail' => $this->browseServiceDetail($inbound, $c),
            'dates'          => $this->browseDates($inbound, $c),
            'slots'          => $this->browseSlots($inbound, $c),
            default          => $this->showCategories($c),
        };
    }

    private function browseCategories(array $inbound, ConversationState $c): void
    {
        $action = $this->resolveAction($inbound);

        if (! str_starts_with($action, 'cat_')) {
            $this->showCategories($c);
            return;
        }

        $categoryId = substr($action, 4);
        $c->setContextValue('selected_category_id', $categoryId);
        $c->setContextValue('browse_page', 1);
        $c->sub_state = 'services';
        $c->save();

        $this->showServicesForCategory($c, (int) $categoryId, 1);
    }

    private function browseServices(array $inbound, ConversationState $c): void
    {
        $action = $this->resolveAction($inbound);

        if ($action === 'see_more') {
            $page = ((int) $c->getContextValue('browse_page', 1)) + 1;
            $c->setContextValue('browse_page', $page);
            $c->save();
            $this->showServicesForCategory($c, (int) $c->getContextValue('selected_category_id'), $page);
            return;
        }

        if ($action === 'back_browse') {
            $c->sub_state = 'categories';
            $c->save();
            $this->showCategories($c);
            return;
        }

        if (str_starts_with($action, 'svc_')) {
            $serviceId = substr($action, 4);
            $c->setContextValue('selected_service_id', $serviceId);
            $c->sub_state = 'service_detail';
            $c->save();
            $this->showServiceDetail($c, $serviceId);
            return;
        }

        $this->showServicesForCategory($c, (int) $c->getContextValue('selected_category_id'), 1);
    }

    private function browseServiceDetail(array $inbound, ConversationState $c): void
    {
        $action = $this->resolveAction($inbound);

        if ($action === 'book_this') {
            $c->sub_state = 'dates';
            $c->save();
            $this->showDatesForService($c);
            return;
        }

        if ($action === 'back_browse') {
            $c->sub_state = 'services';
            $c->save();
            $this->showServicesForCategory($c, (int) $c->getContextValue('selected_category_id'), 1);
            return;
        }

        $this->showServiceDetail($c, $c->getContextValue('selected_service_id'));
    }

    private function browseDates(array $inbound, ConversationState $c): void
    {
        $action = $this->resolveAction($inbound);

        if (str_starts_with($action, 'date_')) {
            $date = substr($action, 5);
            $c->setContextValue('selected_date', $date);
            $c->sub_state = 'slots';
            $c->save();
            $this->showSlotsForDate($c, $date);
            return;
        }

        $this->showDatesForService($c);
    }

    private function browseSlots(array $inbound, ConversationState $c): void
    {
        $action = $this->resolveAction($inbound);

        if (str_starts_with($action, 'slot_')) {
            $parts = explode('_', substr($action, 5), 2);
            if (count($parts) === 2) {
                $c->setContextValue('selected_start_time', $parts[0]);
                $c->setContextValue('selected_end_time', $parts[1]);
                $c->save();

                if ($c->getContextValue('location_lat')) {
                    $this->proceedToMatching($c);
                } else {
                    $this->transitionTo($c, 'COLLECTING', 'location');
                    $this->templates->sendInteractive(
                        $c->whatsapp_id,
                        MessageBuilder::locationRequest('Please share your location so we can find providers near you.'),
                        $c,
                    );
                }
                return;
            }
        }

        $this->showSlotsForDate($c, $c->getContextValue('selected_date'));
    }

    // ── COLLECTING (book-now) ───────────────────────────────────────────────

    private function handleCollecting(array $inbound, ConversationState $c): void
    {
        $sub    = $c->sub_state;
        $action = $this->resolveAction($inbound);

        if ($action === 'back_menu') {
            $this->resetToMenu($c);
            return;
        }

        match ($sub) {
            'need'     => $this->collectNeed($inbound, $c),
            'location' => $this->collectLocation($inbound, $c),
            'timing'   => $this->collectTiming($inbound, $c),
            default    => $this->collectNeed($inbound, $c),
        };
    }

    private function collectNeed(array $inbound, ConversationState $c): void
    {
        if ($inbound['type'] !== 'text' || trim($inbound['text'] ?? '') === '') {
            $this->templates->sendMessage(
                $c->whatsapp_id,
                "Please describe what service you need. For example: \"I need a plumber to fix a leaking tap.\"",
                $c,
            );
            return;
        }

        $text = trim($inbound['text']);
        $c->setContextValue('need_description', $text);
        $c->save();

        // Natural-language matcher — the SAME backend the app home calls, with
        // identical thresholds (consistency across surfaces). It finds WHAT (real
        // catalog); the existing browse flow then handles WHO / dates / booking.
        $match = $this->matcher->match($text, $c->user_id, 'whatsapp');

        // ── MATCHED — jump to the specific service, or the category's services ──
        if ($match['status'] === 'matched' && $match['resolved_category_id'] !== null) {
            $this->transitionTo($c, 'BROWSING');
            $c->setContextValue('selected_category_id', (string) $match['resolved_category_id']);

            if (! empty($match['service_ids'])) {
                $serviceId = $match['service_ids'][0];
                $c->setContextValue('selected_service_id', $serviceId);
                $c->sub_state = 'service_detail';
                $c->save();
                $this->templates->sendMessage($c->whatsapp_id, "Got it — here's what matches \"{$text}\":", $c);
                $this->showServiceDetail($c, $serviceId);
                return;
            }

            $c->sub_state = 'services';
            $c->save();
            $this->templates->sendMessage($c->whatsapp_id, "Here's what can help with \"{$text}\":", $c);
            $this->showServicesForCategory($c, (int) $match['resolved_category_id'], 1);
            return;
        }

        // ── CLARIFY — ask with real category options (buttons), never guess ────
        if ($match['status'] === 'clarify') {
            $buttons = [];
            foreach ($match['candidates'] as $cand) {
                $catId = $cand['category_id'] ?? null;
                if ($catId === null || isset($buttons['cat_' . $catId])) {
                    continue;
                }
                $title = $cand['type'] === 'category' ? $cand['label'] : ($cand['subtitle'] ?: $cand['label']);
                $buttons['cat_' . $catId] = ['id' => 'cat_' . $catId, 'title' => mb_substr($title, 0, 20)];
            }
            $btnList = array_slice(array_values($buttons), 0, 3);

            if ($btnList !== []) {
                $this->transitionTo($c, 'BROWSING', 'categories');
                $this->templates->sendInteractive(
                    $c->whatsapp_id,
                    MessageBuilder::replyButtons(
                        "I want to get this right — which of these did you mean?",
                        $btnList,
                    ),
                    $c,
                );
                return;
            }
            // No usable buttons → fall through to the honest empty state.
        }

        // ── EMPTY — honest "we don't have that yet" + closest + browse-all ─────
        $closest = $match['closest_categories'] ?? [];
        $body    = "We don't have \"{$text}\" yet.";
        if ($closest !== []) {
            $body .= "\n\nThe closest we have:";
            foreach ($closest as $cc) {
                $body .= "\n• {$cc['name']}";
            }
        }
        $this->templates->sendMessage($c->whatsapp_id, $body, $c);
        $this->transitionTo($c, 'BROWSING', 'categories');
        $this->templates->sendMessage($c->whatsapp_id, "Here's everything we do — tap a category to browse:", $c);
        $this->showCategories($c);
    }

    private function collectLocation(array $inbound, ConversationState $c): void
    {
        if ($inbound['type'] === 'location') {
            $c->setContextValue('location_lat', $inbound['latitude']);
            $c->setContextValue('location_lng', $inbound['longitude']);
            $c->setContextValue('location_label', $inbound['name'] ?? $inbound['address'] ?? 'Pinned location');
            $c->sub_state = 'timing';
            $c->save();

            if ($c->getContextValue('selected_service_id') && $c->getContextValue('selected_date')) {
                $this->proceedToMatching($c);
                return;
            }

            $this->templates->sendMessage(
                $c->whatsapp_id,
                "*Step 3 of 3 — When?*\nLocation received! When do you need this done?\n\nReply with a date (e.g., \"tomorrow\", \"Monday\", \"2026-07-01\").",
                $c,
            );
            return;
        }

        $this->templates->sendInteractive(
            $c->whatsapp_id,
            MessageBuilder::locationRequest("Please share your location using the attachment button below."),
            $c,
        );
    }

    private function collectTiming(array $inbound, ConversationState $c): void
    {
        if ($inbound['type'] === 'text' && ! empty($inbound['text'])) {
            $parsed = $this->parseDate($inbound['text']);

            if ($parsed) {
                $c->setContextValue('selected_date', $parsed->toDateString());
                $c->setContextValue('selected_start_time', '09:00');
                $c->setContextValue('selected_end_time', '17:00');
                $c->save();

                $this->proceedToMatching($c);
                return;
            }

            $this->templates->sendMessage(
                $c->whatsapp_id,
                "I couldn't understand that date. Please try again (e.g., \"tomorrow\", \"Monday\", \"2026-07-01\").",
                $c,
            );
            return;
        }

        $this->templates->sendMessage(
            $c->whatsapp_id,
            "When do you need this done? Please reply with a date.",
            $c,
        );
    }

    // ── MATCHING ────────────────────────────────────────────────────────────

    private function handleMatching(array $inbound, ConversationState $c): void
    {
        $action = $this->resolveAction($inbound);
        if ($action === 'back_menu' || $action === 'cancel') {
            $this->resetToMenu($c);
            return;
        }

        $this->templates->sendInteractive(
            $c->whatsapp_id,
            MessageBuilder::replyButtons(
                "We're still looking for providers. This usually takes a few seconds.",
                [['id' => 'back_menu', 'title' => 'Cancel']],
            ),
            $c,
        );
    }

    private function proceedToMatching(ConversationState $c): void
    {
        $this->transitionTo($c, 'MATCHING');

        $serviceId = $c->getContextValue('selected_service_id');
        $lat       = (float) $c->getContextValue('location_lat');
        $lng       = (float) $c->getContextValue('location_lng');
        $date      = $c->getContextValue('selected_date');
        $startTime = $c->getContextValue('selected_start_time', '09:00');
        $endTime   = $c->getContextValue('selected_end_time', '17:00');

        $dateObj = Carbon::parse($date, 'Africa/Lusaka');
        $scheduledStart = $dateObj->copy()->setTimeFromTimeString($startTime)->toIso8601String();
        $scheduledEnd   = $dateObj->copy()->setTimeFromTimeString($endTime)->toIso8601String();

        if (! $serviceId) {
            $this->templates->sendMessage(
                $c->whatsapp_id,
                "We need to know which service you want. Let's start over.",
                $c,
            );
            $this->resetToMenu($c);
            return;
        }

        // Show the user we're working on it
        $this->templates->sendMessage(
            $c->whatsapp_id,
            "📍 Location received! Searching for available providers...",
            $c,
        );

        $classification = $this->classifier->classify($serviceId, $scheduledStart);
        $c->setContextValue('classification', $classification);
        $c->save();

        Log::info('ConversationEngine: classified request', $classification);

        $shortlist = $this->dispatch->shortlist($serviceId, $lat, $lng, $scheduledStart, $scheduledEnd);

        if (empty($shortlist)) {
            $this->transitionTo($c, 'NO_PROVIDERS');
            $this->templates->sendInteractive(
                $c->whatsapp_id,
                MessageBuilder::replyButtons(
                    "Sorry, we couldn't find any available providers for your request right now.",
                    [
                        ['id' => 'retry_match', 'title' => 'Try Again'],
                        ['id' => 'back_menu',   'title' => 'Main Menu'],
                    ],
                ),
                $c,
            );
            return;
        }

        $c->setContextValue('shortlist', $shortlist);
        $c->setContextValue('shortlist_index', 0);
        $c->setContextValue('scheduled_start', $scheduledStart);
        $c->setContextValue('scheduled_end', $scheduledEnd);
        $c->save();

        if ($classification['service_mode'] === 'instant') {
            $this->autoDispatch($c, $shortlist[0]);
        } else {
            $this->transitionTo($c, 'DISPATCHING');
            $this->templates->sendInteractive(
                $c->whatsapp_id,
                MessageBuilder::shortlistButtons($shortlist),
                $c,
            );
        }
    }

    // ── DISPATCHING ─────────────────────────────────────────────────────────

    private function handleDispatching(array $inbound, ConversationState $c): void
    {
        $action = $this->resolveAction($inbound);

        // Structured brief in progress (quote-first models) — every text reply
        // is the answer to the current question.
        if ($c->sub_state === 'brief') {
            if ($action === 'back_menu') {
                $this->resetToMenu($c);
                return;
            }
            $this->handleBriefAnswer($inbound, $c);
            return;
        }

        // Scoped-quote response buttons.
        if (str_starts_with($action, 'quote_accept_')) {
            $this->handleCustomerQuoteAccept($c);
            return;
        }
        if (str_starts_with($action, 'quote_decline_')) {
            $this->handleCustomerQuoteDecline($c);
            return;
        }

        if ($c->sub_state === 'await_quote') {
            $this->templates->sendMessage(
                $c->whatsapp_id,
                "We're still waiting for the provider's quote — we'll message you the moment it lands.",
                $c,
            );
            return;
        }

        if ($action === 'back_menu') {
            $this->resetToMenu($c);
            return;
        }

        if (str_starts_with($action, 'provider_')) {
            $providerId = substr($action, 9);
            $shortlist = $c->getContextValue('shortlist', []);

            $selected = null;
            foreach ($shortlist as $p) {
                if ($p['provider_id'] === $providerId) {
                    $selected = $p;
                    break;
                }
            }

            if (! $selected) {
                $this->templates->sendMessage($c->whatsapp_id, "That provider is no longer available. Please choose another.", $c);
                return;
            }

            $this->autoDispatch($c, $selected);
            return;
        }

        $this->templates->sendMessage($c->whatsapp_id, "Please choose a provider from the list above.", $c);
    }

    private function autoDispatch(ConversationState $c, array $provider): void
    {
        $c->setContextValue('selected_provider_id', $provider['provider_id']);
        $c->setContextValue('selected_price', $provider['price'] ?? null);
        $c->save();

        $service = $this->catalog->serviceDetail($c->getContextValue('selected_service_id'));

        // Quote-first models (PROVIDER_SCOPE / QUOTE_DEPOSIT): no price exists yet.
        // Collect the structured brief (one question per turn — never free-text
        // hours), then the provider quotes and the customer approves before any
        // money moves.
        if ($service && \in_array($service->pricing_model, ['PROVIDER_SCOPE', 'QUOTE_DEPOSIT'], true)) {
            $this->startBriefCollection($c, $provider, $service);
            return;
        }

        $tierLabel = $provider['tier_label'] ?? 'Verified';
        $providerName = $provider['name'] ?? 'a provider';

        // Model-aware price line: HOURLY_CAPPED shows rate + cap, never a bare hourly.
        $priceLine = $this->priceLineFor($service, $provider['price'] ?? 0);

        $matchCaption = "✅ Found a match!\n\n"
            . "*{$providerName}* — {$tierLabel}\n"
            . "{$priceLine}\n\n"
            . "Notifying the provider and preparing your booking...";

        // Lead with the provider's face when available — builds trust and reads faster
        // than text. Falls back to the same copy as a plain message.
        $providerUser = User::find($provider['provider_id']);
        $this->sendImageOrText($c->whatsapp_id, $this->providerAvatarUrl($providerUser), $matchCaption, $c);

        // The booking must exist BEFORE the provider offer goes out — the offer's
        // Accept/Decline button ids and the provider conversation both carry the
        // booking id (a null id makes the whole response loop dead-end).
        $booking = $this->createBookingFromContext($c);
        if (! $booking) {
            return; // createBookingFromContext already messaged + reset
        }

        try {
            $this->sendProviderOffer($c, $provider);
        } catch (\Throwable $e) {
            Log::warning('ConversationEngine: provider offer send failed (non-fatal)', [
                'provider_id' => $provider['provider_id'],
                'error'       => $e->getMessage(),
            ]);
        }

        $this->transitionTo($c, 'FUNDING');
        $this->initiateFunding($c);
    }

    // ── Outcome-based pricing helpers ────────────────────────────────────────

    /**
     * Model-aware price line — HOURLY_CAPPED always shows rate + minimum + cap
     * (the customer's hold is the cap, actual time is charged); quote-first
     * models show no number until the provider's scoped quote.
     */
    private function priceLineFor(?object $service, float $fallbackPrice): string
    {
        if (! $service) {
            return 'Price: ZMW ' . number_format($fallbackPrice, 2);
        }

        return match ($service->pricing_model ?? null) {
            'HOURLY_CAPPED' => sprintf(
                'Rate: ZMW %s/hr · %s-hr minimum · max ZMW %s',
                number_format((float) $service->hourly_rate, 0),
                rtrim(rtrim(number_format((float) $service->minimum_hours, 1), '0'), '.'),
                number_format((float) ($service->cap_amount ?? $fallbackPrice), 0),
            ),
            'PROVIDER_SCOPE' => 'Price: quoted after your brief — nothing is charged until you approve',
            'QUOTE_DEPOSIT'  => sprintf(
                'Price: quoted after your brief · %d%% deposit to confirm',
                (int) ($service->deposit_percent ?? 30),
            ),
            default => 'Price: ZMW ' . number_format((float) ($service->base_price ?? $fallbackPrice), 2),
        };
    }

    /** Default brief questions when the provider hasn't configured scope prompts. */
    private function briefQuestions(?object $service): array
    {
        $prompts = $service->scope_prompts ?? null;
        if (is_string($prompts)) {
            $prompts = json_decode($prompts, true);
        }

        return (is_array($prompts) && $prompts !== [])
            ? array_values($prompts)
            : [
                'What exactly needs doing?',
                'How big is the job? (rooms, items, or size)',
                'Any special conditions the provider should know about?',
            ];
    }

    /**
     * PROVIDER_SCOPE / QUOTE_DEPOSIT: structured brief — one question per turn.
     * Runs inside DISPATCHING (sub_state 'brief'); the provider quotes against
     * the answers, and escrow only holds after the customer approves.
     */
    private function startBriefCollection(ConversationState $c, array $provider, object $service): void
    {
        $questions = $this->briefQuestions($service);

        if ($c->state !== 'DISPATCHING') {
            $this->transitionTo($c, 'DISPATCHING');
        }
        $c->sub_state = 'brief';
        $c->setContextValue('brief_questions', $questions);
        $c->setContextValue('brief_answers', []);
        $c->setContextValue('brief_index', 0);
        $c->save();

        $providerName = $provider['name'] ?? 'The provider';
        $intro = $service->pricing_model === 'QUOTE_DEPOSIT'
            ? "*{$providerName}* will send you a full quote after a few quick questions. You'll pay a "
              . (int) ($service->deposit_percent ?? 30) . "% deposit to confirm — the balance is due on completion."
            : "*{$providerName}* will send you a fixed quote after a few quick questions. Nothing is charged until you approve it.";

        $this->templates->sendMessage($c->whatsapp_id, $intro, $c);
        $this->askNextBriefQuestion($c);
    }

    private function askNextBriefQuestion(ConversationState $c): void
    {
        $questions = $c->getContextValue('brief_questions', []);
        $index     = (int) $c->getContextValue('brief_index', 0);
        $total     = count($questions);

        $this->templates->sendMessage(
            $c->whatsapp_id,
            '*Question ' . ($index + 1) . " of {$total}*\n" . $questions[$index],
            $c,
        );
    }

    private function handleBriefAnswer(array $inbound, ConversationState $c): void
    {
        if ($inbound['type'] !== 'text' || trim($inbound['text'] ?? '') === '') {
            $this->askNextBriefQuestion($c);
            return;
        }

        $questions = $c->getContextValue('brief_questions', []);
        $index     = (int) $c->getContextValue('brief_index', 0);
        $answers   = $c->getContextValue('brief_answers', []);

        $answers[] = [
            'question' => $questions[$index] ?? 'Details',
            'answer'   => trim($inbound['text']),
        ];
        $c->setContextValue('brief_answers', $answers);
        $c->setContextValue('brief_index', $index + 1);
        $c->save();

        if ($index + 1 < count($questions)) {
            $this->askNextBriefQuestion($c);
            return;
        }

        $this->finishBrief($c);
    }

    /**
     * Brief complete → create the SCOPE_PENDING booking and hand the brief to
     * the provider to quote (via the bot or the app — same endpoint).
     */
    private function finishBrief(ConversationState $c): void
    {
        $c->sub_state = 'await_quote';
        $c->save();

        $booking = $this->createBookingFromContext($c);
        if (! $booking) {
            return;
        }

        $this->templates->sendMessage(
            $c->whatsapp_id,
            "📋 Brief sent! We'll message you as soon as the provider sends their quote. "
            . "You'll see the price, how long it'll take and what's included — nothing is charged until you approve.",
            $c,
        );

        $this->sendProviderBriefRequest($c, $booking);
    }

    /** Send the customer's brief to the provider with quoting instructions. */
    private function sendProviderBriefRequest(ConversationState $c, Booking $booking): void
    {
        $providerUser = User::find($c->getContextValue('selected_provider_id'));
        if (! $providerUser || ! $providerUser->phone) {
            Log::warning('ConversationEngine: cannot send brief — provider has no phone', [
                'booking_id' => $booking->id,
            ]);
            return;
        }

        $providerWa    = ltrim($providerUser->phone, '+');
        $providerConvo = ConversationState::firstOrCreate(
            ['whatsapp_id' => $providerWa],
            ['state' => 'MENU', 'context' => []],
        );

        $briefLines = collect($c->getContextValue('brief_answers', []))
            ->map(fn ($qa) => "• {$qa['question']}\n  _{$qa['answer']}_")
            ->implode("\n");

        $scheduledLabel = $booking->scheduled_start
            ? $booking->scheduled_start->copy()->setTimezone('Africa/Lusaka')->format('D, M j \\a\\t H:i')
            : 'To be confirmed';

        $text = "🔔 *New Job Brief — quote to win it*\n\n"
            . 'Service: ' . ($booking->service->title ?? 'Service') . "\n"
            . "Date: {$scheduledLabel}\n"
            . 'Location: ' . ($booking->delivery_location_label ?? 'Shared location') . "\n\n"
            . "*Customer's brief:*\n{$briefLines}\n\n"
            . "Reply with your quote like:\n*quote 450*\n(total price in ZMW — you can add a note after the amount)";

        $this->templates->sendMessage($providerWa, $text, $providerConvo);
        $this->sendJobLocationPin($providerWa, $c);

        $providerConvo->update([
            'state'      => 'DISPATCHING',
            'sub_state'  => 'await_quote_amount',
            'booking_id' => $booking->id,
            'timeout_at' => now()->addMinutes((int) config('dispatch.accept_window.default_minutes', 15) * 4),
            'context'    => array_merge($providerConvo->context ?? [], [
                'role'             => 'provider',
                'customer_wa'      => $c->whatsapp_id,
                'offer_booking_id' => $booking->id,
            ]),
        ]);
    }

    /**
     * Provider replied "quote 450" (or a bare number) to a brief — record the
     * scoped quote and put it in front of the customer with Accept/Decline.
     */
    private function handleProviderQuoteReply(array $inbound, ConversationState $c): void
    {
        $text = trim($inbound['text'] ?? '');
        if ($text === '' || ! preg_match('/(?:^|\s)(?:quote\s+)?(\d+(?:[.,]\d{1,2})?)(?:\s+(.+))?$/i', $text, $m)) {
            $this->templates->sendMessage(
                $c->whatsapp_id,
                "To send your quote, reply like:\n*quote 450*\n(the total price in ZMW)",
                $c,
            );
            return;
        }

        $amount   = (float) str_replace(',', '.', $m[1]);
        $note     = isset($m[2]) ? trim($m[2]) : null;
        $provider = $c->user_id ? User::find($c->user_id) : null;
        $booking  = $c->booking_id ? Booking::with('service')->find($c->booking_id) : null;

        if (! $provider || ! $booking) {
            $this->templates->sendMessage($c->whatsapp_id, 'We could not find that job anymore — it may have expired.', $c);
            $this->resetToMenu($c);
            return;
        }

        try {
            $booking = $this->bookingService->quote($booking->id, $provider, $amount, $note);
        } catch (\Throwable $e) {
            Log::error('ConversationEngine: provider quote failed', ['booking_id' => $booking->id, 'error' => $e->getMessage()]);
            $this->templates->sendMessage($c->whatsapp_id, 'We could not record that quote: please check the amount and try again.', $c);
            return;
        }

        $c->sub_state = 'await_customer_quote';
        $c->save();

        $this->templates->sendMessage(
            $c->whatsapp_id,
            'Quote of ZMW ' . number_format($amount, 2) . " sent — we'll notify you when the customer responds.",
            $c,
        );

        // Put the quote in front of the customer.
        $customerWa    = $c->getContextValue('customer_wa');
        $customerConvo = $customerWa ? ConversationState::where('whatsapp_id', $customerWa)->first() : null;
        if (! $customerConvo) {
            return;
        }

        $isDeposit = $booking->service?->pricing_model === 'QUOTE_DEPOSIT';
        $lines = ["💬 *Your quote is in!*", ''];
        $lines[] = 'Service: ' . ($booking->service->title ?? 'Service');
        $lines[] = 'Quoted price: ZMW ' . number_format($amount, 2);
        if ($note) {
            $lines[] = "Provider's note: {$note}";
        }
        if ($isDeposit) {
            $lines[] = '';
            $lines[] = 'Pay ZMW ' . number_format((float) $booking->deposit_amount, 2) . ' deposit now to confirm.';
            $lines[] = 'Balance of ZMW ' . number_format((float) $booking->balance_amount, 2) . ' is due on completion.';
        } else {
            $lines[] = '';
            $lines[] = 'The full amount is held securely and only released when you confirm the job is done.';
        }

        $acceptLabel = $isDeposit
            ? 'Pay deposit'
            : 'Accept quote';

        $this->templates->sendInteractive(
            $customerWa,
            MessageBuilder::replyButtons(
                implode("\n", $lines),
                [
                    ['id' => 'quote_accept_' . $booking->id,  'title' => $acceptLabel],
                    ['id' => 'quote_decline_' . $booking->id, 'title' => 'Decline'],
                ],
            ),
            $customerConvo,
        );
    }

    /** Customer approved the scoped quote → escrow hold (deposit or full). */
    private function handleCustomerQuoteAccept(ConversationState $c): void
    {
        $this->transitionTo($c, 'FUNDING');
        $this->initiateFunding($c);
    }

    /** Customer declined the scoped quote → cancelled, nothing charged. */
    private function handleCustomerQuoteDecline(ConversationState $c): void
    {
        $booking = $c->booking_id ? Booking::find($c->booking_id) : null;
        $user    = $this->resolveUser($c);

        if ($booking && $user) {
            try {
                $this->bookingService->declineQuote($booking->id, $user);
            } catch (\Throwable $e) {
                Log::warning('ConversationEngine: quote decline failed', ['booking_id' => $booking->id, 'error' => $e->getMessage()]);
            }
        }

        $this->transitionTo($c, 'CANCELLED');
        $this->templates->sendMessage($c->whatsapp_id, 'No problem — the booking was cancelled and nothing was charged.', $c);

        // Tell the provider their quote was declined.
        $providerUser = User::find($c->getContextValue('selected_provider_id'));
        if ($providerUser?->phone) {
            $providerWa    = ltrim($providerUser->phone, '+');
            $providerConvo = ConversationState::where('whatsapp_id', $providerWa)->first();
            $this->templates->sendMessage($providerWa, 'The customer declined your quote this time. You can keep taking new jobs as usual.', $providerConvo);
            if ($providerConvo) {
                $this->resetToMenu($providerConvo);
            }
        }

        $this->sendMenu($c);
    }

    /**
     * Dispatch cascade — a shortlisted provider declined or let the offer time
     * out. Reassign the booking to the next candidate, offer them the job, and
     * tell the customer transparently. Falls back to NO_PROVIDERS (with refund
     * when funds are already held) when the shortlist is exhausted.
     */
    public function cascadeToNextProvider(string $bookingId): void
    {
        $customerConvo = ConversationState::where('booking_id', $bookingId)
            ->where(function ($q) {
                $q->whereNull('context')
                  ->orWhereRaw("COALESCE(context->>'role', '') <> 'provider'");
            })
            ->first();

        $next = $this->dispatch->cascade($bookingId);

        if (! $next) {
            Log::info('ConversationEngine: provider cascade exhausted', ['booking_id' => $bookingId]);
            $this->handleCascadeExhausted($bookingId, $customerConvo);
            return;
        }

        if (! $customerConvo) {
            Log::warning('ConversationEngine: cascade found next provider but no customer conversation', [
                'booking_id' => $bookingId,
            ]);
            return;
        }

        // Pull the full shortlist entry (name/tier/price) for the offer + copy.
        $shortlist = $customerConvo->getContextValue('shortlist', []);
        $entry = collect($shortlist)->firstWhere('provider_id', $next['provider_id'])
            ?? ['provider_id' => $next['provider_id'], 'price' => $next['price'] ?? 0];

        try {
            $this->bookingService->reassignProvider($bookingId, $entry['provider_id']);
        } catch (\Throwable $e) {
            Log::error('ConversationEngine: cascade reassign failed', [
                'booking_id' => $bookingId, 'error' => $e->getMessage(),
            ]);
            return;
        }

        $customerConvo->setContextValue('selected_provider_id', $entry['provider_id']);
        $customerConvo->save();

        $booking = Booking::with('service')->find($bookingId);
        $quoteFirst = $booking?->service
            && \in_array($booking->service->pricing_model, ['PROVIDER_SCOPE', 'QUOTE_DEPOSIT'], true);

        $name      = $entry['name'] ?? 'another provider';
        $tierLabel = $entry['tier_label'] ?? 'Verified';
        $this->templates->sendMessage(
            $customerConvo->whatsapp_id,
            $quoteFirst
                ? "That provider couldn't take the job, so we've sent your brief to *{$name}* — {$tierLabel}. "
                  . "They'll send you their own quote to approve. No action needed from you yet."
                : "That provider couldn't take the job, so we've matched you with *{$name}* — {$tierLabel}. "
                  . "Same service, date and price. No action needed from you.",
            $customerConvo,
        );

        try {
            // Quote-first bookings carry no price — the next provider gets the
            // customer's brief and quotes fresh, not a priced offer.
            if ($quoteFirst && $booking) {
                $customerConvo->sub_state = 'await_quote';
                $customerConvo->save();
                $this->sendProviderBriefRequest($customerConvo, $booking);
            } else {
                $this->sendProviderOffer($customerConvo, $entry);
            }
        } catch (\Throwable $e) {
            Log::warning('ConversationEngine: cascade offer send failed', [
                'provider_id' => $entry['provider_id'], 'error' => $e->getMessage(),
            ]);
        }
    }

    private function handleCascadeExhausted(string $bookingId, ?ConversationState $customerConvo): void
    {
        $booking   = Booking::find($bookingId);
        $wasFunded = $booking && $booking->status === 'FUNDS_HELD';

        // If the customer already paid, release the hold — never strand money.
        if ($wasFunded) {
            $buyer = User::find($booking->buyer_id);
            if ($buyer) {
                try {
                    $this->bookingService->cancel($bookingId, $buyer);
                } catch (\Throwable $e) {
                    $wasFunded = false; // refund didn't go through — don't promise it
                    Log::error('ConversationEngine: cascade-exhausted refund failed', [
                        'booking_id' => $bookingId, 'error' => $e->getMessage(),
                    ]);
                }
            }
        } elseif ($booking && \in_array($booking->status, ['REQUESTED', 'QUOTED', 'PENDING_PAYMENT'], true)) {
            $booking->update(['status' => 'CANCELLED']);
        }

        if ($customerConvo) {
            $refundNote = $wasFunded
                ? " Your payment is being refunded to your Mobile Money."
                : '';

            $customerConvo->state = 'NO_PROVIDERS';
            $customerConvo->sub_state = null;
            $customerConvo->timeout_at = null;
            $customerConvo->save();

            $this->templates->sendInteractive(
                $customerConvo->whatsapp_id,
                MessageBuilder::replyButtons(
                    "Sorry — none of the available providers could take this job.{$refundNote}\n\nWould you like to try again?",
                    [
                        ['id' => 'retry_match', 'title' => 'Try Again'],
                        ['id' => 'back_menu',   'title' => 'Main Menu'],
                    ],
                ),
                $customerConvo,
            );
        }
    }

    private function sendProviderOffer(ConversationState $c, array $provider): void
    {
        $providerUser = User::find($provider['provider_id']);
        if (! $providerUser || ! $providerUser->phone) {
            Log::warning('ConversationEngine: cannot send provider offer — no phone', ['provider_id' => $provider['provider_id']]);
            return;
        }

        $providerWa = ltrim($providerUser->phone, '+');

        $providerConvo = ConversationState::firstOrCreate(
            ['whatsapp_id' => $providerWa],
            ['state' => 'MENU', 'context' => []],
        );

        $serviceId = $c->getContextValue('selected_service_id');
        $service   = $this->catalog->serviceDetail($serviceId);

        $scheduledStart = $c->getContextValue('scheduled_start');
        $scheduledLabel = $scheduledStart
            ? Carbon::parse($scheduledStart)->setTimezone('Africa/Lusaka')->format('D, M j \\a\\t H:i')
            : 'To be confirmed';

        $offerData = [
            'booking_id'      => $c->booking_id,
            'service_title'   => $service->title ?? $service->name ?? 'Service',
            'scheduled_start' => $scheduledLabel,
            'delivery_label'  => $c->getContextValue('location_label', 'Location shared'),
            'amount'          => $provider['price'] ?? 0,
        ];

        $offerText = "🔔 *New Job Request*\n\n"
            . "Service: {$offerData['service_title']}\n"
            . "Date: {$offerData['scheduled_start']}\n"
            . "Location: {$offerData['delivery_label']}\n"
            . "Amount: ZMW " . number_format($offerData['amount'], 2) . "\n\n"
            . "Reply to this chat to accept or decline.";

        if ($providerConvo->isWithin24hWindow()) {
            $this->templates->sendInteractive(
                $providerWa,
                MessageBuilder::providerOffer($offerData, $service ? $this->servicePhotoUrl($service) : null),
                $providerConvo,
            );
            // Drop a map pin of the job location so the provider can judge distance / navigate.
            $this->sendJobLocationPin($providerWa, $c);
        } else {
            $this->templates->sendProactiveOrTemplate(
                $providerWa,
                'provider_job_offer',
                [
                    'service_title' => $offerData['service_title'],
                    'date'          => $offerData['scheduled_start'],
                    'location'      => $offerData['delivery_label'],
                    'amount'        => number_format($offerData['amount'], 2),
                ],
                $offerText,
                $providerConvo,
            );
        }

        $classification = $c->getContextValue('classification', []);
        $isUrgent = $classification['is_urgent'] ?? false;
        $timeoutMinutes = $isUrgent
            ? config('dispatch.accept_window.urgent_minutes', 5)
            : config('dispatch.accept_window.default_minutes', 15);

        $providerConvo->update([
            'state'      => 'DISPATCHING',
            'booking_id' => $c->booking_id,
            'timeout_at' => now()->addMinutes($timeoutMinutes),
            'context'    => array_merge($providerConvo->context ?? [], [
                'role'              => 'provider',
                'customer_wa'       => $c->whatsapp_id,
                'offer_booking_id'  => $c->booking_id,
            ]),
        ]);
    }

    /**
     * Best-effort WhatsApp nudge to the provider once escrow funds are held.
     * Never throws — payment confirmation to the customer must not depend on it.
     */
    private function notifyProviderFundsHeld(Booking $booking): void
    {
        try {
            $providerUser = $booking->provider;
            if (! $providerUser?->phone) {
                return;
            }

            $providerWa    = ltrim($providerUser->phone, '+');
            $providerConvo = ConversationState::where('whatsapp_id', $providerWa)->first();

            $text = "💰 Payment confirmed — the customer's money is held securely.\n\n"
                . "Job: " . ($booking->service->title ?? 'Service') . "\n"
                . "Date: " . ($booking->scheduled_start?->setTimezone('Africa/Lusaka')->format('D, M j \\a\\t H:i') ?? 'TBC') . "\n\n"
                . "You'll be paid to your Mobile Money after the customer confirms completion.";

            $this->templates->sendMessage($providerWa, $text, $providerConvo);
        } catch (\Throwable $e) {
            Log::warning('ConversationEngine: provider funds-held notice failed', [
                'booking_id' => $booking->id, 'error' => $e->getMessage(),
            ]);
        }
    }

    // ── FUNDING ─────────────────────────────────────────────────────────────

    private function handleFunding(array $inbound, ConversationState $c): void
    {
        $action = $this->resolveAction($inbound);

        if ($action === 'cancel_booking') {
            $this->cancelUnpaidBooking($c);
            $this->transitionTo($c, 'CANCELLED');
            $this->templates->sendMessage($c->whatsapp_id, "Booking cancelled. No payment was taken.", $c);
            $this->sendMenu($c);
            return;
        }

        if ($action === 'retry_payment') {
            $this->transitionTo($c, 'FUNDING');
            $this->initiateFunding($c);
            return;
        }

        if ($action === 'use_other_number') {
            $this->askForAlternateNumber($c);
            return;
        }

        // Alternate MoMo wallet capture (after "Use another number").
        if ($c->sub_state === 'await_msisdn' && $inbound['type'] === 'text') {
            $msisdn = $this->parseZambianMsisdn($inbound['text'] ?? '');
            if (! $msisdn) {
                $this->templates->sendMessage(
                    $c->whatsapp_id,
                    "That doesn't look like a Zambian mobile number. Please send it like 0977123456 or 260977123456.",
                    $c,
                );
                return;
            }

            $c->setContextValue('payment_msisdn', $msisdn);
            $c->sub_state = null;
            $c->save();

            $this->templates->sendMessage(
                $c->whatsapp_id,
                "Thanks — we'll send the payment prompt to " . $msisdn . " instead.",
                $c,
            );
            $this->initiateFunding($c);
            return;
        }

        $this->templates->sendInteractive(
            $c->whatsapp_id,
            MessageBuilder::replyButtons(
                "We're waiting for your Mobile Money payment to be confirmed.\n\nCheck your phone for the payment prompt and enter your PIN.",
                [['id' => 'cancel_booking', 'title' => 'Cancel Booking']],
            ),
            $c,
        );
    }

    /** Put the conversation into alternate-wallet capture mode. */
    private function askForAlternateNumber(ConversationState $c): void
    {
        $c->state     = 'FUNDING';
        $c->sub_state = 'await_msisdn';
        $c->save();

        $this->templates->sendMessage(
            $c->whatsapp_id,
            "Which Mobile Money number should we charge instead? Reply with the number (e.g. 0977123456). Airtel, MTN and Zamtel wallets are supported.",
            $c,
        );
    }

    /** Best-effort cancel of a booking that has not captured funds yet. */
    private function cancelUnpaidBooking(ConversationState $c): void
    {
        $booking = $c->booking_id ? Booking::find($c->booking_id) : null;
        if ($booking && \in_array($booking->status, ['REQUESTED', 'QUOTED', 'PENDING_PAYMENT', 'PAYMENT_FAILED'], true)) {
            $booking->update(['status' => 'CANCELLED']);
        }
    }

    /** Normalise a typed Zambian mobile number to 2609XXXXXXXX / 2607XXXXXXXX. */
    private function parseZambianMsisdn(string $raw): ?string
    {
        $digits = preg_replace('/\D/', '', $raw);

        if (str_starts_with($digits, '260')) {
            $digits = substr($digits, 3);
        }
        $digits = ltrim($digits, '0');

        // Zambian mobiles: 9 digits starting 9x or 7x (095/096/097/075/076/077…)
        if (! preg_match('/^(9|7)\d{8}$/', $digits)) {
            return null;
        }

        return '260' . $digits;
    }

    /**
     * Resolve the WhatsApp user for this conversation (auto-linked by the
     * webhook for new numbers; fallback lookup for older conversations).
     */
    private function resolveUser(ConversationState $c): ?User
    {
        $user = $c->user_id ? User::find($c->user_id) : null;

        if (! $user) {
            $user = User::where('phone', 'LIKE', '%' . substr($c->whatsapp_id, -9))->first();
            if ($user) {
                $c->user_id = $user->id;
                $c->save();
            }
        }

        return $user;
    }

    /**
     * Create the escrow booking from the conversation context (REQUESTED).
     * Separated from funding so the provider offer can carry a real booking id.
     */
    private function createBookingFromContext(ConversationState $c): ?Booking
    {
        if ($c->booking_id) {
            $existing = Booking::find($c->booking_id);
            // Reuse only a live booking — a retry after expiry/cancellation
            // must start a fresh one (closed bookings can't re-enter payment).
            if ($existing && ! \in_array($existing->status, ['CANCELLED', 'EXPIRED', 'DECLINED'], true)) {
                return $existing;
            }
            $c->booking_id = null;
            $c->save();
        }

        $user = $this->resolveUser($c);

        if (! $user) {
            $this->templates->sendMessage(
                $c->whatsapp_id,
                "We couldn't link this number to an account. Please try again in a moment.",
                $c,
            );
            $this->resetToMenu($c);
            return null;
        }

        $this->templates->sendMessage($c->whatsapp_id, "🧾 Setting up your booking…", $c);

        try {
            $booking = $this->bookingService->create($user, [
                'service_id'              => $c->getContextValue('selected_service_id'),
                'provider_id'             => $c->getContextValue('selected_provider_id'),
                'scheduled_start'         => $c->getContextValue('scheduled_start'),
                'scheduled_end'           => $c->getContextValue('scheduled_end'),
                'delivery_lat'            => $c->getContextValue('location_lat'),
                'delivery_lng'            => $c->getContextValue('location_lng'),
                'delivery_location_label' => $c->getContextValue('location_label'),
                'notes'                   => $c->getContextValue('need_description'),
                // Structured brief answers (quote-first models) — stored on the
                // booking so the provider can quote from any surface.
                'scope_brief'             => $c->getContextValue('brief_answers') ?: null,
                'channel'                 => 'WHATSAPP',
            ]);

            $c->booking_id = $booking->id;
            $c->save();

            return $booking;
        } catch (\Throwable $e) {
            Log::error('ConversationEngine: booking creation failed', ['error' => $e->getMessage()]);
            $this->templates->sendInteractive(
                $c->whatsapp_id,
                MessageBuilder::replyButtons(
                    "Something went wrong while creating your booking. Please try again.",
                    [['id' => 'back_menu', 'title' => 'Start Over']],
                ),
                $c,
            );
            $this->resetToMenu($c);
            return null;
        }
    }

    private function initiateFunding(ConversationState $c): void
    {
        $user = $this->resolveUser($c);

        if (! $user) {
            $this->templates->sendMessage(
                $c->whatsapp_id,
                "We couldn't link this number to an account. Please try again in a moment.",
                $c,
            );
            $this->resetToMenu($c);
            return;
        }

        $booking = $this->createBookingFromContext($c);
        if (! $booking) {
            return;
        }

        try {
            // Optional alternate wallet captured after a PAYMENT_FAILED
            // ("Use another number") — falls back to the account phone.
            $payerOverride = $c->getContextValue('payment_msisdn');
            $this->bookingService->holdFunds($booking->id, $user, $payerOverride);

                // The MoMo approval window is finite — arm the conversation
                // timeout so an unanswered PIN prompt expires cleanly.
                $c->timeout_at = now()->addMinutes((int) config('whatsapp.funding_window_minutes', 30));
                $c->save();

            $prompt = $this->paymentPromptFor($booking->fresh(['service']));

            if (config('pawapay.enabled', false)) {
                // Async: MoMo prompt sent to customer's phone, waiting for PIN confirmation.
                $this->templates->sendMessage($c->whatsapp_id, $prompt, $c);
                $this->templates->sendMessage(
                    $c->whatsapp_id,
                    "A Mobile Money prompt has been sent to your phone. Please enter your PIN to confirm payment.\n\nWe'll notify you once the payment is confirmed.",
                    $c,
                );
            } else {
                // Stub: instant success.
                $this->templates->sendMessage($c->whatsapp_id, $prompt, $c);
                $this->onFundsHeld($c);
            }
        } catch (\Throwable $e) {
            // A failure here is at payment *initiation* (bad request, auth, operator
            // not enabled) — a system-side issue, NOT the customer's balance. Genuine
            // payer-side failures (e.g. insufficient funds) arrive later via the
            // PawaPay callback, which reports the real reason to the customer.
            Log::error('ConversationEngine: holdFunds failed', ['error' => $e->getMessage()]);
            $this->transitionTo($c, 'PAYMENT_FAILED');
            $this->templates->sendInteractive(
                $c->whatsapp_id,
                MessageBuilder::replyButtons(
                    "We couldn't start the Mobile Money payment just now — this is on our side, not your account. Please try again in a moment.",
                    [
                        ['id' => 'retry_payment',    'title' => 'Retry Payment'],
                        ['id' => 'use_other_number', 'title' => 'Use another number'],
                        ['id' => 'cancel_booking',   'title' => 'Cancel'],
                    ],
                ),
                $c,
            );
        }
    }

    /**
     * Model-aware MoMo payment prompt — the hold means something different per
     * pricing model, and the copy must say so before the PIN prompt lands.
     */
    private function paymentPromptFor(Booking $booking): string
    {
        $service = $booking->service;
        $title   = $service->title ?? 'Service';
        $fee     = (float) $booking->buyer_protection_fee;

        if ($service?->pricing_model === 'HOURLY_CAPPED') {
            $hold = (float) ($booking->agreed_amount ?? $booking->amount) + $fee;
            return "*Payment Required*\n\n"
                . "Service: {$title}\n"
                . 'Rate: ZMW ' . number_format((float) $service->hourly_rate, 0) . '/hr · '
                . rtrim(rtrim(number_format((float) $service->minimum_hours, 1), '0'), '.') . "-hr minimum\n"
                . 'Hold: ZMW ' . number_format($hold, 2) . " (the maximum)\n\n"
                . "Your hold will be ZMW " . number_format($hold, 2) . '. '
                . "You're only charged for the actual time worked — any unused amount is refunded to your Mobile Money automatically.\n\n"
                . '_Payment window: 30 minutes_';
        }

        if ($service?->pricing_model === 'QUOTE_DEPOSIT' && $booking->deposit_amount !== null) {
            $deposit = (float) $booking->deposit_amount + $fee;
            return "*Deposit Required*\n\n"
                . "Service: {$title}\n"
                . 'Quote: ZMW ' . number_format((float) ($booking->agreed_amount ?? $booking->amount), 2) . "\n"
                . 'Deposit now: ZMW ' . number_format($deposit, 2) . "\n"
                . 'Balance on completion: ZMW ' . number_format((float) $booking->balance_amount, 2) . "\n\n"
                . "Pay the deposit to confirm your booking. The balance is collected only when the job is done.\n\n"
                . '_Payment window: 30 minutes_';
        }

        return MessageBuilder::paymentPrompt([
            'service_title'        => $title,
            'amount'               => $booking->agreed_amount ?? $booking->amount,
            'buyer_protection_fee' => $booking->buyer_protection_fee,
        ]);
    }

    /**
     * Called by PawapayCallbackController when a deposit completes asynchronously.
     */
    public function onFundsHeldFromCallback(ConversationState $c): void
    {
        $this->onFundsHeld($c);
    }

    private function onFundsHeld(ConversationState $c): void
    {
        $booking = $c->booking_id ? Booking::with(['service', 'provider.providerProfile'])->find($c->booking_id) : null;

        if (! $booking) return;

        // Funding window resolved — disarm the conversation timeout.
        $c->timeout_at = null;
        $c->save();

        // Best-effort: tell the provider the money is secured (their earlier
        // accept message said "the customer is completing payment").
        $this->notifyProviderFundsHeld($booking);

        $providerPhone = null;
        $profile = $booking->provider?->providerProfile;
        if ($profile?->momo_number) {
            $providerPhone = $profile->momo_number;
        } elseif ($booking->provider?->phone) {
            $providerPhone = $booking->provider->phone;
        }

        $this->transitionTo($c, 'IN_PROGRESS');

        $confirmation = MessageBuilder::bookingConfirmation([
            'service_title'   => $booking->service->title ?? 'Service',
            'scheduled_start' => $booking->scheduled_start?->format('D, M j \\a\\t H:i'),
            'delivery_label'  => $booking->delivery_location_label ?? 'Your location',
        ], $providerPhone);

        if ($c->isWithin24hWindow()) {
            // Inside the session window: a single rich confirmation, led by the provider's
            // photo when available. (Previously sent both this AND a redundant template.)
            $this->sendImageOrText(
                $c->whatsapp_id,
                $this->providerAvatarUrl($booking->provider),
                $confirmation,
                $c,
            );
        } else {
            // Outside the window we can only use a pre-approved template.
            $this->templates->sendTemplateMessage(
                $c->whatsapp_id,
                'booking_confirmation',
                [
                    'service_title' => $booking->service->title ?? 'Service',
                    'date'          => $booking->scheduled_start?->format('D, M j'),
                    'provider_name' => $booking->provider?->legal_name ?? 'Your provider',
                    'booking_id'    => substr($booking->id, 0, 8),
                ],
                $c,
            );
        }
    }

    // ── IN_PROGRESS ─────────────────────────────────────────────────────────

    private function handleInProgress(array $inbound, ConversationState $c): void
    {
        $action = $this->resolveAction($inbound);
        $role   = $c->getContextValue('role');

        if ($role === 'provider') {
            $this->handleProviderInProgress($action, $c);
            return;
        }

        if ($action === 'report_issue') {
            $this->templates->sendMessage(
                $c->whatsapp_id,
                "If you're experiencing an issue, please describe what happened and we'll help resolve it.",
                $c,
            );
            return;
        }

        $this->templates->sendInteractive(
            $c->whatsapp_id,
            MessageBuilder::replyButtons(
                "Your booking is in progress. Your provider is working on your request.",
                [
                    ['id' => 'report_issue', 'title' => 'Report Issue'],
                    ['id' => 'back_menu',    'title' => 'Main Menu'],
                ],
            ),
            $c,
        );
    }

    private function handleProviderInProgress(string $action, ConversationState $c): void
    {
        $booking  = $c->booking_id ? Booking::with('service')->find($c->booking_id) : null;
        $provider = $c->user_id ? User::find($c->user_id) : null;
        $isHourly = $booking?->service?->pricing_model === 'HOURLY_CAPPED';

        // HOURLY_CAPPED — observed timer: the provider taps "Start job" on arrival
        // (records the server start time) and "Finish" when done. The elapsed time
        // is computed server-side; no one ever types a number of hours.
        if ($action === 'start_job' && $booking && $provider && $isHourly) {
            if (\in_array($booking->status, ['FUNDS_HELD', 'DEPOSIT_HELD'], true)) {
                $booking = $this->bookingService->markInProgress($booking->id, $provider);
                $startedAt = optional($booking->job_started_at)->setTimezone('Africa/Lusaka')->format('H:i') ?? now()->setTimezone('Africa/Lusaka')->format('H:i');
                $this->templates->sendInteractive(
                    $c->whatsapp_id,
                    MessageBuilder::replyButtons(
                        "Timer started at {$startedAt}. Tap *Finish* when the job is done — we'll charge only the time worked, up to the cap.",
                        [['id' => 'mark_done', 'title' => 'Finish']],
                    ),
                    $c,
                );
                $this->notifyCustomerJobStarted($c, $booking);
                return;
            }
        }

        if ($action === 'mark_done') {
            if ($booking && $booking->status === 'PENDING_PAYMENT') {
                $this->templates->sendMessage(
                    $c->whatsapp_id,
                    "The customer hasn't completed payment yet — we'll let you know the moment it's confirmed. You can mark the job done after that.",
                    $c,
                );
                return;
            }

            // HOURLY_CAPPED requires the timer to have been started first.
            if ($booking && $isHourly && $booking->job_started_at === null) {
                $this->templates->sendInteractive(
                    $c->whatsapp_id,
                    MessageBuilder::replyButtons(
                        "Tap *Start job* first so we can time the work — we charge only the time worked, up to the cap.",
                        [['id' => 'start_job', 'title' => 'Start job']],
                    ),
                    $c,
                );
                return;
            }

            $this->providerMarkDone($c);
            return;
        }

        // Active-job prompt: hourly-capped shows Start (before) / Finish (after);
        // other models just show Mark Done.
        if ($isHourly && $booking && $booking->job_started_at === null) {
            $this->templates->sendInteractive(
                $c->whatsapp_id,
                MessageBuilder::replyButtons(
                    "You have an active job. Tap *Start job* when you begin — we'll time it and charge only the hours worked, up to the cap.",
                    [['id' => 'start_job', 'title' => 'Start job']],
                ),
                $c,
            );
            return;
        }

        $this->templates->sendInteractive(
            $c->whatsapp_id,
            MessageBuilder::replyButtons(
                "You have an active job. Mark it as done when you've completed the work.",
                [['id' => $isHourly ? 'mark_done' : 'mark_done', 'title' => $isHourly ? 'Finish' : 'Mark Done']],
            ),
            $c,
        );
    }

    /** Tell the customer (over WhatsApp) that the job timer has started. */
    private function notifyCustomerJobStarted(ConversationState $c, Booking $booking): void
    {
        $customerWa = $c->getContextValue('customer_wa');
        if (! $customerWa) {
            return;
        }
        $customerConvo = ConversationState::where('whatsapp_id', $customerWa)->first();
        if (! $customerConvo) {
            return;
        }
        $startedAt = optional($booking->job_started_at)->setTimezone('Africa/Lusaka')->format('H:i') ?? now()->setTimezone('Africa/Lusaka')->format('H:i');
        $this->templates->sendMessage(
            $customerWa,
            "Your provider has started the job at {$startedAt}. You'll only pay for the time worked, up to your approved cap.",
            $customerConvo,
        );
    }

    /** "1 hr 30 min" / "45 min" from a minute count. */
    private function formatElapsed(int $minutes): string
    {
        $h = intdiv($minutes, 60);
        $m = $minutes % 60;
        if ($h > 0 && $m > 0) return "{$h} hr {$m} min";
        if ($h > 0)          return "{$h} hr";
        return "{$m} min";
    }

    /** Shared mark-done: deliver (server-timed for hourly-capped), notify customer. */
    private function providerMarkDone(ConversationState $c): void
    {
        $booking  = $c->booking_id ? Booking::with('service')->find($c->booking_id) : null;
        $provider = $c->user_id ? User::find($c->user_id) : null;

        if (! $booking || ! $provider) {
            return;
        }

        try {
            // Non-hourly WhatsApp providers have no separate "start job" tap —
            // held bookings move through IN_PROGRESS on mark-done. Hourly-capped
            // bookings were already started via the "Start job" tap.
            if (\in_array($booking->status, ['FUNDS_HELD', 'DEPOSIT_HELD'], true)) {
                $this->bookingService->markInProgress($booking->id, $provider);
            }
            $booking = $this->bookingService->markDelivered($booking->id, $provider);

            $this->templates->sendMessage(
                $c->whatsapp_id,
                "Job marked as delivered! The customer will be asked to confirm. Payment will be released once confirmed.",
                $c,
            );

            $customerWa = $c->getContextValue('customer_wa');
            if ($customerWa) {
                $customerConvo = ConversationState::where('whatsapp_id', $customerWa)->first();
                if ($customerConvo) {
                    $this->templates->sendInteractive(
                        $customerWa,
                        MessageBuilder::replyButtons(
                            $this->customerDeliveredMessage($booking),
                            [
                                ['id' => 'confirm_complete', 'title' => 'Yes, confirm'],
                                ['id' => 'report_issue',    'title' => 'Report issue'],
                            ],
                        ),
                        $customerConvo,
                    );
                }
            }

            $this->transitionTo($c, 'COMPLETED');
        } catch (\Throwable $e) {
            Log::error('ConversationEngine: markDelivered failed', ['booking_id' => $booking->id, 'error' => $e->getMessage()]);
            $this->templates->sendMessage($c->whatsapp_id, "Sorry, something went wrong on our side — please try marking it done again in a moment.", $c);
        }
    }

    /**
     * Delivered notice to the customer. HOURLY_CAPPED shows the full settlement
     * breakdown (actual time, final charge, refund) BEFORE they confirm release.
     */
    private function customerDeliveredMessage(Booking $booking): string
    {
        $service = $booking->service;

        if ($service?->pricing_model === 'HOURLY_CAPPED' && $booking->observed_minutes !== null) {
            $held   = (float) ($booking->agreed_amount ?? $booking->amount);
            $charge = (float) ($booking->final_charge_zmw ?? $booking->actual_charge_zmw);
            $refund = max($held - $charge, 0);
            $elapsed = $this->formatElapsed((int) $booking->observed_minutes);

            $msg = "Your provider has marked the job as completed.\n\n"
                . "*Time worked:* {$elapsed}\n"
                . '*Final charge:* ZMW ' . number_format($charge, 2)
                . ' of your ZMW ' . number_format($held, 2) . " hold\n";
            if ($refund >= 0.01) {
                $msg .= '*Refund to you:* ZMW ' . number_format($refund, 2) . " (unused part of your hold)\n";
            }
            return $msg . "\nConfirm to release the payment — your refund is sent automatically.";
        }

        if ($service?->pricing_model === 'QUOTE_DEPOSIT' && $booking->balance_amount !== null) {
            return "Your provider has marked the job as completed.\n\n"
                . '*Balance due:* ZMW ' . number_format((float) $booking->balance_amount, 2)
                . " (your deposit of ZMW " . number_format((float) $booking->deposit_amount, 2) . " is already held)\n\n"
                . "Confirm you're satisfied — we'll then send a Mobile Money prompt for the balance.";
        }

        return "Your provider has marked the job as completed. Are you satisfied with the work?";
    }

    // ── TERMINAL states ─────────────────────────────────────────────────────

    private function handleTerminal(array $inbound, ConversationState $c): void
    {
        $action = $this->resolveAction($inbound);

        if ($action === 'retry_match') {
            $this->proceedToMatching($c);
            return;
        }

        if ($action === 'retry_payment') {
            $this->transitionTo($c, 'FUNDING');
            $this->initiateFunding($c);
            return;
        }

        if ($action === 'use_other_number') {
            $this->askForAlternateNumber($c);
            return;
        }

        if ($action === 'confirm_complete' && $c->booking_id) {
            $user = $c->user_id ? User::find($c->user_id) : null;
            if ($user) {
                try {
                    $booking = $this->bookingService->complete($c->booking_id, $user);
                    $this->transitionTo($c, 'COMPLETED');

                    $doneMsg = "Booking completed! Thank you for using Sebenza. We'd love to hear your feedback.";
                    if ($booking->service?->pricing_model === 'HOURLY_CAPPED' && $booking->actual_charge_zmw !== null) {
                        $refund = max((float) ($booking->amount) - (float) $booking->actual_charge_zmw, 0);
                        if ($refund >= 0.01) {
                            $doneMsg = 'Booking completed! Your refund of ZMW ' . number_format($refund, 2)
                                . " (unused part of your hold) is on its way to your Mobile Money.\n\n"
                                . "Thank you for using Sebenza — we'd love to hear your feedback.";
                        }
                    } elseif ($booking->service?->pricing_model === 'QUOTE_DEPOSIT' && (float) $booking->balance_amount >= 0.01) {
                        $doneMsg = 'Booking completed! Check your phone — a Mobile Money prompt for the balance of ZMW '
                            . number_format((float) $booking->balance_amount, 2) . " has been sent.\n\n"
                            . "Thank you for using Sebenza — we'd love to hear your feedback.";
                    }

                    $this->templates->sendMessage(
                        $c->whatsapp_id,
                        $doneMsg,
                        $c,
                    );
                    $this->templates->sendTemplateMessage(
                        $c->whatsapp_id,
                        'review_request',
                        ['service_title' => $c->getContextValue('service_title', 'your service')],
                        $c,
                    );
                } catch (\Throwable $e) {
                    Log::error('ConversationEngine: complete booking failed', ['booking_id' => $c->booking_id, 'error' => $e->getMessage()]);
                    $this->templates->sendMessage($c->whatsapp_id, "Sorry, we couldn't confirm completion just now — please try again in a moment.", $c);
                }
            }
            return;
        }

        $this->resetToMenu($c);
    }

    // ── Provider offer handling (provider-side DISPATCHING) ──────────────────

    public function handleProviderResponse(array $inbound, ConversationState $c): void
    {
        // Provider offer responses bypass handle(), so acknowledge here too — otherwise
        // accepting/declining a job would show no blue ticks or typing indicator.
        $this->acknowledgeInbound($inbound);

        $action = $this->resolveAction($inbound);

        // Quote-first flow: the provider has a brief in hand and replies with
        // "quote 450" (or a bare amount) to send their scoped quote.
        if (\in_array($c->sub_state, ['await_quote_amount', 'await_customer_quote'], true)
            && $inbound['type'] === 'text') {
            $this->handleProviderQuoteReply($inbound, $c);
            return;
        }

        if (str_starts_with($action, 'offer_accept_')) {
            $bookingId = substr($action, 13);
            $provider  = $c->user_id ? User::find($c->user_id) : null;

            if ($provider) {
                $this->templates->sendMessage($c->whatsapp_id, "You accepted the job! The customer is completing payment.", $c);

                $c->booking_id = $bookingId;
                $this->transitionTo($c, 'IN_PROGRESS');

                $booking = Booking::with('service')->find($bookingId);
                if ($booking) {
                    $this->templates->sendMessage(
                        $c->whatsapp_id,
                        "Job details:\n"
                        . "Service: " . ($booking->service->title ?? 'Service') . "\n"
                        . "Location: " . ($booking->delivery_location_label ?? 'See booking') . "\n"
                        . "Date: " . ($booking->scheduled_start?->format('D, M j \\a\\t H:i') ?? 'TBC'),
                        $c,
                    );

                    // Re-send the map pin now the job is theirs, so it's easy to find.
                    // Coords live on the customer conversation context (the Booking model's
                    // delivery_lat/lng are only hydrated by BookingService's raw-SQL reads).
                    $customerWa = $c->getContextValue('customer_wa');
                    $customerConvo = $customerWa
                        ? ConversationState::where('whatsapp_id', $customerWa)->first()
                        : null;
                    if ($customerConvo) {
                        $this->sendJobLocationPin($c->whatsapp_id, $customerConvo);

                        // Keep the customer in the loop — their provider committed.
                        $this->templates->sendMessage(
                            $customerWa,
                            "👍 Your provider has accepted the job and will be there as scheduled.",
                            $customerConvo,
                        );
                    }
                }
            }
            return;
        }

        if (str_starts_with($action, 'offer_decline_')) {
            $bookingId = substr($action, 14);

            $this->templates->sendMessage(
                $c->whatsapp_id,
                "You declined the job. We'll offer it to the next available provider.",
                $c,
            );
            $this->resetToMenu($c);

            if ($bookingId !== '') {
                $this->cascadeToNextProvider($bookingId);
            }
            return;
        }

        $this->templates->sendMessage($c->whatsapp_id, "Please respond to the job offer using the buttons above.", $c);
    }

    // ── Catalog display helpers ─────────────────────────────────────────────

    private function showCategories(ConversationState $c): void
    {
        $categories = $this->catalog->categories();
        $catArray   = $categories->map(fn ($cat) => [
            'id'          => $cat->id,
            'name'        => $cat->name,
            'description' => $cat->description ?? null,
        ])->all();

        Log::info('showCategories: sending list', ['count' => count($catArray), 'to' => $c->whatsapp_id]);

        try {
            $msgId = $this->templates->sendInteractive(
                $c->whatsapp_id,
                MessageBuilder::categoryList($catArray),
                $c,
            );
            Log::info('showCategories: sent OK', ['msgId' => $msgId]);
        } catch (\Throwable $e) {
            Log::error('showCategories: send FAILED', ['error' => $e->getMessage()]);
            $this->templates->sendMessage($c->whatsapp_id, "Please choose a category:\n" . implode("\n", array_map(fn($cat) => "• {$cat['name']}", $catArray)), $c);
        }
    }

    private function showServicesForCategory(ConversationState $c, int $categoryId, int $page): void
    {
        $perPage = 9;
        $services = $this->catalog->browseServices([
            'category_id' => $categoryId,
            'per_page'    => $perPage,
            'page'        => $page,
        ]);

        $svcArray = $services->getCollection()->map(fn ($svc) => [
            'id'        => $svc->id,
            'name'      => $svc->title ?? $svc->name,
            'min_price' => $svc->min_provider_price ?? $svc->base_price,
        ])->all();

        $hasMore = $services->hasMorePages();

        $this->templates->sendInteractive(
            $c->whatsapp_id,
            MessageBuilder::serviceCards($svcArray, $hasMore),
            $c,
        );
    }

    private function showServiceDetail(ConversationState $c, string $serviceId): void
    {
        try {
            $service = $this->catalog->serviceDetail($serviceId);
        } catch (\Throwable) {
            $this->templates->sendMessage($c->whatsapp_id, "Service not found. Please try browsing again.", $c);
            $c->sub_state = 'categories';
            $c->save();
            $this->showCategories($c);
            return;
        }

        $trustSurface = $service->provider_count > 0 ? $this->trust->publicSurface(
            $this->catalog->serviceProviders($serviceId, ['per_page' => 1])->first()?->provider_id ?? ''
        ) : [];
        $detailText = MessageBuilder::serviceDetail([
            'name'           => $service->title ?? $service->name,
            'description'    => $service->description,
            'min_price'      => $service->min_price,
            'provider_count' => $service->provider_count,
        ], $trustSurface);

        $c->setContextValue('service_title', $service->title ?? $service->name);
        $c->save();

        // One picture-led card: photo header + details + actions (was two messages).
        $this->templates->sendInteractive(
            $c->whatsapp_id,
            MessageBuilder::replyButtons(
                $detailText,
                [
                    ['id' => 'book_this',   'title' => 'Book This'],
                    ['id' => 'back_browse', 'title' => 'Back to List'],
                    ['id' => 'back_menu',   'title' => 'Main Menu'],
                ],
                imageUrl: $this->servicePhotoUrl($service),
            ),
            $c,
        );
    }

    private function showDatesForService(ConversationState $c): void
    {
        $serviceId = $c->getContextValue('selected_service_id');

        // Collect open dates across ALL providers offering this service
        $providerServices = \App\Models\ProviderService::where('service_id', $serviceId)
            ->where('status', 'ACTIVE')
            ->pluck('provider_id');

        if ($providerServices->isEmpty()) {
            $this->templates->sendMessage($c->whatsapp_id, "No providers are currently available for this service.", $c);
            return;
        }

        $allDates = [];
        foreach ($providerServices as $pid) {
            foreach ($this->availability->openDates($pid) as $d) {
                $allDates[$d['date']] = $d;
            }
        }

        ksort($allDates);
        $dates = array_values(array_slice($allDates, 0, 10));

        if (empty($dates)) {
            $this->templates->sendMessage($c->whatsapp_id, "No available dates right now. Please try again later.", $c);
            return;
        }

        $this->templates->sendInteractive(
            $c->whatsapp_id,
            MessageBuilder::dateList($dates),
            $c,
        );
    }

    private function showSlotsForDate(ConversationState $c, string $date): void
    {
        $serviceId = $c->getContextValue('selected_service_id');

        // Merge slots from ALL providers offering this service on this date
        $providerServices = \App\Models\ProviderService::where('service_id', $serviceId)
            ->where('status', 'ACTIVE')
            ->pluck('provider_id');

        $mergedSlots = collect();
        foreach ($providerServices as $pid) {
            $slots = $this->availability->slotsForProvider($pid, $date);
            foreach ($slots as $slot) {
                $key = substr($slot['start'], 0, 5) . '-' . substr($slot['end'], 0, 5);
                if (! $mergedSlots->has($key)) {
                    $mergedSlots->put($key, $slot);
                }
            }
        }

        if ($mergedSlots->isEmpty()) {
            $this->templates->sendMessage($c->whatsapp_id, "No slots available on this date. Let me show you other dates.", $c);
            $c->sub_state = 'dates';
            $c->save();
            $this->showDatesForService($c);
            return;
        }

        $this->templates->sendInteractive(
            $c->whatsapp_id,
            MessageBuilder::slotList($mergedSlots->sortKeys()->values()->all(), $date),
            $c,
        );
    }

    private function showMyBookings(ConversationState $c): void
    {
        $user = $c->user_id ? User::find($c->user_id) : null;

        if (! $user) {
            $this->templates->sendMessage(
                $c->whatsapp_id,
                "We couldn't find your account. Please make sure you've registered with this phone number.",
                $c,
            );
            return;
        }

        $bookings = $this->bookingService->list($user);
        $items    = $bookings->getCollection()->take(5);

        if ($items->isEmpty()) {
            $this->templates->sendMessage($c->whatsapp_id, "You don't have any bookings yet.", $c);
            $this->sendMenu($c);
            return;
        }

        $lines = ["*Your Recent Bookings*\n"];
        foreach ($items as $b) {
            $lines[] = "- {$b->service->title} ({$b->status}) — K" . number_format($b->amount, 0);
        }

        $this->templates->sendMessage($c->whatsapp_id, implode("\n", $lines), $c);
        $this->sendMenu($c);
    }

    // ── State management ────────────────────────────────────────────────────

    private function transitionTo(ConversationState $c, string $newState, ?string $subState = null): void
    {
        $from = $c->state;
        $allowed = self::VALID_TRANSITIONS[$from] ?? [];

        if (! in_array($newState, $allowed, true) && $newState !== $from) {
            Log::warning('ConversationEngine: invalid transition', compact('from', 'newState'));
        }

        Log::info('ConversationEngine: transition', [
            'wa'   => $c->whatsapp_id,
            'from' => $from,
            'to'   => $newState,
            'sub'  => $subState,
        ]);

        $c->state     = $newState;
        $c->sub_state = $subState;
        $c->save();
    }

    private function resetToMenu(ConversationState $c): void
    {
        $c->state      = 'MENU';
        $c->sub_state  = null;
        $c->booking_id = null;
        $c->timeout_at = null;
        $c->context    = [];
        $c->save();

        $this->sendMenu($c);
    }

    private function sendMenu(ConversationState $c): void
    {
        $c->state = 'MENU';
        $c->sub_state = null;
        $c->save();

        $userName = null;
        if ($c->user_id) {
            $userName = User::where('id', $c->user_id)->value('legal_name');
        }

        $greeting = $userName && $userName !== 'WhatsApp User'
            ? "Hi {$userName}! Welcome to *Sebenza*."
            : "Welcome to *Sebenza*!";

        $this->templates->sendInteractive(
            $c->whatsapp_id,
            MessageBuilder::replyButtons(
                "{$greeting}\nWhat would you like to do?",
                [
                    ['id' => 'menu_browse',      'title' => 'Browse Services'],
                    ['id' => 'menu_book_now',    'title' => 'Book Now'],
                    ['id' => 'menu_my_bookings', 'title' => 'My Bookings'],
                ],
                'Sebenza',
            ),
            $c,
        );
    }

    private function resolveAction(array $inbound): string
    {
        return match ($inbound['type']) {
            'button_reply' => $inbound['button_id'] ?? '',
            'list_reply'   => $inbound['list_id'] ?? '',
            'text'         => strtolower(trim($inbound['text'] ?? '')),
            default        => '',
        };
    }

    private function parseDate(string $text): ?Carbon
    {
        $text = strtolower(trim($text));

        if ($text === 'today') return Carbon::today('Africa/Lusaka');
        if ($text === 'tomorrow') return Carbon::tomorrow('Africa/Lusaka');

        $days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
        if (in_array($text, $days, true)) {
            return Carbon::parse("next {$text}", 'Africa/Lusaka');
        }

        try {
            $parsed = Carbon::parse($text, 'Africa/Lusaka');
            if ($parsed->isPast()) {
                $parsed->addYear();
            }
            return $parsed;
        } catch (\Throwable) {
            return null;
        }
    }

    /**
     * Mark the inbound message read + show the "typing…" indicator. Called from every
     * inbound entry point (handle + handleProviderResponse) so feedback is consistent.
     */
    private function acknowledgeInbound(array $inbound): void
    {
        if (! empty($inbound['message_id'])) {
            $this->gateway->markRead($inbound['message_id'], typing: true);
        }
    }

    // ── Image helpers (best-effort, graceful text fallback) ──────────────────

    /**
     * Resolve a stored image path to a fully-qualified public HTTPS URL that the
     * WhatsApp Cloud API can fetch. Returns null when no usable absolute URL exists
     * (e.g. local/dev) so callers fall back to text.
     */
    private function publicUrl(?string $path): ?string
    {
        if (! $path) {
            return null;
        }

        if (str_starts_with($path, 'http://') || str_starts_with($path, 'https://')) {
            return $path;
        }

        $url = Storage::disk('public')->url($path);

        if (! str_starts_with($url, 'http://') && ! str_starts_with($url, 'https://')) {
            $url = rtrim((string) config('app.url'), '/') . '/' . ltrim($url, '/');
        }

        return str_starts_with($url, 'http://') || str_starts_with($url, 'https://') ? $url : null;
    }

    /**
     * Best-effort hero image for a service: its first photo, else the provider's cover image.
     */
    private function servicePhotoUrl(\App\Models\Service $service): ?string
    {
        $photoPath = $service->relationLoaded('photos')
            ? $service->photos->first()?->path
            : $service->photos()->orderBy('display_order')->value('path');

        return $this->publicUrl($photoPath)
            ?? $this->publicUrl($service->provider?->providerProfile?->cover_image_url);
    }

    /**
     * Best-effort public avatar for a provider user.
     */
    private function providerAvatarUrl(?User $providerUser): ?string
    {
        return $this->publicUrl($providerUser?->providerProfile?->avatar_url);
    }

    /**
     * Best-effort: drop a WhatsApp location pin of the job site (from the customer
     * conversation context) so the provider can see distance / navigate. Silent no-op
     * if coordinates are missing or the send fails.
     */
    private function sendJobLocationPin(string $providerWa, ConversationState $customerConvo): void
    {
        $lat = $customerConvo->getContextValue('location_lat');
        $lng = $customerConvo->getContextValue('location_lng');

        if ($lat === null || $lng === null) {
            return;
        }

        try {
            $this->gateway->sendLocation(
                $providerWa,
                (float) $lat,
                (float) $lng,
                'Job location',
                (string) $customerConvo->getContextValue('location_label', 'Shared location'),
            );
        } catch (\Throwable $e) {
            Log::warning('ConversationEngine: job location pin send failed', [
                'to' => $providerWa, 'error' => $e->getMessage(),
            ]);
        }
    }

    /**
     * Send an image with caption, falling back to a plain text message if the image
     * send fails (unreachable URL, API error, etc.). Guarantees the user still gets
     * the information.
     */
    private function sendImageOrText(string $to, ?string $imageUrl, string $caption, ConversationState $c): void
    {
        if ($imageUrl) {
            try {
                $this->gateway->sendImage($to, $imageUrl, $caption);
                return;
            } catch (\Throwable $e) {
                Log::warning('ConversationEngine: image send failed, falling back to text', [
                    'to' => $to, 'error' => $e->getMessage(),
                ]);
            }
        }

        $this->templates->sendMessage($to, $caption, $c);
    }
}
