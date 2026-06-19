<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('notifications', function (Blueprint $table) {
            $table->timestamp('event_time')->nullable()->after('meta');
            $table->timestamp('dispatch_time')->nullable()->after('event_time');
            $table->timestamp('ack_time')->nullable()->after('dispatch_time');
            $table->string('priority', 10)->default('normal')->after('ack_time');
            $table->timestamp('sms_sent_at')->nullable()->after('priority');
            $table->string('push_status', 20)->nullable()->after('sms_sent_at');
        });
    }

    public function down(): void
    {
        Schema::table('notifications', function (Blueprint $table) {
            $table->dropColumn(['event_time', 'dispatch_time', 'ack_time', 'priority', 'sms_sent_at', 'push_status']);
        });
    }
};
