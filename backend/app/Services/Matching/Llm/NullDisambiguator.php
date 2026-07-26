<?php

namespace App\Services\Matching\Llm;

use App\Contracts\ServiceDisambiguator;

/**
 * Keyless fallback disambiguator (default in tests/dev). It does NOT call any
 * model — it defers to the semantic ordering the matcher already computed by
 * picking the single top candidate. The matcher only reaches Layer 3 when
 * results are low-confidence or tied, so returning the top candidate here yields
 * a "best guess" the confidence gate can still downgrade to a clarify.
 *
 * Because it returns only refs from the input, it can never invent a service.
 */
class NullDisambiguator implements ServiceDisambiguator
{
    public function select(string $query, array $candidates): array
    {
        return $candidates === [] ? [] : [$candidates[0]['ref']];
    }
}
