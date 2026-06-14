<?php

namespace Tests\Unit\Trust;

use App\Services\KycService;
use App\Services\Trust\MessageScreeningService;
use Illuminate\Support\Facades\Cache;
use Tests\TestCase;

/**
 * Phase 2 — §4.3 MoMo name fuzzy match and §4.4 anti-leakage screening.
 */
class MomoAndScreeningTest extends TestCase
{
    // ── §4.3 wallet-name fuzzy match ─────────────────────────────────────────

    public function test_names_fuzzy_match(): void
    {
        // Exact and case-insensitive
        $this->assertTrue(KycService::namesFuzzyMatch('Chanda Mwale', 'CHANDA MWALE'));
        // Order-insensitive (wallet registrations often flip name order)
        $this->assertTrue(KycService::namesFuzzyMatch('Chanda Mwale', 'Mwale Chanda'));
        // Punctuation/diacritic stripping
        $this->assertTrue(KycService::namesFuzzyMatch("Naomi Phiri", 'naomi  phiri.'));
        // Within Levenshtein ≤ 2 (typo on the registration)
        $this->assertTrue(KycService::namesFuzzyMatch('Chanda Mwale', 'Chanda Mwala'));
        $this->assertTrue(KycService::namesFuzzyMatch('Bwalya Tembo', 'Bwalia Tembo'));
        // A different person fails
        $this->assertFalse(KycService::namesFuzzyMatch('Chanda Mwale', 'Kelvin Mulenga'));
        $this->assertFalse(KycService::namesFuzzyMatch('Grace Mwansa', 'Grace Banda'));
        // Nothing comparable → never block
        $this->assertTrue(KycService::namesFuzzyMatch('', 'Anyone'));
    }

    // ── §4.4 message screening ───────────────────────────────────────────────

    private function screener(array $contactPhrases = [], array $momoPhrases = []): MessageScreeningService
    {
        // Pin the moderator-curated lists for the test (normally DB-loaded).
        Cache::put('nlp:keywords:CONTACT_EXCHANGE', $contactPhrases, 3600);
        Cache::put('nlp:keywords:MOMO_SOLICITATION', $momoPhrases, 3600);

        return new MessageScreeningService();
    }

    /** @return string[] */
    private function signalTypes(array $signals): array
    {
        return array_values(array_unique(array_map(fn ($s) => $s['signal_type'], $signals)));
    }

    public function test_detects_all_zambian_prefix_ranges(): void
    {
        $screener = $this->screener();

        foreach (['0977123456', '0967123456', '0957123456', '0757123456', '0767123456', '0777123456'] as $number) {
            $this->assertNotEmpty($screener->screen("you can find me on {$number}"), "missed {$number}");
        }
    }

    public function test_detects_international_and_obfuscated_formats(): void
    {
        $screener = $this->screener();

        // Full international format (the v2 regex missed +260 + 9 digits)
        $this->assertNotEmpty($screener->screen('call +260 977 123 456'));
        $this->assertNotEmpty($screener->screen('260977123456 is my line'));
        // Spaced / dotted / dashed digits
        $this->assertNotEmpty($screener->screen('0 9 7 7 1 2 3 4 5 6'));
        $this->assertNotEmpty($screener->screen('097-712-3456'));
        $this->assertNotEmpty($screener->screen('097.712.3456'));
        // Look-alike characters (o→0, l/i→1)
        $this->assertNotEmpty($screener->screen('o977123456'));
        // Word-numbers
        $this->assertNotEmpty($screener->screen('zero nine seven seven one two three four five six'));
    }

    public function test_clean_messages_pass(): void
    {
        $screener = $this->screener(['whatsapp me'], ['send money to']);

        $this->assertSame([], $screener->screen('What time works for you tomorrow?'));
        $this->assertSame([], $screener->screen('The job costs ZMW 450 including materials.'));
        $this->assertSame([], $screener->screen('I live at house 25, off Kafue road.'));
    }

    public function test_momo_solicitation_signal(): void
    {
        $screener = $this->screener([], ['send money to', 'momo me']);

        // Solicitation phrase + number = the live scam/circumvention pattern
        $withNumber = $screener->screen('Just send money to 0977123456 before I start');
        $this->assertContains(MessageScreeningService::SIGNAL_MOMO_SOLICITATION, $this->signalTypes($withNumber));
        $momoSignal = array_values(array_filter($withNumber, fn ($s) => $s['signal_type'] === MessageScreeningService::SIGNAL_MOMO_SOLICITATION))[0];
        $this->assertSame(0.9, $momoSignal['severity']);

        // Phrase alone still flags, at lower severity
        $alone = $screener->screen('you can momo me when done');
        $this->assertContains(MessageScreeningService::SIGNAL_MOMO_SOLICITATION, $this->signalTypes($alone));
    }

    public function test_contact_exchange_keywords_load_from_curated_list(): void
    {
        $screener = $this->screener(['whatsapp me', 'nitumineni foni'], []);

        // English and (moderator-added) local-language phrases both match
        $this->assertContains(
            MessageScreeningService::SIGNAL_PHONE,
            $this->signalTypes($screener->screen('just WhatsApp me instead')),
        );
        $this->assertContains(
            MessageScreeningService::SIGNAL_PHONE,
            $this->signalTypes($screener->screen('Nitumineni foni yanu')),
        );
    }
}
