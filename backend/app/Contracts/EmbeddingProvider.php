<?php

namespace App\Contracts;

/**
 * Turns text into vectors for the matcher's semantic layer. Implementations are
 * swappable via config('matching.embeddings.driver') and bound in
 * MatchingServiceProvider.
 */
interface EmbeddingProvider
{
    /**
     * Embed a batch of strings.
     *
     * @param  string[] $texts
     * @return array<int, array<int, float>>  One vector per input, same order.
     *                                         Empty array on failure (callers degrade gracefully).
     */
    public function embed(array $texts): array;

    /** Model identifier — stored per row so vectors are only compared within one model. */
    public function model(): string;

    public function dimensions(): int;
}
