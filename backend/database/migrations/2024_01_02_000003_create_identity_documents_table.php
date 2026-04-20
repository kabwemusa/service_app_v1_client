<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('identity_documents', function (Blueprint $table) {
            $table->uuid('id')->primary()->default(DB::raw('gen_random_uuid()'));
            $table->uuid('user_id');
            $table->foreign('user_id')->references('id')->on('users')->onDelete('cascade');

            $table->string('doc_type', 30);  // NRC | PASSPORT | DRIVERS_LICENSE | PROOF_OF_ADDRESS | SELFIE | CERTIFICATE
            $table->string('doc_number_hash', 64)->nullable();  // SHA-256 + pepper; raw number never stored
            $table->string('doc_storage_url')->nullable();       // S3 key of encrypted document

            $table->string('status', 20)->default('SUBMITTED');
            // SUBMITTED | AUTO_APPROVED | AUTO_REJECTED | MANUAL_REVIEW | APPROVED | REJECTED | EXPIRED

            $table->decimal('confidence_score', 3, 2)->nullable();  // 0.00–1.00 from verification provider
            $table->jsonb('extracted_fields')->nullable();           // OCR output — encrypted at rest
            $table->uuid('reviewer_id')->nullable();
            $table->foreign('reviewer_id')->references('id')->on('users')->nullOnDelete();
            $table->text('review_notes')->nullable();
            $table->date('expires_on')->nullable();

            $table->timestamp('submitted_at')->useCurrent();
            $table->timestamp('reviewed_at')->nullable();
        });

        DB::statement('CREATE INDEX idx_id_docs_user_type_status ON identity_documents USING btree (user_id, doc_type, status)');
        DB::statement('CREATE INDEX idx_id_docs_hash ON identity_documents USING btree (doc_number_hash)');
        DB::statement('CREATE INDEX idx_id_docs_queue ON identity_documents USING btree (status, submitted_at)');
    }

    public function down(): void
    {
        Schema::dropIfExists('identity_documents');
    }
};
