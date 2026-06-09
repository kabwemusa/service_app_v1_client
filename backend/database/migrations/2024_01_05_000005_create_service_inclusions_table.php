<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /** v3.1 §5.2 — ordered "what's included" bullets shown on a service listing. */
    public function up(): void
    {
        Schema::create('service_inclusions', function (Blueprint $table) {
            $table->id();
            $table->foreignUuid('service_id')->constrained()->cascadeOnDelete();
            $table->unsignedSmallInteger('position')->default(0);
            $table->string('text', 120);

            $table->index(['service_id', 'position']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('service_inclusions');
    }
};
