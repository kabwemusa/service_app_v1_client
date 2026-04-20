<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('service_photos', function (Blueprint $table) {
            $table->id();
            $table->foreignUuid('service_id')->constrained()->cascadeOnDelete();
            $table->string('path');
            $table->unsignedTinyInteger('display_order')->default(0);
            $table->timestamps();

            $table->index(['service_id', 'display_order']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('service_photos');
    }
};
