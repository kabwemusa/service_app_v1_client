<?php

namespace App\Services;

use App\Contracts\SmsGateway;
use App\Enums\ErrorCode;
use App\Exceptions\Api\ApiException;
use App\Exceptions\Api\EmailNotVerifiedException;
use App\Exceptions\Api\InvalidCredentialsException;
use App\Exceptions\Api\OtpException;
use App\Models\ProviderProfile;
use App\Models\User;
use App\Support\PhoneNumber;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Str;
use Tymon\JWTAuth\Facades\JWTAuth;

class AuthService
{
    private const OTP_KEY_PREFIX     = 'otp:';
    private const REFRESH_KEY_PREFIX = 'refresh:';
    private const USER_REFRESH_SET_PREFIX = 'refresh_tokens_by_user:';
    private const OTP_RATE_PREFIX    = 'otp_rate:';
    private const OTP_COOLDOWN_PREFIX = 'otp_cd:';
    private const OTP_ATTEMPT_PREFIX = 'otp_attempts:';

    // OTP throttling — tunable via config/auth.php (§ CFG-4). The literals here
    // are only the fallback defaults if the config key is absent.
    private function resendCooldownSeconds(): int { return (int) config('auth.otp.resend_cooldown_seconds', 60); }
    private function maxSendsPerWindow(): int     { return (int) config('auth.otp.max_sends_per_window', 5); }
    private function rateWindowSeconds(): int      { return (int) config('auth.otp.rate_window_seconds', 3600); }
    /** Max wrong OTP guesses for one issued code before it is burned (brute-force cap). */
    private function maxOtpAttempts(): int         { return (int) config('auth.otp.max_attempts', 5); }

    public function __construct(private readonly SmsGateway $sms) {}

    public function register(array $data): User
    {
        $referrerId = null;
        if (!empty($data['referral_code'])) {
            $referrerId = User::where('referral_code', $data['referral_code'])->value('id');
        }

        $user = User::create([
            'email'         => isset($data['email']) ? strtolower($data['email']) : null,
            'phone'         => $data['phone'] ?? null,
            'password_hash' => Hash::make($data['password']),
            'role'          => $data['role'] ?? 'CUSTOMER',
            'account_state' => 'ACTIVE',
            'is_verified'   => false,
            'referred_by'   => $referrerId,
        ]);

        if (($data['role'] ?? 'CUSTOMER') === 'PROVIDER') {
            ProviderProfile::create(['user_id' => $user->id]);
        }

        $this->sendOtp($user);

        return $user;
    }

    // ── Phone-OTP (canonical, passwordless) ──────────────────────────────────

    /**
     * Request an OTP for a phone number. Phone is the single account key, so this
     * find-or-creates the account (identity rule), enforces a resend cooldown +
     * rolling rate limit, and dispatches the code over SMS.
     *
     * @param  string  $intent  'CUSTOMER' | 'PROVIDER' — only used on first sight.
     * @return array{phone: string, resend_after: int, is_new: bool}
     */
    public function requestPhoneOtp(string $rawPhone, string $intent = 'CUSTOMER'): array
    {
        $phone = PhoneNumber::normalize($rawPhone);
        if ($phone === null) {
            throw new ApiException(ErrorCode::VALIDATION_ERROR, 'Enter a valid Zambian mobile number.');
        }

        $this->guardOtpRate($phone);

        // Strict E.164 match (§ SEC-8) — no trailing-digits LIKE.
        $existed = User::where('phone', $phone)->exists();

        $user = User::findOrCreateByPhone($phone, $intent);

        $this->sendPhoneOtp($user->phone);

        return [
            'phone'        => $user->phone,
            'resend_after' => $this->resendCooldownSeconds(),
            'is_new'       => ! $existed,
        ];
    }

    /**
     * Verify a phone OTP and issue a token pair. Marks the phone verified and,
     * if an anonymous guest token is supplied, merges the in-progress context
     * (booking draft / saved items) onto the now-identified account.
     *
     * @return array{access_token: string, refresh_token: string, user: User}
     */
    public function verifyPhoneOtp(string $rawPhone, string $otp, ?string $guestToken = null): array
    {
        $phone = PhoneNumber::normalize($rawPhone);
        if ($phone === null) {
            throw new ApiException(ErrorCode::VALIDATION_ERROR, 'Enter a valid Zambian mobile number.');
        }

        $key       = self::OTP_KEY_PREFIX . $phone;
        $storedOtp = Redis::get($key);

        if ($storedOtp === null) {
            throw OtpException::expired();
        }

        $this->guardOtpAttempts($phone, $key);

        if (! hash_equals((string) $storedOtp, $otp)) {
            throw OtpException::invalid();
        }

        // Correct code — clear the attempt counter for this number.
        Redis::del(self::OTP_ATTEMPT_PREFIX . $phone);

        $user = User::where('phone', $phone)->firstOrFail();

        $user->update([
            'phone_verified_at' => $user->phone_verified_at ?? now(),
            'is_verified'       => true,
            'last_active_at'    => now(),
        ]);

        Redis::del($key);
        Redis::del(self::OTP_COOLDOWN_PREFIX . $phone);

        if ($guestToken) {
            $this->mergeAnonymousContext($user, $guestToken);
        }

        return $this->issueTokenPair($user);
    }

    /**
     * Carry an anonymous session's in-progress context onto the identified user.
     *
     * The primary "context survives sign-in" mechanism is client-side: the PWA
     * holds the tapped booking draft and replays it after verify. This hook is
     * the server-side extension point for any guest-held state (e.g. saved
     * items) keyed by $guestToken; today it is a no-op placeholder so the
     * verify endpoint already accepts the token and the contract is stable.
     */
    private function mergeAnonymousContext(User $user, string $guestToken): void
    {
        // Intentionally minimal — see docblock. Future: move guest saved_locations
        // / draft service_requests keyed by $guestToken onto $user->id.
    }

    public function verifyOtp(User $user, string $otp): array
    {
        $key       = self::OTP_KEY_PREFIX . $user->id;
        $storedOtp = Redis::get($key);

        if ($storedOtp === null) {
            throw OtpException::expired();
        }

        $this->guardOtpAttempts((string) $user->id, $key);

        if (! hash_equals((string) $storedOtp, $otp)) {
            throw OtpException::invalid();
        }

        Redis::del(self::OTP_ATTEMPT_PREFIX . $user->id);

        $now = now();
        $update = ['is_verified' => true];

        if ($user->email && !$user->email_verified_at) {
            $update['email_verified_at'] = $now;
        }
        if ($user->phone && !$user->phone_verified_at) {
            $update['phone_verified_at'] = $now;
        }

        $user->update($update);
        Redis::del($key);

        return $this->issueTokenPair($user);
    }

    public function login(string $identifier, string $password): array
    {
        // Identifier can be email or phone
        $user = filter_var($identifier, FILTER_VALIDATE_EMAIL)
            ? User::where('email', strtolower($identifier))->first()
            : User::where('phone', $identifier)->first();

        if (!$user || !Hash::check($password, $user->password_hash)) {
            throw new InvalidCredentialsException();
        }

        if (!$user->is_verified) {
            $this->sendOtp($user);
            throw new EmailNotVerifiedException($user->id);
        }

        $user->update(['last_active_at' => now()]);

        return $this->issueTokenPair($user);
    }

    public function refreshTokens(string $refreshToken): array
    {
        $userId = Redis::get(self::REFRESH_KEY_PREFIX . $refreshToken);

        if (!$userId) {
            throw new \App\Exceptions\Api\ApiException(
                \App\Enums\ErrorCode::UNAUTHENTICATED,
                'The refresh token is invalid or has expired.',
            );
        }

        // Rotate: delete old, issue new
        Redis::del(self::REFRESH_KEY_PREFIX . $refreshToken);

        $user = User::findOrFail($userId);

        return $this->issueTokenPair($user);
    }

    public function logout(string $refreshToken): void
    {
        JWTAuth::invalidate(JWTAuth::getToken());
        $userId = Redis::get(self::REFRESH_KEY_PREFIX . $refreshToken);
        Redis::del(self::REFRESH_KEY_PREFIX . $refreshToken);
        if ($userId) {
            Redis::srem(self::USER_REFRESH_SET_PREFIX . $userId, $refreshToken);
        }
    }

    public function resendOtp(User $user): void
    {
        // Same per-identifier cooldown as the phone-OTP path, so the legacy
        // resend endpoint can't be used to pump SMS/email at a target.
        $cooldownKey = self::OTP_COOLDOWN_PREFIX . $user->id;
        if (Redis::exists($cooldownKey)) {
            $ttl = (int) Redis::ttl($cooldownKey);
            throw new ApiException(
                ErrorCode::RATE_LIMITED,
                "Please wait {$ttl}s before requesting another code.",
            );
        }
        Redis::setex($cooldownKey, $this->resendCooldownSeconds(), '1');

        $this->sendOtp($user);
    }

    /**
     * Cut every active session for a user immediately (ban/suspend). All
     * refresh tokens are deleted so they can no longer be redeemed, and the
     * revocation watermark is set so any still-live JWT access token is
     * rejected by EnsureAccountActive on its very next request — regardless
     * of the token's remaining TTL.
     */
    public function invalidateAllSessions(string $userId): void
    {
        $setKey = self::USER_REFRESH_SET_PREFIX . $userId;
        $tokens = Redis::smembers($setKey);
        foreach ($tokens as $token) {
            Redis::del(self::REFRESH_KEY_PREFIX . $token);
        }
        Redis::del($setKey);

        User::where('id', $userId)->update(['session_invalidated_at' => now()]);
    }

    // ── Private helpers ──────────────────────────────────────────────────────

    private function issueTokenPair(User $user): array
    {
        // SEC-15: don't mint tokens for a restricted account. A ban is rejected
        // outright; a timed suspension auto-lifts once it has expired (ADM-2),
        // otherwise it is rejected. This stops a banned user obtaining a fresh
        // token at login instead of relying on EnsureAccountActive to block it
        // on the next request (and stops the SMS/token spend).
        $this->assertLoginAllowed($user);

        $accessToken  = JWTAuth::fromUser($user);
        $refreshToken = $this->storeRefreshToken($user->id);

        return [
            'access_token'  => $accessToken,
            'refresh_token' => $refreshToken,
            'user'          => $user,
        ];
    }

    private function assertLoginAllowed(User $user): void
    {
        if ($user->account_state === 'BANNED') {
            throw new ApiException(
                ErrorCode::ACCOUNT_RESTRICTED,
                'Your account is no longer active. Please contact support.',
            );
        }

        if ($user->account_state === 'SUSPENDED') {
            if ($user->suspended_until !== null && $user->suspended_until->isPast()) {
                $user->forceFill(['account_state' => 'ACTIVE', 'suspended_until' => null])->save();
            } else {
                throw new ApiException(
                    ErrorCode::ACCOUNT_RESTRICTED,
                    'Your account is temporarily suspended. Please contact support.',
                );
            }
        }
    }

    private function storeRefreshToken(string $userId): string
    {
        $token  = Str::random(64);
        $expiry = (int) config('jwt.refresh_ttl', 10080);

        Redis::setex(self::REFRESH_KEY_PREFIX . $token, $expiry * 60, $userId);
        Redis::sadd(self::USER_REFRESH_SET_PREFIX . $userId, $token);
        Redis::expire(self::USER_REFRESH_SET_PREFIX . $userId, $expiry * 60);

        return $token;
    }

    /**
     * Enforce the resend cooldown and rolling rate limit for a number.
     * Throws RATE_LIMITED (429) when either is exceeded.
     */
    private function guardOtpRate(string $phone): void
    {
        $cooldownKey = self::OTP_COOLDOWN_PREFIX . $phone;
        if (Redis::exists($cooldownKey)) {
            $ttl = (int) Redis::ttl($cooldownKey);
            throw new ApiException(
                ErrorCode::RATE_LIMITED,
                "Please wait {$ttl}s before requesting another code.",
            );
        }

        $rateKey = self::OTP_RATE_PREFIX . $phone;
        $count   = (int) Redis::incr($rateKey);
        if ($count === 1) {
            Redis::expire($rateKey, $this->rateWindowSeconds());
        }
        if ($count > $this->maxSendsPerWindow()) {
            throw new ApiException(
                ErrorCode::RATE_LIMITED,
                'Too many code requests. Please try again later.',
            );
        }
    }

    /**
     * Burn the code after too many wrong guesses. Increments a per-identifier
     * counter that lives exactly as long as the code; on exceeding the cap we
     * delete the code (forcing a fresh request) and return RATE_LIMITED so the
     * response is indistinguishable from other throttle paths.
     */
    private function guardOtpAttempts(string $identifier, string $otpKey): void
    {
        $attemptKey = self::OTP_ATTEMPT_PREFIX . $identifier;
        $attempts   = (int) Redis::incr($attemptKey);

        if ($attempts === 1) {
            // Match the code's own TTL so the window resets with each new code.
            Redis::expire($attemptKey, (int) config('app.otp_expiry_minutes', 10) * 60);
        }

        if ($attempts > $this->maxOtpAttempts()) {
            Redis::del($otpKey);
            Redis::del($attemptKey);
            throw new ApiException(
                ErrorCode::RATE_LIMITED,
                'Too many incorrect codes. Request a new code and try again.',
            );
        }
    }

    /** Generate, store and SMS a fresh OTP for an E.164 number; arm the cooldown. */
    private function sendPhoneOtp(string $phone): void
    {
        $otp    = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
        $expiry = (int) config('app.otp_expiry_minutes', 10);

        Redis::setex(self::OTP_KEY_PREFIX . $phone, $expiry * 60, $otp);
        Redis::setex(self::OTP_COOLDOWN_PREFIX . $phone, $this->resendCooldownSeconds(), '1');

        $this->sms->send($phone, "Your Sebenza code is {$otp}. It expires in {$expiry} minutes.");
    }

    private function sendOtp(User $user): void
    {
        $otp    = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
        $expiry = (int) config('app.otp_expiry_minutes', 10);

        Redis::setex(self::OTP_KEY_PREFIX . $user->id, $expiry * 60, $otp);

        if ($user->email) {
            Mail::send([], [], static function ($message) use ($user, $otp, $expiry) {
                $message->to($user->email)
                    ->subject('Your Verification Code')
                    ->html(
                        "<p>Your verification code is: <strong style='font-size:24px'>{$otp}</strong></p>
                         <p>This code expires in {$expiry} minutes.</p>
                         <p>If you did not request this, please ignore this email.</p>"
                    );
            });
        }

        // Deliver over SMS when the account is keyed on a phone (email may be
        // null for phone-only signups — without this they'd never get a code).
        if ($user->phone) {
            $this->sms->send($user->phone, "Your Sebenza code is {$otp}. It expires in {$expiry} minutes.");
        }
    }
}
