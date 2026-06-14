<?php

use App\Http\Controllers\Api\Admin\AdminAuthController;
use App\Http\Controllers\Api\Admin\AdminAuditLogController;
use App\Http\Controllers\Api\Admin\AdminVerificationController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\BookingController;
use App\Http\Controllers\Api\CategoryController;
use App\Http\Controllers\Api\DisputeController;
use App\Http\Controllers\Api\HomeBannerController;
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
    Route::post('/register',   [AuthController::class, 'register']);
    Route::post('/verify-otp', [AuthController::class, 'verifyOtp']);
    Route::post('/login',      [AuthController::class, 'login']);
    Route::post('/refresh',    [AuthController::class, 'refresh']);
    Route::post('/resend-otp', [AuthController::class, 'resendOtp']);

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
});

// ── Search & Discovery (public, Phase 3) ───────────────────────────────────
Route::get('/search',         SearchController::class);
Route::get('/search/suggest', SearchSuggestController::class);
Route::get('/home-banners',   [HomeBannerController::class, 'index']);

// ── Ranking instrumentation events (v3.2 §7 — public, fire-and-forget) ─────
Route::post('/events/result-clicked',  [\App\Http\Controllers\Api\SearchEventController::class, 'resultClicked']);
Route::post('/events/booking-started', [\App\Http\Controllers\Api\SearchEventController::class, 'bookingStarted']);

// ── Categories (public read) ────────────────────────────────────────────────
Route::get('/categories', [CategoryController::class, 'index']);

// ── Services (public browse + detail) ──────────────────────────────────────
Route::get('/services',           [ServiceController::class, 'index']);
Route::get('/services/{service}', [ServiceController::class, 'show']);

// ── Public provider profiles ────────────────────────────────────────────────
Route::get('/providers/{userId}', [PublicProviderController::class, 'show']);

// ── Location geocoding (public — no user data, safe pre-auth) ──────────────
Route::prefix('location')->group(function () {
    Route::get('/search',   [LocationController::class, 'search']);
    Route::post('/reverse', [LocationController::class, 'reverse']);
});

// ── Protected routes ────────────────────────────────────────────────────────
Route::middleware('auth:api')->group(function () {

    // ── Bookings (buyer + provider) ────────────────────────────────────────
    Route::get('/bookings',               [BookingController::class, 'index']);
    Route::post('/bookings',              [BookingController::class, 'store']);
    Route::get('/bookings/{id}',          [BookingController::class, 'show']);

    // Shared transitions (both modes)
    Route::post('/bookings/{id}/start',    [BookingController::class, 'start']);
    Route::post('/bookings/{id}/deliver',  [BookingController::class, 'deliver']);
    Route::post('/bookings/{id}/complete', [BookingController::class, 'complete']);
    Route::post('/bookings/{id}/dispute',  [BookingController::class, 'dispute']);
    Route::post('/bookings/{id}/cancel',   [BookingController::class, 'cancel']);
    Route::post('/bookings/{id}/review',   [BookingController::class, 'review']);

    // ESCROW-only transitions
    Route::post('/bookings/{id}/pay',           [BookingController::class, 'pay']);
    Route::post('/bookings/{id}/instant-payout', [BookingController::class, 'instantPayout']);

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

    // ── Account self-service ───────────────────────────────────────────────
    Route::patch('/me/account', [AuthController::class, 'updateAccount']);

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
        Route::delete('/services/{service}/photos/{photo}', [ServiceController::class, 'deletePhoto']);
    });

    // ── Admin (ADMIN only) ─────────────────────────────────────────────────
    Route::middleware('role:ADMIN')->prefix('admin')->group(function () {
        Route::get('/categories',             [CategoryController::class, 'indexAll']);
        Route::post('/categories',            [CategoryController::class, 'store']);
        Route::put('/categories/{category}',  [CategoryController::class, 'update']);
        Route::delete('/categories/{category}', [CategoryController::class, 'destroy']);
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
