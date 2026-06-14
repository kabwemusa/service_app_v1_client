<?php

namespace App\Support;

/**
 * Small pure-math helpers for the v3.2 §7 metrics pipeline.
 */
final class Stats
{
    /**
     * Gini coefficient of a distribution (0 = perfectly even, →1 = one
     * provider takes everything). The early-warning gauge for the
     * rich-get-richer failure the fairness slots exist to prevent.
     *
     * @param array<int|float> $values e.g. bookings per provider
     */
    public static function gini(array $values): float
    {
        $values = array_values(array_map('floatval', $values));
        $n      = count($values);

        if ($n === 0) {
            return 0.0;
        }

        sort($values);
        $sum = array_sum($values);

        if ($sum <= 0.0) {
            return 0.0;
        }

        $weighted = 0.0;
        foreach ($values as $i => $value) {
            $weighted += ($i + 1) * $value;
        }

        return (2 * $weighted) / ($n * $sum) - ($n + 1) / $n;
    }
}
