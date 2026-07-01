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
    private const OTP_RATE_PREFIX    = 'otp_rate:';
    private const OTP_COOLDOWN_PREFIX = 'otp_cd:';

    /** Seconds a caller must wait between OTP sends to the same number. */
    private const RESEND_COOLDOWN_SECONDS = 60;

    /** Max OTP sends per number within the rolling window before a hard block. */
    private const MAX_SENDS_PER_WINDOW = 5;
    private const RATE_WINDOW_SECONDS  = 3600;

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

        $existed = User::where('phone', $phone)
            ->orWhere('phone', 'LIKE', '%' . substr($phone, -9))
            ->exists();

        $user = User::findOrCreateByPhone($phone, $intent);

        $this->sendPhoneOtp($user->phone);

        return [
            'phone'        => $user->phone,
            'resend_after' => self::RESEND_COOLDOWN_SECONDS,
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
        if (! hash_equals((string) $storedOtp, $otp)) {
            throw OtpException::invalid();
        }

        $user = User::where('phone', $phone)
            ->orWhere('phone', 'LIKE', '%' . substr($phone, -9))
            ->firstOrFail();

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

        if ($storedOtp !== $otp) {
            throw OtpException::invalid();
        }

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
        Redis::del(self::REFRESH_KEY_PREFIX . $refreshToken);
    }

    public function resendOtp(User $user): void
    {
        $this->sendOtp($user);
    }

    // ── Private helpers ──────────────────────────────────────────────────────

    private function issueTokenPair(User $user): array
    {
        $accessToken  = JWTAuth::fromUser($user);
        $refreshToken = $this->storeRefreshToken($user->id);

        return [
            'access_token'  => $accessToken,
            'refresh_token' => $refreshToken,
            'user'          => $user,
        ];
    }

    private function storeRefreshToken(string $userId): string
    {
        $token  = Str::random(64);
        $expiry = (int) config('jwt.refresh_ttl', 10080);

        Redis::setex(self::REFRESH_KEY_PREFIX . $token, $expiry * 60, $userId);

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
            Redis::expire($rateKey, self::RATE_WINDOW_SECONDS);
        }
        if ($count > self::MAX_SENDS_PER_WINDOW) {
            throw new ApiException(
                ErrorCode::RATE_LIMITED,
                'Too many code requests. Please try again later.',
            );
        }
    }

    /** Generate, store and SMS a fresh OTP for an E.164 number; arm the cooldown. */
    private function sendPhoneOtp(string $phone): void
    {
        $otp    = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
        $expiry = (int) config('app.otp_expiry_minutes', 10);

        Redis::setex(self::OTP_KEY_PREFIX . $phone, $expiry * 60, $otp);
        Redis::setex(self::OTP_COOLDOWN_PREFIX . $phone, self::RESEND_COOLDOWN_SECONDS, '1');

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

        // TODO: SMS via Africa's Talking when $user->phone is set
    }
}
