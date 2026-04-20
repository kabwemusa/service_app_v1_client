<?php

namespace App\Services;

use App\Models\Service;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Lightweight Typesense client using Laravel's HTTP client.
 * No external PHP package required — communicates directly with Typesense REST API.
 *
 * Falls back gracefully (returns null / empty array) when Typesense is unreachable,
 * allowing SearchService to fall back to PostgreSQL ILIKE text search.
 */
class TypesenseService
{
    private string $baseUrl;
    private string $apiKey;
    private int    $timeout;
    private string $collection;

    public function __construct()
    {
        $cfg = config('search.typesense');

        $this->baseUrl    = "{$cfg['protocol']}://{$cfg['host']}:{$cfg['port']}";
        $this->apiKey     = $cfg['api_key'];
        $this->timeout    = $cfg['connection_timeout_seconds'];
        $this->collection = $cfg['collection'];
    }

    // ── Collection management ────────────────────────────────────────────────

    /**
     * Create the services collection if it does not already exist.
     * Idempotent — safe to call on every deploy / sync.
     */
    public function ensureCollection(): bool
    {
        try {
            $res = $this->http()->get("/collections/{$this->collection}");

            if ($res->successful()) {
                return true; // already exists
            }

            // 404 → create it
            $schema = [
                'name'   => $this->collection,
                'fields' => [
                    ['name' => 'id',            'type' => 'string'],
                    ['name' => 'title',          'type' => 'string'],
                    ['name' => 'description',    'type' => 'string', 'optional' => true],
                    ['name' => 'category_id',    'type' => 'int32'],
                    ['name' => 'category_name',  'type' => 'string'],
                    ['name' => 'provider_id',    'type' => 'string'],
                    ['name' => 'base_price',     'type' => 'float'],
                    ['name' => 'is_active',      'type' => 'bool'],
                ],
                'default_sorting_field' => 'base_price',
            ];

            $create = $this->http()->post('/collections', $schema);

            return $create->successful();
        } catch (ConnectionException $e) {
            Log::warning('TypesenseService::ensureCollection — Typesense unreachable', [
                'error' => $e->getMessage(),
            ]);
            return false;
        }
    }

    /**
     * Upsert (create or update) a single service document in Typesense.
     */
    public function upsertService(Service $service): bool
    {
        $doc = $this->toDocument($service);

        if ($doc === null) {
            return false;
        }

        try {
            $res = $this->http()
                ->post("/collections/{$this->collection}/documents?action=upsert", $doc);

            return $res->successful();
        } catch (ConnectionException $e) {
            Log::warning('TypesenseService::upsertService — Typesense unreachable', [
                'service_id' => $service->id,
                'error'      => $e->getMessage(),
            ]);
            return false;
        }
    }

    /**
     * Delete a service document from Typesense (call on service delete).
     */
    public function deleteService(string $serviceId): bool
    {
        try {
            $res = $this->http()
                ->delete("/collections/{$this->collection}/documents/{$serviceId}");

            return $res->successful() || $res->status() === 404;
        } catch (ConnectionException $e) {
            Log::warning('TypesenseService::deleteService — Typesense unreachable', [
                'service_id' => $serviceId,
                'error'      => $e->getMessage(),
            ]);
            return false;
        }
    }

    /**
     * Bulk-import all active services into Typesense.
     * Drops and recreates the collection for a clean sync.
     * Called by `php artisan typesense:sync`.
     *
     * @return array{indexed: int, errors: int}
     */
    public function bulkSync(): array
    {
        try {
            // Drop existing collection (ignore 404)
            $this->http()->delete("/collections/{$this->collection}");

            $this->ensureCollection();

            $services = Service::with('category')
                ->where('is_active', true)
                ->cursor();

            $batch   = [];
            $indexed = 0;
            $errors  = 0;

            foreach ($services as $service) {
                $doc = $this->toDocument($service);
                if ($doc !== null) {
                    $batch[] = json_encode($doc);
                }

                if (count($batch) >= 100) {
                    [$ok, $err] = $this->importBatch($batch);
                    $indexed += $ok;
                    $errors  += $err;
                    $batch    = [];
                }
            }

            if (! empty($batch)) {
                [$ok, $err] = $this->importBatch($batch);
                $indexed += $ok;
                $errors  += $err;
            }

            return ['indexed' => $indexed, 'errors' => $errors];
        } catch (ConnectionException $e) {
            Log::error('TypesenseService::bulkSync — Typesense unreachable', [
                'error' => $e->getMessage(),
            ]);
            return ['indexed' => 0, 'errors' => -1];
        }
    }

    // ── Search ───────────────────────────────────────────────────────────────

    /**
     * Run a text search against Typesense and return matching service IDs.
     * Returns null when Typesense is unavailable so the caller can fall back.
     *
     * @param  string    $query
     * @param  int|null  $categoryId
     * @return string[]|null  Array of service UUIDs, or null on failure.
     */
    public function search(string $query, ?int $categoryId = null): ?array
    {
        if (trim($query) === '') {
            return null;
        }

        try {
            $params = [
                'q'          => $query,
                'query_by'   => 'title,description,category_name',
                'filter_by'  => 'is_active:true' . ($categoryId ? " && category_id:{$categoryId}" : ''),
                'per_page'   => 250, // get broad set; spatial + ranking will narrow it
                'page'       => 1,
            ];

            $res = $this->http()
                ->timeout($this->timeout)
                ->get("/collections/{$this->collection}/documents/search", $params);

            if (! $res->successful()) {
                return null;
            }

            $hits = $res->json('hits', []);

            return array_map(fn ($hit) => $hit['document']['id'], $hits);
        } catch (ConnectionException $e) {
            Log::info('TypesenseService::search — Typesense unavailable, will fall back to DB', [
                'query' => $query,
                'error' => $e->getMessage(),
            ]);
            return null;
        }
    }

    // ── Private helpers ──────────────────────────────────────────────────────

    private function http()
    {
        return Http::baseUrl($this->baseUrl)
            ->timeout($this->timeout)
            ->withHeader('X-TYPESENSE-API-KEY', $this->apiKey)
            ->acceptJson()
            ->asJson();
    }

    private function toDocument(Service $service): ?array
    {
        if (! $service->relationLoaded('category')) {
            $service->load('category');
        }

        return [
            'id'           => $service->id,
            'title'        => $service->title,
            'description'  => $service->description ?? '',
            'category_id'  => (int) $service->category_id,
            'category_name'=> $service->category?->name ?? '',
            'provider_id'  => $service->provider_id,
            'base_price'   => (float) $service->base_price,
            'is_active'    => (bool) $service->is_active,
        ];
    }

    /**
     * @param  string[]  $jsonLines  JSONL lines
     * @return array{0: int, 1: int}  [indexed_count, error_count]
     */
    private function importBatch(array $jsonLines): array
    {
        $body = implode("\n", $jsonLines);

        $res = Http::baseUrl($this->baseUrl)
            ->timeout($this->timeout)
            ->withHeader('X-TYPESENSE-API-KEY', $this->apiKey)
            ->withBody($body, 'text/plain')
            ->post("/collections/{$this->collection}/documents/import?action=upsert");

        $indexed = 0;
        $errors  = 0;

        foreach (explode("\n", $res->body()) as $line) {
            if (trim($line) === '') {
                continue;
            }
            $result = json_decode($line, true);
            if (($result['success'] ?? false)) {
                $indexed++;
            } else {
                $errors++;
            }
        }

        return [$indexed, $errors];
    }
}
