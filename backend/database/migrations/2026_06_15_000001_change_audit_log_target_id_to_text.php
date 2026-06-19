<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * target_id was originally uuid, but audit entries legitimately carry
     * semantic placeholders like 'new' (category.create before the row has an id)
     * and 'bulk' (category.reorder). Changing to text accepts all of these as well
     * as real UUIDs and integer IDs cast to string.
     */
    public function up(): void
    {
        DB::statement('ALTER TABLE admin_audit_log ALTER COLUMN target_id TYPE TEXT');
    }

    public function down(): void
    {
        // Cannot safely revert: existing rows may contain non-UUID strings.
        // To revert manually: ensure all rows have valid UUIDs, then:
        // ALTER TABLE admin_audit_log ALTER COLUMN target_id TYPE UUID USING target_id::uuid;
    }
};
