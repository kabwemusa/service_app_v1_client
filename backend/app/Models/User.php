<?php

namespace App\Models;

use App\Enums\AccountState;
use App\Enums\UserRole;
use App\Models\Notification;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Illuminate\Support\Str;
use Tymon\JWTAuth\Contracts\JWTSubject;

class User extends Authenticatable implements JWTSubject
{
    use HasFactory, Notifiable;

    public $incrementing = false;
    protected $keyType = 'string';

    protected static function boot(): void
    {
        parent::boot();
        static::creating(function ($model) {
            if (empty($model->{$model->getKeyName()})) {
                $model->{$model->getKeyName()} = (string) Str::uuid();
            }
            if (empty($model->referral_code)) {
                $model->referral_code = strtoupper(Str::random(8));
            }
        });
    }

    protected $fillable = [
        'email',
        'phone',
        'phone_verified_at',
        'email_verified_at',
        'password_hash',
        'role',
        'legal_name',
        'avatar_url',
        'account_state',
        'referral_code',
        'referred_by',
        'password_changed_at',
        'is_verified',
        // risk_score is deliberately NOT mass-assignable (§ SEC-12): it is the
        // internal trust number, written only by the trust engine via an explicit
        // update — never from a request array.
        'disputes_raised_30d',
        'warned_at',
        'suspended_until',
        'last_active_at',
        'primary_location_lat',
        'primary_location_lng',
        'primary_location_label',
        'primary_location_region',
        'primary_location_source',
    ];

    /**
     * Fields never emitted by implicit model serialization (toArray/toJson).
     * Defense-in-depth: even if a raw User (or a User relation) is returned
     * without an explicit Resource, these must not leak. Resources that a party
     * is entitled to still read a field access it explicitly, which bypasses
     * $hidden — so this only strips the *accidental* exposure path.
     *
     * risk_score is THE internal trust number and must never reach any client
     * (§8); the primary_location_* pair is the user's home coordinates (§4).
     */
    protected $hidden = [
        'password_hash',
        'risk_score',
        'primary_location_lat',
        'primary_location_lng',
        'disputes_raised_30d',
        'warned_at',
        'suspended_until',
        'session_invalidated_at',
        'password_changed_at',
        'referral_code',
        'referred_by',
    ];

    protected function casts(): array
    {
        return [
            'is_verified'          => 'boolean',
            'r_raw'                => 'float',
            'completion_rate'      => 'float',
            'risk_score'           => 'float',
            'primary_location_lat' => 'float',
            'primary_location_lng' => 'float',
            'last_active_at'       => 'datetime',
            'warned_at'            => 'datetime',
            'suspended_until'      => 'datetime',
            'email_verified_at'    => 'datetime',
            'phone_verified_at'    => 'datetime',
            'password_changed_at'  => 'datetime',
        ];
    }

    // JWT interface
    public function getJWTIdentifier(): mixed
    {
        return $this->getKey();
    }

    public function getJWTCustomClaims(): array
    {
        $tier = $this->providerProfile?->trust_tier ?? 0;

        return [
            'role'  => $this->role,
            'tier'  => $tier,
            'phone' => $this->phone,
            'caps'  => $this->resolveCaps($tier),
        ];
    }

    /**
     * Resolve a single account from a phone number (identity rule: phone is the
     * canonical key across WhatsApp, the PWA and any future native client).
     * Input is normalized to E.164 so all formats collapse to one account.
     *
     * @param  string  $intent  'CUSTOMER' or 'PROVIDER' — only used when creating.
     */
    public static function findOrCreateByPhone(string $rawPhone, string $intent = 'CUSTOMER'): self
    {
        $e164 = \App\Support\PhoneNumber::normalize($rawPhone);
        if ($e164 === null) {
            throw new \InvalidArgumentException("Not a valid Zambian phone number: {$rawPhone}");
        }

        // Strict E.164 match only (§ SEC-8). A trailing-digits LIKE match could
        // resolve to a DIFFERENT subscriber that happens to share the last nine
        // digits, silently merging or hijacking an account. All stored numbers
        // are canonicalized to E.164 (see the phone-backfill migration), so exact
        // equality is both correct and safe.
        $user = self::where('phone', $e164)->first();

        if ($user) {
            $intent === 'PROVIDER' ? $user->ensureProviderProfile() : null;

            return $user;
        }

        $user = self::create([
            'phone'         => $e164,
            'role'          => $intent === 'PROVIDER' ? 'PROVIDER' : 'CUSTOMER',
            'account_state' => 'ACTIVE',
            'is_verified'   => false,
        ]);

        if ($intent === 'PROVIDER') {
            $user->ensureProviderProfile();
        }

        return $user;
    }

    /** Ensure a PROVIDER account has a profile, created in the DRAFT onboarding state. */
    public function ensureProviderProfile(): ProviderProfile
    {
        if ($this->role !== 'PROVIDER') {
            $this->update(['role' => 'PROVIDER']);
        }

        return ProviderProfile::firstOrCreate(
            ['user_id' => $this->id],
            ['onboarding_state' => 'DRAFT'],
        );
    }

    public function isActive(): bool
    {
        return $this->account_state === AccountState::ACTIVE->value || $this->account_state === 'ACTIVE';
    }

    public function isStaff(): bool
    {
        return in_array($this->role, ['ADMIN', 'MODERATOR'], true);
    }

    // Relationships
    public function providerProfile()
    {
        return $this->hasOne(ProviderProfile::class, 'user_id');
    }

    public function services()
    {
        return $this->hasMany(Service::class, 'provider_id');
    }

    public function bookingsAsCustomer()
    {
        return $this->hasMany(Booking::class, 'buyer_id');
    }

    public function bookingsAsProvider()
    {
        return $this->hasMany(Booking::class, 'provider_id');
    }

    public function notifications()
    {
        return $this->hasMany(Notification::class, 'user_id');
    }

    public function identityDocuments()
    {
        return $this->hasMany(IdentityDocument::class, 'user_id');
    }

    public function subscription()
    {
        return $this->hasOne(Subscription::class, 'provider_id')
            ->where('status', 'ACTIVE')
            ->latestOfMany('current_period_start');
    }

    public function referrer()
    {
        return $this->belongsTo(User::class, 'referred_by');
    }

    public function referrals()
    {
        return $this->hasMany(User::class, 'referred_by');
    }

    public function savedLocations()
    {
        return $this->hasMany(SavedLocation::class, 'user_id');
    }

    /** Append-only consent audit (Data Protection Act No. 3 of 2021 — demonstrable consent). */
    public function consentRecords()
    {
        return $this->hasMany(ConsentRecord::class, 'user_id');
    }

    /** Data-subject-rights requests the user has raised. */
    public function dataSubjectRequests()
    {
        return $this->hasMany(DataSubjectRequest::class, 'user_id');
    }

    /** v3.1 §4.1 — every user must set a primary location before they can search/be discovered. */
    public function hasPrimaryLocation(): bool
    {
        return $this->primary_location_lat !== null && $this->primary_location_lng !== null;
    }

    // ── Private helpers ──────────────────────────────────────────────────────

    private function resolveCaps(int $tier): array
    {
        $caps = [];
        if ($tier >= 1) $caps[] = 'sell';
        if ($tier >= 3) $caps[] = 'high_value';
        if ($tier >= 3) $caps[] = 'instant_payout';
        if ($tier >= 3) $caps[] = 'promoted';
        if ($tier >= 4) $caps[] = 'unlimited';
        return $caps;
    }
}
