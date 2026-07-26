<?php

use App\Http\Controllers\Api\Admin\AdminAuthController;
use App\Http\Controllers\Api\Admin\AdminAuditLogController;
use App\Http\Controllers\Api\Admin\AdminBookingController;
use App\Http\Controllers\Api\Admin\AdminDashboardController;
use App\Http\Controllers\Api\Admin\AdminFinanceController;
use App\Http\Controllers\Api\Admin\AdminFraudController;
use App\Http\Controllers\Api\Admin\AdminInsightsController;
use App\Http\Controllers\Api\Admin\AdminReviewController;
use App\Http\Controllers\Api\Admin\AdminSafetyController;
use App\Http\Controllers\Api\Admin\AdminServiceController;
use App\Http\Controllers\Api\Admin\AdminSettingsController;
use App\Http\Controllers\Api\Admin\AdminUserController;
use App\Http\Controllers\Api\Admin\AdminVerificationController;
use App\Http\Controllers\Api\Admin\AdminWhatsAppController;
use App\Http\Controllers\Api\Admin\AdminLegalController;
use App\Http\Controllers\Api\Admin\AdminPromotionsController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\PawapayCallbackController;
use App\Http\Controllers\Api\WhatsAppWebhookController;
use App\Http\Controllers\Api\BookingController;
use App\Http\Controllers\Api\BookingAgreementController;
use App\Http\Controllers\Api\CommunicationController;
use App\Http\Controllers\Api\NotificationController;
use App\Http\Controllers\Api\CategoryController;
use App\Http\Controllers\Api\DisputeController;
use App\Http\Controllers\Api\HomeBannerController;
use App\Http\Controllers\Api\LandingController;
use App\Http\Controllers\Api\LegalController;
use App\Http\Controllers\Api\ConsentController;
use App\Http\Controllers\Api\KycController;
use App\Http\Controllers\Api\LocationController;
use App\Http\Controllers\Api\SafetyReportController;
use App\Http\Controllers\Api\ProviderProfileController;
use App\Http\Controllers\Api\PublicProviderController;
use App\Http\Controllers\Api\SearchController;
use App\Http\Controllers\Api\SearchSuggestController;
use App\Http\Controllers\Api\ServiceController;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| API Routes — Sebenza
|--------------------------------------------------------------------------
*/

// ── Auth (public) ──────────────────────────────────────────────────────────
Route::prefix('auth')->group(function () {
    // Canonical passwordless phone-OTP (identity rule: phone = single account key)
    Route::post('/otp/request', [AuthController::class, 'requestOtp'])->middleware('throttle:otp');
    Route::post('/otp/verify',  [AuthController::class, 'verifyPhoneOtp'])->middleware('throttle:otp');

    // Legacy email + password + email-OTP — DEPRECATED, retained dormant for the
    // superseded Expo app during transition (§ API-3). Gated behind a config flag
    // so production can drop this weaker surface once no Expo clients remain
    // (AUTH_LEGACY_PASSWORD_AUTH=false). `refresh` stays available regardless —
    // the canonical phone-OTP flow issues refresh tokens too.
    Route::post('/refresh',    [AuthController::class, 'refresh'])->middleware('throttle:auth');

    if (config('auth.legacy_password_auth', true)) {
        Route::post('/register',   [AuthController::class, 'register'])->middleware('throttle:auth');
        Route::post('/verify-otp', [AuthController::class, 'verifyOtp'])->middleware('throttle:otp');
        Route::post('/login',      [AuthController::class, 'login'])->middleware('throttle:auth');
        Route::post('/resend-otp', [AuthController::class, 'resendOtp'])->middleware('throttle:otp');
    }

    Route::middleware('auth:api')->group(function () {
        Route::post('/logout', [AuthController::class, 'logout']);
    });
});

// ── Admin panel auth (separate `admin` guard / admin_users) ────────────────
Route::prefix('admin/auth')->group(function () {
    Route::post('/login', [AdminAuthController::class, 'login']);

    Route::middleware('auth:admin')->group(function () {
        Route::get('/me',      [AdminAuthController::class, 'me']);
        Route::post('/logout', [AdminAuthController::class, 'logout']);
    });
});

// ── Admin panel: KYC artifact stream (signed URL is the auth, so <img> works) ─
// Placed outside auth:admin: the short-lived signature — issued only by the
// capability-protected detail endpoint — authorizes the request.
Route::get('/admin/verifications/{document}/artifact/{kind}', [AdminVerificationController::class, 'artifact'])
    ->middleware('signed')
    ->name('admin.verifications.artifact');

// ── Admin panel: Categories management ─────────────────────────────────────
Route::middleware(['auth:admin', 'admin.can:categories.manage'])->prefix('admin')->group(function () {
    Route::get('/categories',                    [CategoryController::class, 'indexAll']);
    Route::post('/categories',                   [CategoryController::class, 'store']);
    Route::put('/categories/{category}',         [CategoryController::class, 'update']);
    Route::delete('/categories/{category}',      [CategoryController::class, 'destroy']);
    Route::patch('/categories/reorder',          [CategoryController::class, 'reorder']);
});

// ── Admin panel: Legal documents + consent settings ────────────────────────
// super_admin only (legal.manage). Publishing a version triggers user re-consent.
Route::middleware(['auth:admin', 'admin.can:legal.manage'])->prefix('admin')->group(function () {
    Route::get('/legal/documents',                 [AdminLegalController::class, 'index']);
    Route::get('/legal/documents/{id}',            [AdminLegalController::class, 'show']);
    Route::post('/legal/documents',                [AdminLegalController::class, 'store']);
    Route::patch('/legal/documents/{id}',          [AdminLegalController::class, 'update']);
    Route::post('/legal/documents/{id}/publish',   [AdminLegalController::class, 'publish']);
    Route::post('/legal/documents/{id}/archive',   [AdminLegalController::class, 'archive']);
    Route::delete('/legal/documents/{id}',         [AdminLegalController::class, 'destroy']);
    Route::get('/legal/data-requests',             [AdminLegalController::class, 'dataRequests']);
    Route::patch('/legal/data-requests/{id}',      [AdminLegalController::class, 'updateDataRequest']);
});

// ── Admin panel: Verification queue + audit log ────────────────────────────
Route::middleware('auth:admin')->prefix('admin')->group(function () {
    // Read — requires read:verification
    Route::middleware('admin.can:read:verification')->group(function () {
        Route::get('/verifications',        [AdminVerificationController::class, 'index']);
        Route::get('/verifications/{document}', [AdminVerificationController::class, 'show']);
    });

    // Decisions + claim — require write:verification
    Route::middleware('admin.can:write:verification')->group(function () {
        Route::post('/verifications/{document}/claim',        [AdminVerificationController::class, 'claim']);
        Route::post('/verifications/{document}/release',      [AdminVerificationController::class, 'release']);
        Route::post('/verifications/{document}/approve',      [AdminVerificationController::class, 'approve']);
        Route::post('/verifications/{document}/reject',       [AdminVerificationController::class, 'reject']);
        Route::post('/verifications/{document}/request-info', [AdminVerificationController::class, 'requestInfo']);
    });

    // Audit log — controller scopes non-read:audit admins to a single target
    Route::get('/audit-log', [AdminAuditLogController::class, 'index']);

    // Dashboard overview — read-only marketplace-health counts (any admin).
    Route::get('/dashboard', [AdminDashboardController::class, 'index']);

    // ── Users module ───────────────────────────────────────────────────────
    // Read (list + detail with MASKED pii) — requires read:users
    Route::middleware('admin.can:read:users')->group(function () {
        Route::get('/users',        [AdminUserController::class, 'index']);
        Route::get('/users/{user}', [AdminUserController::class, 'show']);
    });

    // Reveal raw contact / identity — requires users.view_pii (logs a PII-access entry)
    Route::middleware('admin.can:users.view_pii')->group(function () {
        Route::post('/users/{user}/reveal-pii', [AdminUserController::class, 'revealPii']);
    });

    // Moderation: warn / suspend / reinstate — requires users.moderate
    Route::middleware('admin.can:users.moderate')->group(function () {
        Route::post('/users/{user}/warn',      [AdminUserController::class, 'warn']);
        Route::post('/users/{user}/suspend',   [AdminUserController::class, 'suspend']);
        Route::post('/users/{user}/reinstate', [AdminUserController::class, 'reinstate']);
    });

    // Ban is permanent — requires ban:users (step-up)
    Route::middleware('admin.can:ban:users')->group(function () {
        Route::post('/users/{user}/ban', [AdminUserController::class, 'ban']);
    });

    // Tier adjustment — requires users.adjust_tier
    Route::middleware('admin.can:users.adjust_tier')->group(function () {
        Route::post('/users/{user}/adjust-tier', [AdminUserController::class, 'adjustTier']);
    });

    // Denylist add (hashed) — requires write:denylist (step-up)
    Route::middleware('admin.can:write:denylist')->group(function () {
        Route::post('/users/{user}/denylist', [AdminUserController::class, 'addToDenylist']);
    });

    // ── Services moderation module ───────────────────────────────────────────
    // Read (needs-review queue + full catalogue + detail) — requires read:services
    Route::middleware('admin.can:read:services')->group(function () {
        Route::get('/services',           [AdminServiceController::class, 'index']);
        Route::get('/services/{service}', [AdminServiceController::class, 'show']);
    });

    // Moderation actions — require services.moderate (audited, reason mandatory)
    Route::middleware('admin.can:services.moderate')->group(function () {
        Route::post('/services/{service}/hide',            [AdminServiceController::class, 'hide']);
        Route::post('/services/{service}/require-changes', [AdminServiceController::class, 'requireChanges']);
        Route::post('/services/{service}/restore',         [AdminServiceController::class, 'restore']);
        Route::post('/services/{service}/reassign-category', [AdminServiceController::class, 'reassignCategory']);
        Route::delete('/services/{service}/photos/{photo}', [AdminServiceController::class, 'removePhoto']);
    });

    // ── Reviews moderation module ────────────────────────────────────────────
    // Read (needs-review queue + browse + detail) — requires read:reviews
    Route::middleware('admin.can:read:reviews')->group(function () {
        Route::get('/reviews',          [AdminReviewController::class, 'index']);
        Route::get('/reviews/{review}', [AdminReviewController::class, 'show']);
    });

    // Moderation actions — require reviews.moderate (audited, reason mandatory).
    // Remove triggers the §7.1 rating recompute for the provider.
    Route::middleware('admin.can:reviews.moderate')->group(function () {
        Route::post('/reviews/{review}/remove',          [AdminReviewController::class, 'remove']);
        Route::post('/reviews/{review}/restore',         [AdminReviewController::class, 'restore']);
        Route::post('/reviews/{review}/remove-response', [AdminReviewController::class, 'removeResponse']);
        Route::post('/reviews/{review}/clear-flags',     [AdminReviewController::class, 'clearFlags']);
    });

    // ── Safety module (§11.3/§11.4) — highest sensitivity ────────────────────
    // Strictly gated on safety.handle (trust_safety + super_admin ONLY). Reads
    // are themselves logged in the service. {kind} = report | emergency.
    Route::middleware('admin.can:safety.handle')->group(function () {
        Route::get('/safety/queue',                 [AdminSafetyController::class, 'index']);
        Route::get('/safety/{kind}/{id}',           [AdminSafetyController::class, 'show']);
        Route::post('/safety/{kind}/{id}/reveal-pii',        [AdminSafetyController::class, 'revealPii']);
        Route::post('/safety/{kind}/{id}/claim',             [AdminSafetyController::class, 'claim']);
        Route::post('/safety/{kind}/{id}/note',              [AdminSafetyController::class, 'note']);
        Route::post('/safety/{kind}/{id}/restrict-contact',  [AdminSafetyController::class, 'restrictContact']);
        Route::post('/safety/{kind}/{id}/restrict-reported-user', [AdminSafetyController::class, 'restrictReportedUser']);
        Route::post('/safety/{kind}/{id}/escalate-authority',[AdminSafetyController::class, 'escalateAuthority']);
        Route::post('/safety/{kind}/{id}/escalate-super-admin', [AdminSafetyController::class, 'escalateSuperAdmin']);
        Route::post('/safety/{kind}/{id}/resolve',           [AdminSafetyController::class, 'resolve']);
    });

    // ── Finance & Commissions ──────────────────────────────────────────────
    // Ops/revenue-health view, not a payout tool. Bands + payout retry are
    // step-up gated (write:commissions / write:payouts).
    Route::middleware('admin.can:read:commissions')->group(function () {
        Route::get('/finance/overview',          [AdminFinanceController::class, 'overview']);
        Route::get('/finance/commissions',       [AdminFinanceController::class, 'commissions']);
        Route::get('/finance/commission-bands',  [AdminFinanceController::class, 'commissionBands']);
        Route::get('/finance/escrow',            [AdminFinanceController::class, 'escrow']);
    });
    Route::middleware('admin.can:write:commissions')->group(function () {
        Route::patch('/finance/commission-bands/{category}', [AdminFinanceController::class, 'updateCommissionBand']);
    });
    Route::middleware('admin.can:read:payouts')->group(function () {
        Route::get('/finance/payouts', [AdminFinanceController::class, 'payouts']);
    });
    Route::middleware('admin.can:write:payouts')->group(function () {
        Route::post('/finance/payouts/{bookingId}/retry', [AdminFinanceController::class, 'retryPayout']);
    });

    // ── Fraud & Denylist ─────────────────────────────────────────────────────
    Route::middleware('admin.can:read:fraud')->group(function () {
        Route::get('/fraud/patterns',    [AdminFraudController::class, 'patterns']);
        Route::get('/fraud/escalations', [AdminFraudController::class, 'escalations']);
        Route::get('/fraud/denylist',    [AdminFraudController::class, 'denylist']);
        Route::get('/fraud/denylist/export', [AdminFraudController::class, 'exportDenylist']);
    });
    Route::middleware('admin.can:write:fraud')->group(function () {
        Route::post('/fraud/patterns/claim',           [AdminFraudController::class, 'claimSignal']);
        Route::post('/fraud/patterns/false-positive',  [AdminFraudController::class, 'markFalsePositive']);
        Route::post('/fraud/patterns/escalate',        [AdminFraudController::class, 'escalateSignal']);
    });
    Route::middleware('admin.can:write:denylist')->group(function () {
        Route::post('/fraud/denylist',                    [AdminFraudController::class, 'addToDenylist']);
        Route::post('/fraud/denylist/{denylist}/lift',    [AdminFraudController::class, 'liftFromDenylist']);
    });

    // ── Growth & Promotions ──────────────────────────────────────────────────
    Route::middleware('admin.can:read:promotions')->group(function () {
        Route::get('/promotions/overview',           [AdminPromotionsController::class, 'overview']);
        Route::get('/promotions/campaigns',          [AdminPromotionsController::class, 'index']);
        Route::get('/promotions/campaigns/{id}',     [AdminPromotionsController::class, 'show']);
        Route::get('/promotions/campaigns/{id}/performance', [AdminPromotionsController::class, 'performance']);
        Route::post('/promotions/audience-estimate', [AdminPromotionsController::class, 'audienceEstimate']);
        Route::get('/promotions/referral-config',    [AdminPromotionsController::class, 'referralConfig']);
    });
    Route::middleware('admin.can:write:promotions')->group(function () {
        Route::post('/promotions/campaigns',              [AdminPromotionsController::class, 'store']);
        Route::patch('/promotions/campaigns/{id}',        [AdminPromotionsController::class, 'update']);
        Route::post('/promotions/campaigns/{id}/launch',  [AdminPromotionsController::class, 'launch']);
        Route::post('/promotions/campaigns/{id}/pause',   [AdminPromotionsController::class, 'pause']);
        Route::post('/promotions/campaigns/{id}/end',     [AdminPromotionsController::class, 'end']);
        Route::put('/promotions/referral-config',         [AdminPromotionsController::class, 'updateReferralConfig']);
    });

    // ── WhatsApp & Conversation Ops ──────────────────────────────────────────
    Route::middleware('admin.can:platform.ops')->group(function () {
        Route::get('/whatsapp/overview',      [AdminWhatsAppController::class, 'overview']);
        Route::get('/whatsapp/templates',     [AdminWhatsAppController::class, 'templates']);
        Route::get('/whatsapp/conversations', [AdminWhatsAppController::class, 'conversations']);
        Route::post('/whatsapp/conversations/{conversationId}/nudge',          [AdminWhatsAppController::class, 'nudge']);
        Route::post('/whatsapp/conversations/{conversationId}/mark-abandoned', [AdminWhatsAppController::class, 'markAbandoned']);
        Route::get('/whatsapp/logs', [AdminWhatsAppController::class, 'logs']);
    });

    // ── Dispatch & Trust Insights ────────────────────────────────────────────
    Route::middleware('admin.can:read:insights')->group(function () {
        Route::get('/insights/dispatch', [AdminInsightsController::class, 'dispatch']);
        Route::get('/insights/trust',    [AdminInsightsController::class, 'trust']);
        Route::get('/insights/supply',   [AdminInsightsController::class, 'supply']);
        Route::get('/insights/ranking-categories', [AdminInsightsController::class, 'rankingCategories']);
        Route::get('/insights/ranking',            [AdminInsightsController::class, 'ranking']);
    });

    // ── Platform Settings — super_admin only ─────────────────────────────────
    Route::middleware('admin.can:read:settings')->group(function () {
        Route::get('/settings/groups/{group}',   [AdminSettingsController::class, 'group']);
        Route::get('/settings/risk-tiers',       [AdminSettingsController::class, 'riskTiers']);
        Route::get('/settings/denylist-config',  [AdminSettingsController::class, 'denylistCheckConfig']);
    });
    Route::middleware('admin.can:write:settings')->group(function () {
        Route::patch('/settings/{key}',                  [AdminSettingsController::class, 'update']);
        Route::patch('/settings/risk-tiers/{riskTier}',   [AdminSettingsController::class, 'updateRiskTier']);
    });

    // ── Bookings — read-only view of escrow/payment/dispute state ───────────
    Route::middleware('admin.can:read:bookings')->group(function () {
        Route::get('/bookings',      [AdminBookingController::class, 'index']);
        Route::get('/bookings/{booking}', [AdminBookingController::class, 'show']);
    });
});

// ── WhatsApp Webhook (public — Meta Cloud API callbacks) ──────────────────
Route::get('/webhook',  [WhatsAppWebhookController::class, 'verify']);
Route::post('/webhook', [WhatsAppWebhookController::class, 'receive'])->middleware('throttle:webhook');

// ── PawaPay Payment Callbacks (public — PawaPay sends deposit/payout/refund status) ──
Route::post('/pawapay/callback', [PawapayCallbackController::class, 'handle'])->middleware('throttle:webhook');

// ── Africa's Talking voice callback (public — masked-call bridge + metadata) ──
// Acts only on session refs we minted; moves no money, exposes no real number.
Route::post('/webhooks/africastalking/voice', [CommunicationController::class, 'voiceWebhook'])->middleware('throttle:webhook');

// ── Signed Booking Agreement download (WhatsApp/Meta media fetch — no auth) ──
// Short-lived signed URL; the 'signed' middleware rejects tampered/expired links.
Route::get('/agreements/{agreement}/download', [BookingAgreementController::class, 'signedDownload'])
    ->name('agreements.download')->middleware('signed');

// ── Search & Discovery (public, Phase 3) ───────────────────────────────────
Route::get('/search',         SearchController::class)->middleware('throttle:search');
Route::get('/search/suggest', SearchSuggestController::class)->middleware('throttle:search');
// Natural-language matcher — primary customer entry point (app home + WhatsApp).
// Finds WHAT (real catalog); SearchService ranks WHO. Type-ahead uses /suggest
// (cheap layers, no LLM); the full pipeline runs here on submit.
Route::post('/match',              \App\Http\Controllers\Api\MatchController::class)->middleware('throttle:match');
Route::post('/match/{log}/outcome', [\App\Http\Controllers\Api\MatchController::class, 'outcome'])->middleware('throttle:search');
Route::get('/home-banners',   [HomeBannerController::class, 'index']);
// Growth & Promotions home-banner slot (auth-aware: resolves the caller's
// audience when a token is present, audience-agnostic campaigns otherwise).
Route::get('/placements/home', [\App\Http\Controllers\Api\PlacementController::class, 'home']);

// ── Ranking instrumentation events (v3.2 §7 — public, fire-and-forget) ─────
Route::post('/events/result-clicked',  [\App\Http\Controllers\Api\SearchEventController::class, 'resultClicked'])->middleware('throttle:search');
Route::post('/events/booking-started', [\App\Http\Controllers\Api\SearchEventController::class, 'bookingStarted'])->middleware('throttle:search');

// ── Landing page summary (public marketing aggregates + featured reviews) ──
Route::get('/landing', [LandingController::class, 'summary']);

// ── Legal documents (public, read-anytime — versioned content source) ──────
// Terms of Service, Privacy Policy, User Agreement. Same source feeds the
// consent gate, the in-app Legal screens and the PWA/website (parity).
Route::get('/legal/documents',        [LegalController::class, 'index']);
Route::get('/legal/documents/{type}', [LegalController::class, 'show']);

// ── Categories (public read) ────────────────────────────────────────────────
Route::get('/categories',         [CategoryController::class, 'index']);
Route::get('/categories/popular', [CategoryController::class, 'popular']);
// User-facing pricing-model labels/descriptions (the ONE source the editors read).
Route::get('/pricing-models',     [CategoryController::class, 'pricingModels']);

// ── Services (public browse + detail) ──────────────────────────────────────
Route::get('/services',           [ServiceController::class, 'index']);
Route::get('/services/{service}', [ServiceController::class, 'show']);
Route::get('/services/{service}/booked-slots', [ServiceController::class, 'bookedSlots']);

// ── Public provider profiles ────────────────────────────────────────────────
Route::get('/providers/{userId}', [PublicProviderController::class, 'show']);
// Provider-wide reviews (§7.1) — paginated, server-sorted, all from COMPLETED bookings.
Route::get('/providers/{userId}/reviews', [PublicProviderController::class, 'reviews']);

// ── Location geocoding (public — no user data, safe pre-auth) ──────────────
Route::prefix('location')->group(function () {
    Route::get('/search',   [LocationController::class, 'search']);
    Route::post('/reverse', [LocationController::class, 'reverse']);
});

// ── Protected routes ────────────────────────────────────────────────────────
// account.active enforces ban/suspend in real time: rejects tokens issued
// before the account's session_invalidated_at watermark, or issued to an
// account that is currently BANNED/SUSPENDED — see EnsureAccountActive.
Route::middleware(['auth:api', 'account.active'])->group(function () {

    // ── Bookings (buyer + provider) ────────────────────────────────────────
    Route::get('/bookings',               [BookingController::class, 'index']);
    Route::post('/bookings',              [BookingController::class, 'store'])->middleware('throttle:write');
    Route::get('/bookings/{id}',          [BookingController::class, 'show']);
    // Growth & Promotions: server-computed checkout price breakdown (original →
    // discount → total) for the current user + booking (+ optional ?code=).
    Route::get('/bookings/{id}/checkout-preview', [BookingController::class, 'checkoutPreview']);
    // Quote-first brief (PROVIDER_SCOPE / QUOTE_DEPOSIT): customer attaches
    // photos/a short video for pricing context, buyer-only, brief must be open.
    Route::post('/bookings/{id}/scope-attachments', [BookingController::class, 'addScopeAttachments']);
    // Authorized read of a private scope attachment — booking parties only (§ SEC-4).
    Route::get('/bookings/{id}/scope-attachments/{index}', [BookingController::class, 'scopeAttachment'])
        ->whereNumber('index');

    // Shared transitions (both modes)
    Route::post('/bookings/{id}/start',    [BookingController::class, 'start']);
    Route::post('/bookings/{id}/deliver',  [BookingController::class, 'deliver']);
    Route::post('/bookings/{id}/complete', [BookingController::class, 'complete']);

    // HOURLY_CAPPED observed timer — provider start/finish is via start/deliver;
    // these cover pause/resume and the customer-approved cap extension.
    Route::post('/bookings/{id}/pause',                 [BookingController::class, 'pauseTimer']);
    Route::post('/bookings/{id}/resume',                [BookingController::class, 'resumeTimer']);
    Route::post('/bookings/{id}/request-cap-extension', [BookingController::class, 'requestCapExtension']);
    Route::post('/bookings/{id}/approve-cap-extension', [BookingController::class, 'approveCapExtension']);
    Route::post('/bookings/{id}/dispute',  [BookingController::class, 'dispute']);
    Route::post('/bookings/{id}/cancel',   [BookingController::class, 'cancel']);
    Route::post('/bookings/{id}/review',   [BookingController::class, 'review']);

    // ── Communication layer — masked calling + structured status updates ──
    // NO chat / VoIP: free-form conversation deep-links to WhatsApp on clients.
    // Both endpoints are gated server-side to funded, active bookings.
    Route::post('/bookings/{id}/status-update', [CommunicationController::class, 'statusUpdate'])->middleware('throttle:write');
    Route::post('/bookings/{id}/call',          [CommunicationController::class, 'call'])->middleware('throttle:write');
    Route::get('/bookings/{id}/comms/timeline', [CommunicationController::class, 'timeline']);

    // ── Booking Agreement document (both parties, versioned, immutable) ────
    Route::get('/bookings/{id}/agreements',          [BookingAgreementController::class, 'index']);
    Route::get('/bookings/{id}/agreement/link',      [BookingAgreementController::class, 'link']);
    Route::get('/bookings/{id}/agreement',           [BookingAgreementController::class, 'latest']);
    Route::get('/bookings/{id}/agreement/{version}', [BookingAgreementController::class, 'version'])->whereNumber('version');

    // ESCROW-only transitions
    Route::post('/bookings/{id}/pay',           [BookingController::class, 'pay']);
    Route::post('/bookings/{id}/instant-payout', [BookingController::class, 'instantPayout']);

    // Outcome-based pricing — scoped-quote approval (PROVIDER_SCOPE / QUOTE_DEPOSIT).
    // Escrow only ever holds AFTER the customer approves the scoped quote.
    Route::post('/bookings/{id}/approve-quote', [BookingController::class, 'approveQuote']);
    Route::post('/bookings/{id}/decline-quote', [BookingController::class, 'declineQuote']);

    // DIRECT-only transitions
    Route::post('/bookings/{id}/accept',       [BookingController::class, 'accept']);
    Route::post('/bookings/{id}/quote',        [BookingController::class, 'quote']);
    Route::post('/bookings/{id}/accept-quote', [BookingController::class, 'acceptQuote']);
    Route::post('/bookings/{id}/decline',      [BookingController::class, 'decline']);
    Route::post('/bookings/{id}/mark-paid',    [BookingController::class, 'markPaid']);

    // ── Disputes ───────────────────────────────────────────────────────────
    Route::post('/disputes/{id}/withdraw',  [DisputeController::class, 'withdraw']);
    Route::post('/disputes/{id}/evidence',  [DisputeController::class, 'uploadEvidence']);

    // ── Safety reports ─────────────────────────────────────────────────────
    Route::post('/safety-reports', [SafetyReportController::class, 'store']);

    // ── Post-a-request (v3.2 §6 — buyer side) ──────────────────────────────
    Route::prefix('service-requests')->group(function () {
        Route::post('/',             [\App\Http\Controllers\Api\ServiceRequestController::class, 'store']);
        Route::get('/',              [\App\Http\Controllers\Api\ServiceRequestController::class, 'index']);
        Route::get('/{id}',          [\App\Http\Controllers\Api\ServiceRequestController::class, 'show']);
        Route::post('/{id}/cancel',  [\App\Http\Controllers\Api\ServiceRequestController::class, 'cancel']);
        Route::post('/{id}/select',  [\App\Http\Controllers\Api\ServiceRequestController::class, 'select']);
    });

    // ── Notifications ─────────────────────────────────────────────────────
    Route::prefix('notifications')->group(function () {
        Route::get('/',                [NotificationController::class, 'index']);
        Route::get('/unread-count',    [NotificationController::class, 'unreadCount']);
        Route::patch('/{id}/read',     [NotificationController::class, 'markRead']);
        Route::post('/mark-all-read',  [NotificationController::class, 'markAllRead']);
        Route::get('/settings',        [NotificationController::class, 'getSettings']);
        Route::put('/settings',        [NotificationController::class, 'updateSettings']);
        Route::post('/{id}/ack',       [NotificationController::class, 'ack']);
        Route::get('/server-time',     [NotificationController::class, 'serverTime']);
        Route::post('/device-token',   [NotificationController::class, 'registerToken']);
        Route::delete('/device-token', [NotificationController::class, 'unregisterToken']);
    });

    // ── Account self-service ───────────────────────────────────────────────
    Route::patch('/me/account', [AuthController::class, 'updateAccount']);
    Route::post('/me/avatar',   [AuthController::class, 'uploadAvatar']);

    // ── Consent + data-subject rights (Data Protection Act No. 3 of 2021) ──
    // The gate calls status → store; withdrawal + rights capture live here too.
    Route::get('/me/consent',            [ConsentController::class, 'status']);
    Route::post('/me/consent',           [ConsentController::class, 'store']);
    Route::post('/me/consent/decline',   [ConsentController::class, 'decline']);
    Route::post('/me/consent/withdraw',  [ConsentController::class, 'withdraw']);
    Route::get('/me/consent/history',    [ConsentController::class, 'history']);
    Route::get('/me/data-requests',      [ConsentController::class, 'dataRequests']);
    Route::post('/me/data-requests',     [ConsentController::class, 'storeDataRequest']);

    // ── Location & address book (v3.1 §4) ──────────────────────────────────
    Route::prefix('me')->group(function () {
        Route::get('/location',                     [LocationController::class, 'showPrimary']);
        Route::put('/location',                     [LocationController::class, 'setPrimary']);
        Route::get('/saved-locations',               [LocationController::class, 'indexSaved']);
        Route::post('/saved-locations',              [LocationController::class, 'storeSaved']);
        Route::put('/saved-locations/{id}',          [LocationController::class, 'updateSaved']);
        Route::delete('/saved-locations/{id}',       [LocationController::class, 'destroySaved']);
        Route::get('/providers',                     [BookingController::class, 'myProviders']);
        // v3.2 §2.3 — Home "Book again" card (most recent COMPLETED booking)
        Route::get('/book-again',                    [BookingController::class, 'bookAgain']);
    });

    // ── KYC (any authenticated user acting as provider) ────────────────────
    Route::prefix('kyc')->group(function () {
        Route::get('/',          [KycController::class, 'status']);
        Route::post('/tier1',    [KycController::class, 'submitTier1']);
        Route::post('/document', [KycController::class, 'submitDocument']);
        Route::post('/address',  [KycController::class, 'submitAddress']);
    });

    // ── Provider profile (PROVIDER only) ──────────────────────────────────
    Route::middleware('role:PROVIDER')->prefix('provider')->group(function () {
        // Progressive onboarding (resumable). state + per-step submit.
        Route::get('/onboarding',          [\App\Http\Controllers\Api\ProviderOnboardingController::class, 'show']);
        Route::post('/onboarding/about',    [\App\Http\Controllers\Api\ProviderOnboardingController::class, 'about']);
        Route::post('/onboarding/avatar',   [\App\Http\Controllers\Api\ProviderOnboardingController::class, 'avatar']);
        Route::post('/onboarding/offer',    [\App\Http\Controllers\Api\ProviderOnboardingController::class, 'offer']);
        Route::post('/onboarding/identity', [\App\Http\Controllers\Api\ProviderOnboardingController::class, 'identity']);
        Route::post('/onboarding/service',  [\App\Http\Controllers\Api\ProviderOnboardingController::class, 'service']);
        Route::post('/onboarding/payout',   [\App\Http\Controllers\Api\ProviderOnboardingController::class, 'payout']);
        Route::post('/onboarding/go-live',  [\App\Http\Controllers\Api\ProviderOnboardingController::class, 'goLive']);

        // Tier-upgrade / clearance flow (submissions feed the admin queue; the
        // eligibility flip is on admin approval).
        Route::get('/verification',                  [\App\Http\Controllers\Api\ProviderVerificationController::class, 'show']);
        Route::post('/verification/police-clearance', [\App\Http\Controllers\Api\ProviderVerificationController::class, 'policeClearance']);
        Route::post('/verification/portfolio',        [\App\Http\Controllers\Api\ProviderVerificationController::class, 'portfolio']);

        // Weekly availability + time off — feeds the WhatsApp/PWA date-pickers
        // and dispatch eligibility (provider_availability table).
        Route::get('/availability',                  [\App\Http\Controllers\Api\ProviderAvailabilityController::class, 'show']);
        Route::put('/availability',                  [\App\Http\Controllers\Api\ProviderAvailabilityController::class, 'update']);
        Route::post('/availability/blocks',          [\App\Http\Controllers\Api\ProviderAvailabilityController::class, 'block']);
        Route::delete('/availability/blocks/{date}', [\App\Http\Controllers\Api\ProviderAvailabilityController::class, 'unblock']);

        Route::get('/profile',         [ProviderProfileController::class, 'show']);
        Route::put('/profile',         [ProviderProfileController::class, 'upsert']);
        Route::post('/profile/kyc',    [ProviderProfileController::class, 'uploadKyc']);
        Route::patch('/profile/availability-status', [ProviderProfileController::class, 'updateAvailabilityStatus']);
        Route::post('/profile/cover-photo',  [ProviderProfileController::class, 'uploadCoverPhoto']);
        Route::post('/profile/portfolio',   [ProviderProfileController::class, 'uploadPortfolioImage']);
        Route::delete('/profile/portfolio', [ProviderProfileController::class, 'deletePortfolioImage']);

        // §6.5 — provider Hub aggregate (tier, §9.1 checklist, earnings, payout countdown)
        Route::get('/dashboard',       [ProviderProfileController::class, 'dashboard']);
        // §6.5/§9.3 — Earnings tab aggregate (totals, payout countdown, recent commissions)
        Route::get('/earnings',        [ProviderProfileController::class, 'earnings']);
        // §6.8 — incoming requests (New / Scheduled, trust hints, commission preview)
        Route::get('/requests',        [BookingController::class, 'incomingRequests']);
        // v3.2 §6 — post-a-request feed + responses (provider side)
        Route::get('/service-requests',               [\App\Http\Controllers\Api\ServiceRequestController::class, 'providerFeed']);
        Route::post('/service-requests/{id}/respond', [\App\Http\Controllers\Api\ServiceRequestController::class, 'respond']);

        Route::get('/services',        [ServiceController::class, 'mine']);
        Route::get('/services/commission-preview', [ServiceController::class, 'commissionPreview']);
        Route::post('/services',       [ServiceController::class, 'store']);
        Route::put('/services/{service}',    [ServiceController::class, 'update']);
        Route::delete('/services/{service}', [ServiceController::class, 'destroy']);
        Route::post('/services/{service}/photos',          [ServiceController::class, 'uploadPhoto']);
        Route::put('/services/{service}/photos/order',      [ServiceController::class, 'reorderPhotos']);
        Route::delete('/services/{service}/photos/{photo}', [ServiceController::class, 'deletePhoto']);
    });

    // ── Admin + Moderator surfaces ─────────────────────────────────────────
    Route::middleware('role:ADMIN,MODERATOR')->prefix('admin')->group(function () {
        Route::get('/disputes',                       [DisputeController::class, 'index']);
        Route::get('/disputes/{id}',                  [DisputeController::class, 'show']);
        Route::post('/disputes/{id}/resolve',          [DisputeController::class, 'resolve']);
        Route::get('/safety-reports',                 [SafetyReportController::class, 'index']);
        Route::post('/safety-reports/{id}/review',    [SafetyReportController::class, 'review']);
        Route::get('/insurance-reserve',              [DisputeController::class, 'reserveSummary']);
    });
});
