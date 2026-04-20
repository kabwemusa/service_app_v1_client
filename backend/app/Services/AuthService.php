<?php

namespace App\Services;

use App\Exceptions\Api\EmailNotVerifiedException;
use App\Exceptions\Api\InvalidCredentialsException;
use App\Exceptions\Api\OtpException;
use App\Models\ProviderProfile;
use App\Models\User;
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
