<?php

namespace App\Contracts;

/**
 * Layer 3 — chooses the best match(es) from a fixed set of REAL candidates the
 * matcher already retrieved. Implementations MUST only ever return refs that
 * were in the input; the caller validates this again and discards anything else.
 * The disambiguator never invents, renames, or describes a service.
 */
interface ServiceDisambiguator
{
    /**
     * @param  string $query      The customer's raw query.
     * @param  array<int, array{ref: string, label: string, subtitle: string}> $candidates
     * @return string[]  Chosen candidate refs (subset of the input refs), or [] for "none".
     */
    public function select(string $query, array $candidates): array;
}
