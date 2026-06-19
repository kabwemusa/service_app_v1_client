<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

class NotificationSetting extends Model
{
    public $incrementing = false;
    protected $keyType = 'string';
    protected $table = 'notification_settings';

    protected static function boot(): void
    {
        parent::boot();
        static::creating(function ($model) {
            if (empty($model->id)) {
                $model->id = (string) Str::uuid();
            }
        });
    }

    protected $fillable = [
        'user_id',
        'categories',
        'quiet_hours',
    ];

    protected function casts(): array
    {
        return [
            'categories'  => 'array',
            'quiet_hours' => 'array',
        ];
    }

    public const DEFAULT_CATEGORIES = [
        'bookings'     => ['push' => true, 'sms' => true,  'in_app' => true],
        'payments'     => ['push' => true, 'sms' => true,  'in_app' => true],
        'reviews'      => ['push' => true, 'sms' => false, 'in_app' => true],
        'verification' => ['push' => true, 'sms' => false, 'in_app' => true],
        'moderation'   => ['push' => true, 'sms' => false, 'in_app' => true],
        'referrals'    => ['push' => true, 'sms' => false, 'in_app' => true],
        'safety'       => ['push' => true, 'sms' => true,  'in_app' => true],
        'marketing'    => ['push' => false, 'sms' => false, 'in_app' => true],
    ];

    public const DEFAULT_QUIET_HOURS = [
        'enabled' => false,
        'start'   => '22:00',
        'end'     => '07:00',
    ];

    public static function forUser(string $userId): self
    {
        return static::firstOrCreate(
            ['user_id' => $userId],
            [
                'categories'  => self::DEFAULT_CATEGORIES,
                'quiet_hours' => self::DEFAULT_QUIET_HOURS,
            ]
        );
    }

    public function user()
    {
        return $this->belongsTo(User::class, 'user_id');
    }
}
