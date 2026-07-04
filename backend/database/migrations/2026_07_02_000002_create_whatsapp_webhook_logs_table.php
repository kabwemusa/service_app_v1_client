<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Passive, append-only log of inbound WhatsApp webhook events (messages and
 * delivery-status callbacks). Written from WhatsAppWebhookController at the
 * points it already determines an outcome — no behavior change, purely
 * observability for the admin WhatsApp Ops module (Conversations/Logs tabs).
 *
 * `from_number` is stored as-is (already a WhatsApp ID, not further PII than
 * what the conversation itself already carries); the admin UI masks it on
 * display the same way the Users/Safety modules mask phone numbers.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('whatsapp_webhook_logs', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('message_id', 100)->nullable();
            $table->string('from_number', 30)->nullable();
            // message | status | unparseable
            $table->string('kind', 20);
            // for kind=message: text/button_reply/list_reply/location/image/unsupported
            // for kind=status: sent/delivered/read/failed
            $table->string('type', 30)->nullable();
            $table->string('processing_status', 20); // processed | failed | duplicate
            $table->text('error')->nullable();
            $table->timestamp('created_at');

            $table->index(['kind', 'created_at']);
            $table->index('created_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('whatsapp_webhook_logs');
    }
};
