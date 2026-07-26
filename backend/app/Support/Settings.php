<?php

namespace App\Support;

use App\Models\PlatformSetting;
use Illuminate\Support\Facades\Cache;

/**
 * § ADM-1 — read-through accessor for admin-editable platform settings.
 *
 * Runtime services call Settings::get('key', <config default>) so an admin edit
 * in the Platform Settings module actually takes effect, instead of the setting
 * being recorded but ignored while the service keeps reading config()/env().
 *
 * The whole table is cached as one map (settings are read often, written rarely)
 * and invalidated by AdminSettingsService on every write. A key that has never
 * been overridden falls back to the caller-supplied default, so this is safe to
 * call before any row exists.
 */
final class Settings
{
    private const CACHE_KEY = 'platform_settings:all';
    private const TTL_SECONDS = 300;

    public static function get(string $key, mixed $default = null): mixed
    {
        $all = Cache::remember(
            self::CACHE_KEY,
            self::TTL_SECONDS,
            fn () => PlatformSetting::query()->pluck('value', 'key')->all(),
        );

        return array_key_exists($key, $all) && $all[$key] !== null ? $all[$key] : $default;
    }

    public static function float(string $key, float $default): float
    {
        $v = self::get($key, $default);
        return is_numeric($v) ? (float) $v : $default;
    }

    public static function int(string $key, int $default): int
    {
        $v = self::get($key, $default);
        return is_numeric($v) ? (int) $v : $default;
    }

    /** Invalidate the cache — call after any settings write. */
    public static function flush(): void
    {
        Cache::forget(self::CACHE_KEY);
    }
}
