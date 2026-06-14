<?php

namespace App\Models;

use App\Support\AdminCapabilities;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Support\Str;
use Tymon\JWTAuth\Contracts\JWTSubject;

/**
 * An admin / staff identity. Separate from App\Models\User (marketplace).
 * Authenticated via the `admin` JWT guard (config/auth.php).
 */
class AdminUser extends Authenticatable implements JWTSubject
{
    use HasFactory;

    protected $table = 'admin_users';

    public $incrementing = false;
    protected $keyType = 'string';

    protected static function boot(): void
    {
        parent::boot();
        static::creating(function ($model) {
            if (empty($model->{$model->getKeyName()})) {
                $model->{$model->getKeyName()} = (string) Str::uuid();
            }
        });
    }

    protected $fillable = [
        'name',
        'username',
        'email',
        'password',
        'role',
        'avatar_url',
        'mfa_secret',
        'mfa_enabled',
        'last_login_at',
    ];

    protected $hidden = [
        'password',
        'mfa_secret',
    ];

    protected function casts(): array
    {
        return [
            'mfa_enabled'   => 'boolean',
            'last_login_at' => 'datetime',
            'password'      => 'hashed',
        ];
    }

    /** Capabilities resolved from the role — never stored, always derived. */
    public function capabilities(): array
    {
        return AdminCapabilities::forRole($this->role);
    }

    // ── JWT ───────────────────────────────────────────────────────────────────

    public function getJWTIdentifier(): mixed
    {
        return $this->getKey();
    }

    /**
     * Claims consumed by the admin panel (admin/src/lib/api/types.ts
     * AdminTokenPayload). `sub`, `iat`, `exp` are added by tymon/jwt-auth.
     */
    public function getJWTCustomClaims(): array
    {
        return [
            'email'        => $this->email,
            'name'         => $this->name,
            'role'         => $this->role,
            'capabilities' => $this->capabilities(),
            'avatar_url'   => $this->avatar_url,
            // Set true only after a step-up (re-auth) challenge. Stubbed false.
            'step_up'      => false,
        ];
    }
}
