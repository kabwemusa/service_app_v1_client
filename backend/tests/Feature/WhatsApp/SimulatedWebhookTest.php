<?php

namespace Tests\Feature\WhatsApp;

use App\Contracts\DispatchService;
use App\Contracts\PaymentGateway;
use App\Contracts\WhatsAppGateway;
use App\Models\ConversationState;
use App\Models\ProcessedMessage;
use App\Services\Gateway\StubWhatsAppGateway;
use App\Services\WhatsApp\TestDispatchService;
use App\Services\WhatsApp\TestPaymentGateway;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Support\RecordingWhatsAppGateway;
use Tests\TestCase;

class SimulatedWebhookTest extends TestCase
{
    use RefreshDatabase;

    private string $testPhone = '260971234567';
    private string $providerPhone = '260979876543';

    protected function setUp(): void
    {
        parent::setUp();

        $this->app->bind(WhatsAppGateway::class, StubWhatsAppGateway::class);
        $this->app->bind(DispatchService::class, TestDispatchService::class);
        $this->app->bind(PaymentGateway::class, TestPaymentGateway::class);

        config(['whatsapp.verify_token' => 'test_verify_token']);
        config(['whatsapp.app_secret' => 'test_secret']);
        config(['whatsapp.test_mode' => true]);
    }

    // ── Webhook Verification ────────────────────────────────────────────────

    public function test_webhook_verify_succeeds_with_correct_token(): void
    {
        $response = $this->get('/api/webhook?' . http_build_query([
            'hub_mode'         => 'subscribe',
            'hub_verify_token' => 'test_verify_token',
            'hub_challenge'    => 'challenge_12345',
        ]));

        $response->assertStatus(200);
        $response->assertSee('challenge_12345');
    }

    public function test_webhook_verify_rejects_wrong_token(): void
    {
        $response = $this->get('/api/webhook?' . http_build_query([
            'hub_mode'         => 'subscribe',
            'hub_verify_token' => 'wrong_token',
            'hub_challenge'    => 'challenge_12345',
        ]));

        $response->assertStatus(403);
    }

    // ── Signature Validation ────────────────────────────────────────────────

    public function test_webhook_rejects_invalid_signature(): void
    {
        $payload = $this->buildWebhookPayload('text', 'Hi');

        $response = $this->postJson('/api/webhook', $payload, [
            'X-Hub-Signature-256' => 'sha256=invalid',
        ]);

        $response->assertStatus(403);
    }

    public function test_webhook_accepts_valid_signature(): void
    {
        $payload = $this->buildWebhookPayload('text', 'Hi');
        $body    = json_encode($payload);
        $sig     = 'sha256=' . hash_hmac('sha256', $body, 'test_secret');

        $response = $this->call('POST', '/api/webhook', [], [], [], [
            'HTTP_X-Hub-Signature-256' => $sig,
            'CONTENT_TYPE'             => 'application/json',
        ], $body);

        $response->assertStatus(200);
    }

    // ── Deduplication ───────────────────────────────────────────────────────

    public function test_duplicate_messages_are_idempotent(): void
    {
        $payload = $this->buildWebhookPayload('text', 'Hi', 'wamid.dedup_test_001');

        $this->postWithSignature($payload);
        $this->postWithSignature($payload);

        $this->assertDatabaseCount('processed_messages', 1);
        $this->assertDatabaseHas('processed_messages', ['message_id' => 'wamid.dedup_test_001']);
    }

    // ── Flow 1: Browse → Pick Service → Date → Shortlist → Confirm ────────

    public function test_browse_flow_creates_conversation_state(): void
    {
        $this->postWithSignature($this->buildWebhookPayload('text', 'Hi'));

        $convo = ConversationState::where('whatsapp_id', $this->testPhone)->first();
        $this->assertNotNull($convo);
        $this->assertEquals('MENU', $convo->state);
    }

    public function test_browse_button_transitions_to_browsing(): void
    {
        $this->postWithSignature($this->buildWebhookPayload('text', 'Hi'));

        $this->postWithSignature($this->buildWebhookPayload('button_reply', null, null, 'menu_browse'));

        $convo = ConversationState::where('whatsapp_id', $this->testPhone)->first();
        $this->assertEquals('BROWSING', $convo->state);
        $this->assertEquals('categories', $convo->sub_state);
    }

    // ── Flow 2: Book Now → Collect → Match ──────────────────────────────────

    public function test_book_now_transitions_to_collecting(): void
    {
        $this->postWithSignature($this->buildWebhookPayload('text', 'Hi'));

        $this->postWithSignature($this->buildWebhookPayload('button_reply', null, null, 'menu_book_now'));

        $convo = ConversationState::where('whatsapp_id', $this->testPhone)->first();
        $this->assertEquals('COLLECTING', $convo->state);
        $this->assertEquals('need', $convo->sub_state);
    }

    public function test_collecting_need_stores_description(): void
    {
        $this->postWithSignature($this->buildWebhookPayload('text', 'Hi'));
        $this->postWithSignature($this->buildWebhookPayload('button_reply', null, null, 'menu_book_now'));

        $this->postWithSignature($this->buildWebhookPayload('text', 'I need a plumber'));

        $convo = ConversationState::where('whatsapp_id', $this->testPhone)->first();
        $this->assertEquals('COLLECTING', $convo->state);
        $this->assertEquals('location', $convo->sub_state);
        $this->assertEquals('I need a plumber', $convo->getContextValue('need_description'));
    }

    public function test_collecting_location_stores_coordinates(): void
    {
        $this->postWithSignature($this->buildWebhookPayload('text', 'Hi'));
        $this->postWithSignature($this->buildWebhookPayload('button_reply', null, null, 'menu_book_now'));
        $this->postWithSignature($this->buildWebhookPayload('text', 'plumber needed'));

        $this->postWithSignature($this->buildWebhookPayload('location', null, null, null, -15.4167, 28.2833));

        $convo = ConversationState::where('whatsapp_id', $this->testPhone)->first();
        $this->assertEquals(-15.4167, $convo->getContextValue('location_lat'));
        $this->assertEquals(28.2833, $convo->getContextValue('location_lng'));
    }

    // ── Flow 3: Provider receives and responds to offer ─────────────────────

    public function test_provider_offer_accept_transitions_state(): void
    {
        $provider = \App\Models\User::create([
            'email' => 'testprovider@test.zm',
            'phone' => '+' . $this->providerPhone,
            'legal_name' => 'Test Provider',
            'role' => 'PROVIDER',
            'account_state' => 'ACTIVE',
            'password_hash' => 'test',
        ]);

        $engine = app(\App\Services\WhatsApp\ConversationEngine::class);

        // Create a real booking so the FK constraint is satisfied
        $customer = \App\Models\User::create([
            'email' => 'testcustomer@test.zm',
            'phone' => '+' . $this->testPhone,
            'legal_name' => 'Test Customer',
            'role' => 'CUSTOMER',
            'account_state' => 'ACTIVE',
            'password_hash' => 'test',
        ]);

        $category = \App\Models\Category::create([
            'name' => 'Test', 'slug' => 'test-cat', 'is_active' => true, 'risk_tier' => 1,
        ]);
        $service = \App\Models\Service::create([
            'title' => 'Test Svc', 'category_id' => $category->id,
            'status' => 'ACTIVE', 'base_price' => 100, 'pricing_model' => 'OUTCOME_FIXED',
            'provider_id' => $provider->id,
        ]);

        $tomorrow = \Carbon\Carbon::tomorrow('Africa/Lusaka');
        $booking = \App\Models\Booking::create([
            'buyer_id'        => $customer->id,
            'provider_id'     => $provider->id,
            'service_id'      => $service->id,
            'amount'          => 100,
            'status'          => 'REQUESTED',
            'payment_mode'    => 'ESCROW',
            'scheduled_start' => $tomorrow->copy()->setTime(10, 0),
            'scheduled_end'   => $tomorrow->copy()->setTime(12, 0),
        ]);

        $convo = ConversationState::create([
            'whatsapp_id'    => $this->providerPhone,
            'user_id'        => $provider->id,
            'state'          => 'DISPATCHING',
            'context'        => [
                'role'        => 'provider',
                'customer_wa' => $this->testPhone,
            ],
            'last_inbound_at' => now(),
        ]);

        $inbound = [
            'type'      => 'button_reply',
            'button_id' => 'offer_accept_' . $booking->id,
            'message_id' => 'wamid.test_accept',
            'from'       => $this->providerPhone,
        ];

        $engine->handleProviderResponse($inbound, $convo);

        $convo->refresh();
        $this->assertEquals('IN_PROGRESS', $convo->state);
    }

    // ── UX upgrades: typing indicator, images, location pins, friendly errors ─

    public function test_inbound_message_shows_typing_indicator(): void
    {
        $recorder = new RecordingWhatsAppGateway();
        $this->app->instance(WhatsAppGateway::class, $recorder);

        $this->postWithSignature($this->buildWebhookPayload('text', 'Hi'));

        $readCalls = $recorder->callsOfType('mark_read');
        $this->assertNotEmpty($readCalls, 'expected the inbound message to be marked read');
        $this->assertTrue($readCalls[0]['typing'], 'expected the typing indicator to be requested');
    }

    public function test_service_detail_renders_as_single_image_card(): void
    {
        $recorder = new RecordingWhatsAppGateway();
        $this->app->instance(WhatsAppGateway::class, $recorder);

        $provider = \App\Models\User::create([
            'email' => 'imgprovider@test.zm', 'phone' => '+260979000010',
            'legal_name' => 'Image Provider', 'role' => 'PROVIDER',
            'account_state' => 'ACTIVE', 'password_hash' => 'test',
        ]);
        \App\Models\ProviderProfile::create([
            'user_id' => $provider->id, 'trust_tier' => 2, 'display_name' => 'Image Provider',
            'accepting_bookings' => true,
        ]);
        $category = \App\Models\Category::create([
            'name' => 'Home', 'slug' => 'home-img', 'is_active' => true, 'risk_tier' => 1, 'display_order' => 1,
        ]);
        $service = \App\Models\Service::create([
            'title' => 'Plumbing', 'category_id' => $category->id, 'status' => 'ACTIVE',
            'base_price' => 150, 'pricing_model' => 'OUTCOME_FIXED', 'description' => 'Pipe and tap repair.',
            'provider_id' => $provider->id,
        ]);
        \App\Models\ServicePhoto::create([
            'service_id' => $service->id, 'path' => 'service_photos/plumbing.jpg', 'display_order' => 0,
        ]);

        $this->postWithSignature($this->buildWebhookPayload('text', 'Hi'));
        $this->postWithSignature($this->buildWebhookPayload('button_reply', null, null, 'menu_browse'));
        $this->postWithSignature($this->buildWebhookPayload('list_reply', null, null, 'cat_' . $category->id));
        $this->postWithSignature($this->buildWebhookPayload('list_reply', null, null, 'svc_' . $service->id));

        $interactive = $recorder->callsOfType('interactive');
        $this->assertNotEmpty($interactive);
        $detail = end($interactive);

        $this->assertSame('image', $detail['interactive']['header']['type'] ?? null,
            'service detail should be a single card led by an image header');
        $this->assertStringContainsString('Plumbing', $detail['interactive']['body']['text']);
        // The detail must NOT also be sent as a separate plain text blob.
        $this->assertFalse(
            collect($recorder->callsOfType('text'))->contains(fn ($c) => str_contains($c['text'], 'Pipe and tap repair.')),
            'service description should not be duplicated as a separate text message',
        );
    }

    public function test_provider_accept_sends_job_location_pin(): void
    {
        $recorder = new RecordingWhatsAppGateway();
        $this->app->instance(WhatsAppGateway::class, $recorder);

        [$booking, $convo] = $this->makeProviderOfferFixture(deliveryLat: -15.4167, deliveryLng: 28.2833);

        $engine = app(\App\Services\WhatsApp\ConversationEngine::class);
        $engine->handleProviderResponse([
            'type' => 'button_reply', 'button_id' => 'offer_accept_' . $booking->id,
            'message_id' => 'wamid.accept_pin', 'from' => $this->providerPhone,
        ], $convo);

        $this->assertTrue($recorder->hasCallOfType('location'), 'accepting a job should send a map pin');
        $pin = $recorder->callsOfType('location')[0];
        $this->assertEqualsWithDelta(-15.4167, $pin['lat'], 0.0001);

        // Provider offer responses must also acknowledge (read + typing), like every other path.
        $reads = $recorder->callsOfType('mark_read');
        $this->assertNotEmpty($reads);
        $this->assertTrue($reads[0]['typing'], 'provider offer response should show the typing indicator');
    }

    public function test_mark_done_failure_shows_friendly_message_not_exception(): void
    {
        $recorder = new RecordingWhatsAppGateway();
        $this->app->instance(WhatsAppGateway::class, $recorder);

        // Booking left in REQUESTED so markDelivered (REQUESTED→DELIVERED) is rejected.
        [$booking, $convo] = $this->makeProviderOfferFixture(state: 'IN_PROGRESS', bookingStatus: 'REQUESTED');
        $convo->booking_id = $booking->id;
        $convo->save();

        $engine = app(\App\Services\WhatsApp\ConversationEngine::class);
        $engine->handle([
            'type' => 'button_reply', 'button_id' => 'mark_done',
            'message_id' => 'wamid.markdone_fail', 'from' => $this->providerPhone,
        ], $convo);

        $texts = collect($recorder->callsOfType('text'))->pluck('text');
        $this->assertTrue($texts->contains(fn ($t) => str_contains($t, 'something went wrong on our side')),
            'a friendly error should be shown');
        $this->assertFalse($texts->contains(fn ($t) => str_contains($t, 'Exception') || str_contains($t, 'transition')),
            'raw exception details must not leak to the user');
    }

    /**
     * Build a provider + customer + booking + provider conversation in one shot.
     *
     * @return array{0: \App\Models\Booking, 1: ConversationState}
     */
    private function makeProviderOfferFixture(
        string $state = 'DISPATCHING',
        string $bookingStatus = 'REQUESTED',
        ?float $deliveryLat = null,
        ?float $deliveryLng = null,
    ): array {
        $provider = \App\Models\User::create([
            'email' => 'fixtureprovider@test.zm', 'phone' => '+' . $this->providerPhone,
            'legal_name' => 'Fixture Provider', 'role' => 'PROVIDER',
            'account_state' => 'ACTIVE', 'password_hash' => 'test',
        ]);
        $customer = \App\Models\User::create([
            'email' => 'fixturecustomer@test.zm', 'phone' => '+' . $this->testPhone,
            'legal_name' => 'Fixture Customer', 'role' => 'CUSTOMER',
            'account_state' => 'ACTIVE', 'password_hash' => 'test',
        ]);
        $category = \App\Models\Category::create([
            'name' => 'Fix', 'slug' => 'fix-cat', 'is_active' => true, 'risk_tier' => 1,
        ]);
        $service = \App\Models\Service::create([
            'title' => 'Fixture Svc', 'category_id' => $category->id, 'status' => 'ACTIVE',
            'base_price' => 100, 'pricing_model' => 'OUTCOME_FIXED', 'provider_id' => $provider->id,
        ]);
        $tomorrow = \Carbon\Carbon::tomorrow('Africa/Lusaka');
        $booking = \App\Models\Booking::create([
            'buyer_id' => $customer->id, 'provider_id' => $provider->id, 'service_id' => $service->id,
            'amount' => 100, 'status' => $bookingStatus, 'payment_mode' => 'ESCROW',
            'scheduled_start' => $tomorrow->copy()->setTime(10, 0),
            'scheduled_end' => $tomorrow->copy()->setTime(12, 0),
            'delivery_lat' => $deliveryLat, 'delivery_lng' => $deliveryLng,
            'delivery_location_label' => $deliveryLat ? 'Pinned spot' : null,
        ]);
        $convo = ConversationState::create([
            'whatsapp_id' => $this->providerPhone, 'user_id' => $provider->id, 'state' => $state,
            'context' => ['role' => 'provider', 'customer_wa' => $this->testPhone],
            'last_inbound_at' => now(),
        ]);

        // Customer conversation holds the job coords (source of truth for the map pin).
        if ($deliveryLat !== null && $deliveryLng !== null) {
            ConversationState::create([
                'whatsapp_id' => $this->testPhone, 'user_id' => $customer->id, 'state' => 'IN_PROGRESS',
                'context' => [
                    'location_lat'   => $deliveryLat,
                    'location_lng'   => $deliveryLng,
                    'location_label' => 'Pinned spot',
                ],
                'last_inbound_at' => now(),
            ]);
        }

        return [$booking, $convo];
    }

    // ── Message type parsing ────────────────────────────────────────────────

    public function test_parses_text_message(): void
    {
        $this->postWithSignature($this->buildWebhookPayload('text', 'Hello'));

        $this->assertDatabaseHas('conversation_states', ['whatsapp_id' => $this->testPhone]);
    }

    public function test_parses_button_reply(): void
    {
        $this->postWithSignature($this->buildWebhookPayload('text', 'Hi'));
        $this->postWithSignature($this->buildWebhookPayload('button_reply', null, null, 'menu_browse'));

        $convo = ConversationState::where('whatsapp_id', $this->testPhone)->first();
        $this->assertEquals('BROWSING', $convo->state);
    }

    public function test_parses_list_reply(): void
    {
        $this->postWithSignature($this->buildWebhookPayload('text', 'Hi'));
        $this->postWithSignature($this->buildWebhookPayload('button_reply', null, null, 'menu_browse'));

        $this->postWithSignature($this->buildWebhookPayload('list_reply', null, null, 'cat_1'));

        $convo = ConversationState::where('whatsapp_id', $this->testPhone)->first();
        $this->assertEquals('BROWSING', $convo->state);
        $this->assertEquals('services', $convo->sub_state);
    }

    public function test_parses_location_message(): void
    {
        $this->postWithSignature($this->buildWebhookPayload('text', 'Hi'));
        $this->postWithSignature($this->buildWebhookPayload('button_reply', null, null, 'menu_book_now'));
        $this->postWithSignature($this->buildWebhookPayload('text', 'cleaning service'));

        $this->postWithSignature($this->buildWebhookPayload('location', null, null, null, -15.4167, 28.2833));

        $convo = ConversationState::where('whatsapp_id', $this->testPhone)->first();
        $this->assertNotNull($convo->getContextValue('location_lat'));
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private function buildWebhookPayload(
        string $type,
        ?string $text = null,
        ?string $messageId = null,
        ?string $interactiveId = null,
        ?float $lat = null,
        ?float $lng = null,
        ?string $from = null,
    ): array {
        $msgId = $messageId ?? 'wamid.test_' . uniqid();
        $from  = $from ?? $this->testPhone;

        $message = [
            'id'        => $msgId,
            'from'      => $from,
            'timestamp' => (string) time(),
            'type'      => $type,
        ];

        match ($type) {
            'text' => $message['text'] = ['body' => $text ?? ''],
            'button_reply' => $message = array_merge($message, [
                'type'        => 'interactive',
                'interactive' => [
                    'type'         => 'button_reply',
                    'button_reply' => ['id' => $interactiveId ?? '', 'title' => 'Button'],
                ],
            ]),
            'list_reply' => $message = array_merge($message, [
                'type'        => 'interactive',
                'interactive' => [
                    'type'       => 'list_reply',
                    'list_reply' => ['id' => $interactiveId ?? '', 'title' => 'Item'],
                ],
            ]),
            'location' => $message['location'] = [
                'latitude'  => $lat ?? 0,
                'longitude' => $lng ?? 0,
                'name'      => 'Test Location',
                'address'   => 'Test Address',
            ],
            'image' => $message['image'] = [
                'id'        => 'img_test_001',
                'mime_type' => 'image/jpeg',
                'caption'   => $text,
            ],
            default => null,
        };

        return [
            'object' => 'whatsapp_business_account',
            'entry'  => [[
                'id'      => '123456',
                'changes' => [[
                    'field' => 'messages',
                    'value' => [
                        'messaging_product' => 'whatsapp',
                        'metadata'          => [
                            'display_phone_number' => '260971000000',
                            'phone_number_id'      => 'test_phone_id',
                        ],
                        'contacts' => [[
                            'profile' => ['name' => 'Test User'],
                            'wa_id'   => $from,
                        ]],
                        'messages' => [$message],
                    ],
                ]],
            ]],
        ];
    }

    private function postWithSignature(array $payload): \Illuminate\Testing\TestResponse
    {
        $body = json_encode($payload);
        $sig  = 'sha256=' . hash_hmac('sha256', $body, 'test_secret');

        return $this->call('POST', '/api/webhook', [], [], [], [
            'HTTP_X-Hub-Signature-256' => $sig,
            'CONTENT_TYPE'             => 'application/json',
        ], $body);
    }
}
