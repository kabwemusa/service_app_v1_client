<?php

namespace App\Services\Matching\Embeddings;

use App\Contracts\EmbeddingProvider;

/**
 * Deterministic, keyless pseudo-embedding: a hashed bag-of-tokens projected into
 * a fixed-dimension L2-normalised vector. Cosine similarity between two such
 * vectors reflects shared-token overlap, which gives the pipeline a real,
 * repeatable Layer 2 for local dev and tests without any API key or network.
 *
 * It is NOT a true semantic model — production should set
 * MATCHING_EMBEDDING_DRIVER=openai. But because each category's text carries its
 * synonyms, token overlap already resolves colloquial queries the exact layer
 * misses (e.g. "geyser leaking" overlaps Plumbing's "geyser"/"leaking tap").
 */
class HashEmbeddingProvider implements EmbeddingProvider
{
    private int $dimensions;

    public function __construct()
    {
        $this->dimensions = max(16, (int) config('matching.embeddings.hash.dimensions', 256));
    }

    public function embed(array $texts): array
    {
        return array_map(fn ($t) => $this->vectorize((string) $t), array_values($texts));
    }

    private function vectorize(string $text): array
    {
        $vec = array_fill(0, $this->dimensions, 0.0);

        foreach ($this->tokens($text) as $token => $weight) {
            $idx = crc32($token) % $this->dimensions;
            $vec[$idx] += $weight;
        }

        // L2 normalise so cosine == dot product.
        $norm = sqrt(array_sum(array_map(fn ($v) => $v * $v, $vec)));
        if ($norm > 0) {
            foreach ($vec as $i => $v) {
                $vec[$i] = $v / $norm;
            }
        }

        return $vec;
    }

    /**
     * Lowercase, split on non-alphanumerics, drop 1-char tokens, and add a crude
     * de-pluralised variant so "pipes"~"pipe" and "photos"~"photo" overlap.
     *
     * @return array<string, float>  token => weight
     */
    private function tokens(string $text): array
    {
        $parts = preg_split('/[^a-z0-9]+/', mb_strtolower(trim($text)), -1, PREG_SPLIT_NO_EMPTY) ?: [];
        $out   = [];

        foreach ($parts as $p) {
            if (mb_strlen($p) < 2) {
                continue;
            }
            $out[$p] = ($out[$p] ?? 0) + 1.0;

            // Light singularisation.
            $stem = null;
            if (str_ends_with($p, 'ies') && mb_strlen($p) > 3) {
                $stem = mb_substr($p, 0, -3) . 'y';
            } elseif (str_ends_with($p, 's') && ! str_ends_with($p, 'ss') && mb_strlen($p) > 3) {
                $stem = mb_substr($p, 0, -1);
            }
            if ($stem !== null && $stem !== $p) {
                $out[$stem] = ($out[$stem] ?? 0) + 0.6;
            }
        }

        return $out;
    }

    public function model(): string
    {
        return 'hash:v1:' . $this->dimensions;
    }

    public function dimensions(): int
    {
        return $this->dimensions;
    }
}
