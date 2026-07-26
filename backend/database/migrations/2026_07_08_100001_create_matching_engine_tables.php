<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Natural-language service matcher (WHAT-finder that feeds the ranking engine).
 *
 * The catalog is small (dozens of categories, low hundreds of services), so we
 * store a pre-computed embedding per row as jsonb and do cosine similarity in
 * PHP — no pgvector extension required. `embedding_model` scopes a vector to the
 * provider that produced it (embeddings are only comparable within one model);
 * `embedding_source_hash` lets the re-embed hook skip rows whose text is
 * unchanged. Layer 3 (LLM disambiguation) never writes here — it only *reads*
 * real candidate IDs.
 *
 * `match_query_logs` is the tuning dataset (§ "Logging for tuning"): one row per
 * submitted query with which layer resolved it and the outcome — query text
 * only, no PII, aligned with the consent/privacy layer.
 */
return new class extends Migration
{
    public function up(): void
    {
        foreach (['categories', 'services'] as $table) {
            Schema::table($table, function (Blueprint $t) {
                $t->jsonb('embedding')->nullable();
                $t->string('embedding_model', 100)->nullable();
                $t->string('embedding_source_hash', 64)->nullable();
                $t->timestamp('embedded_at')->nullable();
            });
        }

        Schema::create('match_query_logs', function (Blueprint $t) {
            $t->uuid('id')->primary();

            // Query text only — no PII beyond what the customer typed (privacy).
            $t->text('query');
            $t->string('normalized_query')->nullable();

            // Which layer resolved it: exact | synonym | semantic | llm | none
            $t->string('resolved_layer', 20)->nullable();
            // matched | clarify | empty
            $t->string('status', 20);

            $t->unsignedBigInteger('resolved_category_id')->nullable();
            // Real catalog service IDs returned to the caller (JSON array of uuids).
            $t->jsonb('service_ids')->nullable();
            $t->decimal('confidence', 6, 4)->nullable();

            // Whether an LLM call was made — the cost-control audit signal.
            $t->boolean('used_llm')->default(false);

            // Surface the query came from: app | whatsapp
            $t->string('channel', 20)->default('app');

            // Attribution — set later when the customer acts (privacy-safe: no PII).
            $t->uuid('user_id')->nullable();
            $t->string('outcome', 20)->nullable(); // booked | refined | abandoned
            $t->string('booked_service_id')->nullable();

            $t->timestamps();

            $t->index(['status', 'resolved_layer']);
            $t->index('created_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('match_query_logs');

        foreach (['categories', 'services'] as $table) {
            Schema::table($table, function (Blueprint $t) {
                $t->dropColumn(['embedding', 'embedding_model', 'embedding_source_hash', 'embedded_at']);
            });
        }
    }
};
