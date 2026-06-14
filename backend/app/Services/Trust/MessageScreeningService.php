<?php

namespace App\Services\Trust;

use App\Models\CircumventionFlag;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * v3.2 §4.4 — anti-leakage message screening.
 *
 * Phone detection runs against a NORMALIZED copy of the message: lowercased,
 * look-alikes mapped (o/O→0, l/I→1), word-numbers mapped (zero…nine), and
 * separators (spaces, dots, dashes) stripped — so "o97 7.12-34 56" and
 * "zero nine seven seven…" both resolve. The pattern covers all Zambian
 * mobile prefixes (095–097 and the 075–077 secondary ranges) with optional
 * 0 / 260 / +260 international prefixes.
 *
 * Keyword lists (CONTACT_EXCHANGE, MOMO_SOLICITATION) load from the
 * nlp_keywords table — moderator-curated in the admin panel, never
 * hard-coded, because local-language and code-switched phrases drift.
 */
class MessageScreeningService
{
    /**
     * The v3.2 regex applied after separator stripping: optional +260/260/0
     * prefix, then a 75–77 or 95–97 range prefix, then 7 digits.
     */
    private const PHONE_PATTERN = '/(?:\+?260|0)?(7[5-7]|9[5-7])\d{7}/';

    public const SIGNAL_PHONE             = 'CONTACT_EXCHANGE';
    public const SIGNAL_MOMO_SOLICITATION = 'MOMO_SOLICITATION';

    private const WORD_NUMBERS = [
        'zero' => '0', 'one' => '1', 'two' => '2', 'three' => '3', 'four' => '4',
        'five' => '5', 'six' => '6', 'seven' => '7', 'eight' => '8', 'nine' => '9',
    ];

    /**
     * Screen one message. Returns the signals found:
     * [{signal_type, match, severity}] — empty array = clean.
     */
    public function screen(string $message): array
    {
        $signals = [];

        $keywordNormalized = $this->normalizeForKeywords($message);
        $digitNormalized   = $this->normalizeForDigits($keywordNormalized);

        $phoneFound = preg_match(self::PHONE_PATTERN, $digitNormalized, $phoneMatch) === 1;

        // MoMo solicitation — both a circumvention signal and a scam vector.
        foreach ($this->keywords(self::SIGNAL_MOMO_SOLICITATION) as $phrase) {
            if (str_contains($keywordNormalized, $phrase)) {
                $signals[] = [
                    'signal_type' => self::SIGNAL_MOMO_SOLICITATION,
                    'match'       => $phrase,
                    // a solicitation WITH a number present is the live pattern
                    'severity'    => $phoneFound ? 0.9 : 0.6,
                ];
                break;
            }
        }

        // Contact-exchange keywords ("whatsapp me", "call me directly", …)
        foreach ($this->keywords(self::SIGNAL_PHONE) as $phrase) {
            if (str_contains($keywordNormalized, $phrase)) {
                $signals[] = [
                    'signal_type' => self::SIGNAL_PHONE,
                    'match'       => $phrase,
                    'severity'    => $phoneFound ? 0.8 : 0.5,
                ];
                break;
            }
        }

        // A bare phone number is a signal on its own.
        if ($phoneFound && empty(array_filter($signals, fn ($s) => $s['signal_type'] === self::SIGNAL_PHONE))) {
            $signals[] = [
                'signal_type' => self::SIGNAL_PHONE,
                'match'       => $phoneMatch[0],
                'severity'    => 0.7,
            ];
        }

        return $signals;
    }

    /**
     * Persist circumvention flags for a screened message.
     * Call when the messaging layer lands (it doesn't exist yet — this
     * service is the backstop waiting for it).
     */
    public function flag(
        string  $userId,
        ?string $counterpartyId,
        ?string $bookingId,
        array   $signals,
        string  $redactedContext = '',
    ): void {
        foreach ($signals as $signal) {
            try {
                CircumventionFlag::create([
                    'user_id'         => $userId,
                    'counterparty_id' => $counterpartyId,
                    'booking_id'      => $bookingId,
                    'signal_type'     => $signal['signal_type'],
                    'raw_context'     => $redactedContext !== '' ? $redactedContext : $signal['match'],
                    'severity'        => $signal['severity'],
                    'created_at'      => now(),
                ]);
            } catch (\Throwable $e) {
                Log::warning('MessageScreeningService::flag failed', ['error' => $e->getMessage()]);
            }
        }
    }

    // ── Normalization ────────────────────────────────────────────────────────

    /** Lowercase + collapsed whitespace — the copy keyword phrases match against. */
    public function normalizeForKeywords(string $text): string
    {
        return preg_replace('/\s+/', ' ', mb_strtolower(trim($text))) ?? '';
    }

    /**
     * The digit-detection copy: look-alikes mapped (o→0, l/i→1 when adjacent
     * to digits is overkill — map globally on a throwaway copy), word-numbers
     * mapped, then ALL separators stripped so spacing/dot/dash obfuscation
     * collapses.
     */
    public function normalizeForDigits(string $lowercased): string
    {
        $text = strtr($lowercased, self::WORD_NUMBERS);
        $text = strtr($text, ['o' => '0', 'l' => '1', 'i' => '1']);

        return preg_replace('/[\s.\-()]/', '', $text) ?? '';
    }

    // ── Keyword lists (moderator-curated, cached) ────────────────────────────

    /** @return string[] active phrases for one list, lowercased */
    private function keywords(string $list): array
    {
        $ttl = (int) config('trust.nlp_keyword_cache_seconds', 600);

        return Cache::remember("nlp:keywords:{$list}", $ttl, function () use ($list) {
            try {
                return array_map(
                    fn ($row) => mb_strtolower($row->phrase),
                    DB::select('SELECT phrase FROM nlp_keywords WHERE list = ? AND is_active = true', [$list]),
                );
            } catch (\Throwable $e) {
                Log::warning('MessageScreeningService::keywords failed', ['error' => $e->getMessage()]);
                return [];
            }
        });
    }
}
