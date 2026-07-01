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
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;

class ConversationEngine
{
    private const VALID_TRANSITIONS = [
        'MENU'         => ['BROWSING', 'COLLECTING'],
        'BROWSING'     => ['MENU', 'MATCHING', 'BROWSING'],
        'COLLECTING'   => ['MENU', 'MATCHING', 'COLLECTING'],
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
        if ($inbound['type'] === 'text' && ! empty($inbound['text'])) {
            $c->setContextValue('need_description', $inbound['text']);
            $c->sub_state = 'location';
            $c->save();

            $this->templates->sendInteractive(
                $c->whatsapp_id,
                MessageBuilder::locationRequest("*Step 2 of 3 — Where?*\nGot it! Now share your location so we can find providers near you."),
                $c,
            );
            return;
        }

        $this->templates->sendMessage(
            $c->whatsapp_id,
            "Please describe what service you need. For example: \"I need a plumber to fix a leaking tap.\"",
            $c,
        );
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

        $tierLabel = $provider['tier_label'] ?? 'Verified';
        $providerName = $provider['name'] ?? 'a provider';
        $price = number_format($provider['price'] ?? 0, 2);

        $matchCaption = "✅ Found a match!\n\n"
            . "*{$providerName}* — {$tierLabel}\n"
            . "Price: ZMW {$price}\n\n"
            . "Notifying the provider and preparing your booking...";

        // Lead with the provider's face when available — builds trust and reads faster
        // than text. Falls back to the same copy as a plain message.
        $providerUser = User::find($provider['provider_id']);
        $this->sendImageOrText($c->whatsapp_id, $this->providerAvatarUrl($providerUser), $matchCaption, $c);

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

        $offerData = [
            'booking_id'      => $c->booking_id,
            'service_title'   => $service->title ?? $service->name ?? 'Service',
            'scheduled_start' => $c->getContextValue('scheduled_start'),
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

    // ── FUNDING ─────────────────────────────────────────────────────────────

    private function handleFunding(array $inbound, ConversationState $c): void
    {
        $action = $this->resolveAction($inbound);

        if ($action === 'cancel_booking') {
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

        $this->templates->sendInteractive(
            $c->whatsapp_id,
            MessageBuilder::replyButtons(
                "We're waiting for your Mobile Money payment to be confirmed.\n\nCheck your phone for the payment prompt and enter your PIN.",
                [['id' => 'cancel_booking', 'title' => 'Cancel Booking']],
            ),
            $c,
        );
    }

    private function initiateFunding(ConversationState $c): void
    {
        $user = $c->user_id ? User::find($c->user_id) : null;

        if (! $user) {
            $user = User::where('phone', 'LIKE', '%' . substr($c->whatsapp_id, -9))->first();
            if ($user) {
                $c->user_id = $user->id;
                $c->save();
            }
        }

        if (! $user) {
            $this->templates->sendMessage(
                $c->whatsapp_id,
                "We need to link your account before processing payment. Please register on the app first, then try again.",
                $c,
            );
            $this->resetToMenu($c);
            return;
        }

        $serviceId  = $c->getContextValue('selected_service_id');
        $providerId = $c->getContextValue('selected_provider_id');

        // Acknowledge before the synchronous create + fund-hold (the slowest step) so the
        // chat isn't silent while it runs.
        $this->templates->sendMessage($c->whatsapp_id, "🧾 Setting up your booking…", $c);

        try {
            $booking = $this->bookingService->create($user, [
                'service_id'              => $serviceId,
                'provider_id'             => $providerId,
                'scheduled_start'         => $c->getContextValue('scheduled_start'),
                'scheduled_end'           => $c->getContextValue('scheduled_end'),
                'delivery_lat'            => $c->getContextValue('location_lat'),
                'delivery_lng'            => $c->getContextValue('location_lng'),
                'delivery_location_label' => $c->getContextValue('location_label'),
                'notes'                   => $c->getContextValue('need_description'),
                'channel'                 => 'WHATSAPP',
            ]);

            $c->booking_id = $booking->id;
            $c->save();

            try {
                $this->bookingService->holdFunds($booking->id, $user);

                if (config('pawapay.enabled', false)) {
                    // Async: MoMo prompt sent to customer's phone, waiting for PIN confirmation.
                    $this->templates->sendMessage(
                        $c->whatsapp_id,
                        MessageBuilder::paymentPrompt([
                            'service_title'        => $booking->service->title ?? 'Service',
                            'amount'               => $booking->amount,
                            'buyer_protection_fee'  => $booking->buyer_protection_fee,
                        ]),
                        $c,
                    );
                    $this->templates->sendMessage(
                        $c->whatsapp_id,
                        "A Mobile Money prompt has been sent to your phone. Please enter your PIN to confirm payment.\n\nWe'll notify you once the payment is confirmed.",
                        $c,
                    );
                } else {
                    // Stub: instant success.
                    $this->templates->sendMessage(
                        $c->whatsapp_id,
                        MessageBuilder::paymentPrompt([
                            'service_title'        => $booking->service->title ?? 'Service',
                            'amount'               => $booking->amount,
                            'buyer_protection_fee'  => $booking->buyer_protection_fee,
                        ]),
                        $c,
                    );
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
                            ['id' => 'retry_payment', 'title' => 'Retry Payment'],
                            ['id' => 'cancel_booking', 'title' => 'Cancel'],
                        ],
                    ),
                    $c,
                );
            }
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
        }
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
        if ($action === 'mark_done') {
            $booking = $c->booking_id ? Booking::find($c->booking_id) : null;
            $provider = $c->user_id ? User::find($c->user_id) : null;

            if ($booking && $provider) {
                try {
                    $this->bookingService->markDelivered($booking->id, $provider);

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
                                    "Your provider has marked the job as completed. Are you satisfied with the work?",
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
            return;
        }

        $this->templates->sendInteractive(
            $c->whatsapp_id,
            MessageBuilder::replyButtons(
                "You have an active job. Mark it as done when you've completed the work.",
                [['id' => 'mark_done', 'title' => 'Mark Done']],
            ),
            $c,
        );
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

        if ($action === 'confirm_complete' && $c->booking_id) {
            $user = $c->user_id ? User::find($c->user_id) : null;
            if ($user) {
                try {
                    $this->bookingService->complete($c->booking_id, $user);
                    $this->transitionTo($c, 'COMPLETED');
                    $this->templates->sendMessage(
                        $c->whatsapp_id,
                        "Booking completed! Thank you for using Sebenza. We'd love to hear your feedback.",
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

            $next = $this->dispatch->cascade($bookingId);
            if (! $next) {
                Log::info('ConversationEngine: provider cascade exhausted', ['booking_id' => $bookingId]);
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
