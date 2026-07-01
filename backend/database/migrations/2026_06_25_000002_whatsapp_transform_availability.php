<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('provider_availability', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('provider_id');
            $table->unsignedTinyInteger('day_of_week')
                ->comment('0=Sun, 1=Mon, ..., 6=Sat (ISO)');
            $table->time('start_time');
            $table->time('end_time');
            $table->boolean('is_recurring')->default(true)
                ->comment('true = repeats weekly; false = one-off override');
            $table->date('specific_date')->nullable()
                ->comment('Non-null for one-off overrides or blocks');
            $table->boolean('is_blocked')->default(false)
                ->comment('true = unavailable (holiday/leave block)');
            $table->timestamps();

            $table->foreign('provider_id')->references('id')->on('users')->cascadeOnDelete();
            $table->index(['provider_id', 'day_of_week']);
            $table->index(['provider_id', 'specific_date']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('provider_availability');
    }
};
