<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * v3.2 §4.4 — moderator-curated anti-leakage keyword lists.
 *
 * Lists load from this table (admin-editable), never hard-coded: local-language
 * and code-switched phrases drift, so they're built empirically from
 * redacted-message review. Seeded with English starters only.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('nlp_keywords', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));

            $table->string('list', 30);
            // CONTACT_EXCHANGE — "call/WhatsApp me directly" patterns
            // MOMO_SOLICITATION — "send money to this number" patterns

            $table->string('phrase', 120);
            $table->string('language', 10)->default('en'); // en | ny | bem | ton
            $table->boolean('is_active')->default(true);

            $table->uuid('created_by')->nullable();
            $table->timestamp('created_at')->useCurrent();

            $table->unique(['list', 'phrase']);
        });

        DB::statement("ALTER TABLE nlp_keywords ADD CONSTRAINT nlp_keywords_list_check
            CHECK (list IN ('CONTACT_EXCHANGE', 'MOMO_SOLICITATION'))");

        // English starters — moderators extend these from redacted-message review.
        $now = now();
        DB::table('nlp_keywords')->insert(array_map(fn ($row) => $row + ['created_at' => $now], [
            ['list' => 'CONTACT_EXCHANGE',  'phrase' => 'whatsapp me',           'language' => 'en'],
            ['list' => 'CONTACT_EXCHANGE',  'phrase' => 'call me directly',      'language' => 'en'],
            ['list' => 'CONTACT_EXCHANGE',  'phrase' => 'text me direct',        'language' => 'en'],
            ['list' => 'CONTACT_EXCHANGE',  'phrase' => 'reach me on',           'language' => 'en'],
            ['list' => 'CONTACT_EXCHANGE',  'phrase' => 'my number is',          'language' => 'en'],
            ['list' => 'MOMO_SOLICITATION', 'phrase' => 'send money to',         'language' => 'en'],
            ['list' => 'MOMO_SOLICITATION', 'phrase' => 'send to this number',   'language' => 'en'],
            ['list' => 'MOMO_SOLICITATION', 'phrase' => 'momo me',               'language' => 'en'],
            ['list' => 'MOMO_SOLICITATION', 'phrase' => 'pay me on mobile money', 'language' => 'en'],
            ['list' => 'MOMO_SOLICITATION', 'phrase' => 'deposit to',            'language' => 'en'],
        ]));
    }

    public function down(): void
    {
        Schema::dropIfExists('nlp_keywords');
    }
};
