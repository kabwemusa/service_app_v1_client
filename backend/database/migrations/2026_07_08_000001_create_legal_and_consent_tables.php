<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Legal-agreement layer for Sebenza (Terms of Service, Privacy Policy, User
 * Agreement) and the consent mechanism the Data Protection Act No. 3 of 2021
 * requires a controller to be able to DEMONSTRATE.
 *
 * Three tables:
 *   legal_documents        — the versioned content source. Each (type, version)
 *                            is a row; legal edits copy/bump rather than mutate a
 *                            published version, so the exact text a user agreed to
 *                            can always be reconstructed.
 *   consent_records        — APPEND-ONLY audit of every consent event (grant /
 *                            re-consent on a version bump / withdrawal / decline).
 *                            Never updated, never deleted. History is the point.
 *   data_subject_requests  — capture of data-subject-rights exercises (access,
 *                            rectification, erasure, objection, restriction,
 *                            portability, withdraw-consent). The user-facing right
 *                            must exist even while fulfilment handlers are stubbed.
 *
 * NOTE FOR LEGAL / COMPLIANCE: the *wording* served from legal_documents is
 * DRAFT placeholder scaffold (see LegalDocumentSeeder) pending review by a
 * qualified Zambian lawyer. This migration only builds the mechanism.
 */
return new class extends Migration
{
    public function up(): void
    {
        // ── Versioned content source ──────────────────────────────────────────
        Schema::create('legal_documents', function (Blueprint $table) {
            $table->uuid('id')->primary();
            // terms_of_service | privacy_policy | user_agreement
            $table->string('type', 40);
            // Human/semver-ish label, e.g. "0.1.0-draft". Unique per type.
            $table->string('version', 40);
            // draft | published | archived. Only `published` is shown in prod;
            // non-production may also surface the latest `draft` (config/legal.php).
            $table->string('status', 20)->default('draft');
            $table->string('title');
            $table->text('summary')->nullable();
            // The scaffold body: { intro, sections: [{ id, title, level, body }] }.
            // Markdown lives in section bodies so both clients render one source.
            $table->jsonb('content');
            $table->date('effective_date')->nullable();
            // Whether a bump FROM the previous version is a MATERIAL change that
            // forces existing users to re-consent before continuing (Act: consent
            // must stay informed & current). Defaults true — legal downgrades it
            // for cosmetic edits.
            $table->boolean('is_material')->default(true);
            $table->timestamps();

            $table->unique(['type', 'version']);
            $table->index(['type', 'status']);
        });

        // ── Append-only consent audit ─────────────────────────────────────────
        Schema::create('consent_records', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('user_id');
            // GRANT | RECONSENT | WITHDRAW | DECLINE
            $table->string('event', 20);
            // Snapshot of the exact documents+versions the user agreed to on a
            // GRANT/RECONSENT event: [{ "type": "...", "version": "..." }].
            $table->jsonb('documents')->nullable();
            // Unbundled optional processing — each recorded on its own, never
            // pre-ticked, never implied by the core agreement.
            $table->boolean('marketing_opt_in')->default(false);
            $table->boolean('analytics_opt_in')->default(false);
            // On WITHDRAW: what was withdrawn — 'CORE' | 'marketing' | 'analytics'.
            $table->string('withdrawn_scope', 20)->nullable();
            // Provenance for the audit trail.
            $table->string('platform', 20)->nullable();   // mobile_ios | mobile_android | pwa
            $table->string('app_version', 40)->nullable();
            $table->string('ip_address', 64)->nullable();
            $table->text('user_agent')->nullable();
            // APPEND-ONLY: created_at only. No updated_at — a correction is a new
            // row, never a mutation of an existing one.
            $table->timestamp('created_at')->useCurrent();

            $table->index(['user_id', 'created_at']);
            $table->index('event');
        });

        // ── Data-subject-rights request capture ───────────────────────────────
        Schema::create('data_subject_requests', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('user_id');
            // ACCESS | RECTIFICATION | ERASURE | OBJECTION | RESTRICTION |
            // PORTABILITY | WITHDRAW_CONSENT
            $table->string('type', 30);
            // RECEIVED | IN_PROGRESS | COMPLETED | REJECTED
            $table->string('status', 20)->default('RECEIVED');
            $table->text('details')->nullable();      // the user's message / specifics
            $table->text('resolution_note')->nullable(); // staff note on fulfilment
            $table->timestamp('resolved_at')->nullable();
            $table->timestamps();

            $table->index(['user_id', 'created_at']);
            $table->index(['status', 'type']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('data_subject_requests');
        Schema::dropIfExists('consent_records');
        Schema::dropIfExists('legal_documents');
    }
};
