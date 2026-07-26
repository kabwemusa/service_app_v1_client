<?php

namespace App\Support;

use App\Models\Booking;
use App\Services\BookingStateMachine;

/**
 * Resolves which structured status-update presets a party can send on a booking
 * right now (role + lifecycle state). Stateless + dependency-light so it can be
 * called cheaply from BOTH the CommunicationService and BookingResource (per row
 * in a list) without resolving the heavy service graph.
 */
final class StatusPresetCatalog
{
    /** @return array<int, array<string, mixed>> */
    public static function availableFor(Booking $booking, string $role): array
    {
        if (! ContactWindow::isOpen($booking)) {
            return [];
        }

        $machine   = new BookingStateMachine();
        $presets   = config('communication.status_presets', []);
        $durations = config('communication.late_durations', []);
        $out       = [];

        foreach ($presets as $type => $p) {
            if (($p['role'] ?? null) !== $role) {
                continue;
            }

            $drives = $p['drives'] ?? null;
            if ($drives === 'start' && ! $machine->canTransition($booking, 'IN_PROGRESS')) {
                continue;
            }
            if ($drives === 'finish' && ! $machine->canTransition($booking, 'DELIVERED')) {
                continue;
            }

            $entry = ['type' => $type, 'label' => $p['label']];
            if (($p['requires'] ?? null) === 'duration') {
                $entry['requires']  = 'duration';
                $entry['durations'] = array_values($durations);
            }
            if (($p['requires'] ?? null) === 'note') {
                $entry['requires']   = 'note';
                $entry['max_length'] = (int) config('communication.note_max_length', 200);
            }
            if ($drives) {
                $entry['drives'] = $drives;
            }
            $out[] = $entry;
        }

        return $out;
    }
}
