<?php

namespace App\Services\Matching\Embeddings;

use App\Contracts\EmbeddingProvider;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Embeddings via an OpenAI-compatible /embeddings endpoint (base_url is
 * configurable, so any compatible gateway works). Follows the codebase
 * convention of talking to third-party HTTP APIs through Laravel's Http client
 * (see TypesenseService / CloudApiAdapter).
 *
 * Returns [] on any failure so the matcher degrades to Layer 1 (exact/synonym)
 * rather than erroring — a missing embedding must never break search.
 */
class OpenAiEmbeddingProvider implements EmbeddingProvider
{
    private string $baseUrl;
    private string $apiKey;
    private string $model;
    private int $dimensions;
    private int $timeout;

    public function __construct()
    {
        $cfg = config('matching.embeddings.openai');
        $this->baseUrl    = rtrim($cfg['base_url'], '/');
        $this->apiKey     = (string) $cfg['api_key'];
        $this->model      = $cfg['model'];
        $this->dimensions = (int) $cfg['dimensions'];
        $this->timeout    = (int) $cfg['timeout'];
    }

    public function embed(array $texts): array
    {
        $texts = array_values(array_map(fn ($t) => (string) $t, $texts));
        if ($texts === [] || $this->apiKey === '') {
            return [];
        }

        try {
            $res = Http::baseUrl($this->baseUrl)
                ->withToken($this->apiKey)
                ->timeout($this->timeout)
                ->acceptJson()
                ->asJson()
                ->post('/embeddings', [
                    'model' => $this->model,
                    'input' => $texts,
                ]);

            if (! $res->successful()) {
                Log::warning('OpenAiEmbeddingProvider: non-2xx', ['status' => $res->status()]);
                return [];
            }

            // Response order is not guaranteed — re-order by `index`.
            $rows = collect($res->json('data', []))
                ->sortBy('index')
                ->pluck('embedding')
                ->map(fn ($v) => array_map('floatval', $v))
                ->all();

            return count($rows) === count($texts) ? $rows : [];
        } catch (\Throwable $e) {
            Log::warning('OpenAiEmbeddingProvider: request failed', ['error' => $e->getMessage()]);
            return [];
        }
    }

    public function model(): string
    {
        return 'openai:' . $this->model;
    }

    public function dimensions(): int
    {
        return $this->dimensions;
    }
}
