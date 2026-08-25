<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * PawaPay → Lenco.
 *
 * The passive callback log was named after the processor, which was fine while
 * there was exactly one. Generalise it — `payment_events` with a `provider`
 * discriminator — so existing rows stay readable in the admin Finance module
 * alongside Lenco's, and so the next swap is a config change, not a migration.
 *
 * Also adds `bookings.refund_ref`. Lenco has no refund endpoint: a refund is an
 * ordinary outbound transfer with its OWN reference, so unlike pawaPay (whose
 * refunds carried the original depositId) there is nothing to reconcile a refund
 * webhook against unless we persist that reference ourselves.
 */
return new class extends Migration
{
    /**
     * Postgres has no `ALTER TABLE … RENAME CONSTRAINT IF EXISTS`, and a missing
     * constraint aborts the whole migration. Look before leaping so this is
     * re-runnable on a database that is already part-way through (or that never
     * had the old name at all, e.g. a fresh install).
     */
    private function renameConstraint(string $table, string $from, string $to): void
    {
        $exists = DB::selectOne(
            'SELECT 1 FROM pg_constraint WHERE conrelid = ?::regclass AND conname = ?',
            [$table, $from],
        );

        if ($exists) {
            DB::statement("ALTER TABLE {$table} RENAME CONSTRAINT {$from} TO {$to}");
        }
    }

    public function up(): void
    {
        // ── payment_events ──────────────────────────────────────────────────
        // Guard the rename so this is safe on a database provisioned after the
        // table was already generalised (fresh installs run the same chain).
        if (Schema::hasTable('pawapay_events') && ! Schema::hasTable('payment_events')) {
            // Drop the old unique index first — Postgres carries indexes across a
            // table rename under their original names, which would leave a stale
            // `uq_pawapay_events_ref_status` on the renamed table.
            DB::statement('DROP INDEX IF EXISTS uq_pawapay_events_ref_status');

            Schema::rename('pawapay_events', 'payment_events');

            // Postgres carries indexes and constraints across a table rename under
            // their ORIGINAL names, so without this the schema still says
            // "pawapay" everywhere a DBA looks.
            foreach ([
                'pawapay_events_pkey'                  => 'payment_events_pkey',
                'pawapay_events_type_created_at_index' => 'payment_events_type_created_at_index',
                'pawapay_events_booking_id_index'      => 'payment_events_booking_id_index',
            ] as $from => $to) {
                DB::statement("ALTER INDEX IF EXISTS {$from} RENAME TO {$to}");
            }

            $this->renameConstraint('payment_events', 'pawapay_events_booking_id_foreign', 'payment_events_booking_id_foreign');
        }

        if (Schema::hasTable('payment_events')) {
            if (Schema::hasColumn('payment_events', 'pawapay_status')) {
                Schema::table('payment_events', function (Blueprint $table) {
                    $table->renameColumn('pawapay_status', 'provider_status');
                });
            }

            if (! Schema::hasColumn('payment_events', 'provider')) {
                Schema::table('payment_events', function (Blueprint $table) {
                    // Existing rows are pawaPay by definition; new rows are Lenco.
                    $table->string('provider', 20)->default('pawapay')->after('booking_id');
                });

                DB::table('payment_events')->update(['provider' => 'pawapay']);
            }

            DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_events_ref_status ON payment_events (external_ref, provider_status)');
        }

        // ── bookings.refund_ref ─────────────────────────────────────────────
        if (! Schema::hasColumn('bookings', 'refund_ref')) {
            Schema::table('bookings', function (Blueprint $table) {
                $table->string('refund_ref', 128)->nullable()->after('payout_ref')
                    ->comment('Gateway reference of the outbound refund transfer');
                $table->index('refund_ref');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('bookings', 'refund_ref')) {
            Schema::table('bookings', function (Blueprint $table) {
                $table->dropIndex(['refund_ref']);
                $table->dropColumn('refund_ref');
            });
        }

        if (Schema::hasTable('payment_events')) {
            DB::statement('DROP INDEX IF EXISTS uq_payment_events_ref_status');

            if (Schema::hasColumn('payment_events', 'provider')) {
                Schema::table('payment_events', function (Blueprint $table) {
                    $table->dropColumn('provider');
                });
            }

            if (Schema::hasColumn('payment_events', 'provider_status')) {
                Schema::table('payment_events', function (Blueprint $table) {
                    $table->renameColumn('provider_status', 'pawapay_status');
                });
            }

            $this->renameConstraint('payment_events', 'payment_events_booking_id_foreign', 'pawapay_events_booking_id_foreign');

            foreach ([
                'payment_events_pkey'                  => 'pawapay_events_pkey',
                'payment_events_type_created_at_index' => 'pawapay_events_type_created_at_index',
                'payment_events_booking_id_index'      => 'pawapay_events_booking_id_index',
            ] as $from => $to) {
                DB::statement("ALTER INDEX IF EXISTS {$from} RENAME TO {$to}");
            }

            Schema::rename('payment_events', 'pawapay_events');

            DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS uq_pawapay_events_ref_status ON pawapay_events (external_ref, pawapay_status)');
        }
    }
};
