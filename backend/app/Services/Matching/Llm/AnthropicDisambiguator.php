<?php

namespace App\Services\Matching\Llm;

use App\Contracts\ServiceDisambiguator;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Layer 3 via Claude (Anthropic Messages API). Disambiguation is a SELECT-from-
 * a-short-list task, so a small/cheap model (Haiku) is the right tool — not a
 * large one (cost control).
 *
 * Constraint strategy: forced tool-use with a `strict` schema whose only field
 * is an array of refs drawn from an `enum` of the exact candidate refs, plus the
 * literal "none". The model therefore *cannot* emit a ref that isn't a real
 * candidate — and the caller validates the returned refs against the candidate
 * set again regardless (defence in depth: the LLM never invents a service).
 *
 * Talks to the API through Laravel's Http client (the codebase convention for
 * third-party HTTP — Typesense, WhatsApp Cloud API, Lipila). Any failure
 * returns [] so the matcher falls back to a clarify rather than erroring.
 */
class AnthropicDisambiguator implements ServiceDisambiguator
{
    public function select(string $query, array $candidates): array
    {
        if ($candidates === []) {
            return [];
        }

        $cfg    = config('matching.llm.anthropic');
        $apiKey = (string) ($cfg['api_key'] ?? '');
        if ($apiKey === '') {
            Log::info('AnthropicDisambiguator: no API key — returning none');
            return [];
        }

        $refs = array_column($candidates, 'ref');
        $enum = array_merge($refs, ['none']);

        $lines = [];
        foreach ($candidates as $c) {
            $lines[] = "- {$c['ref']}: {$c['label']} ({$c['subtitle']})";
        }
        $catalog = implode("\n", $lines);

        $tool = [
            'name'        => 'select_services',
            'description' => 'Return the ref(s) of the catalog item(s) that best match the customer request, chosen ONLY from the provided list. Return ["none"] if nothing in the list fits.',
            'input_schema' => [
                'type'                 => 'object',
                'additionalProperties' => false,
                'properties'           => [
                    'matches' => [
                        'type'  => 'array',
                        'items' => ['type' => 'string', 'enum' => $enum],
                    ],
                ],
                'required' => ['matches'],
            ],
        ];

        $prompt = "A customer typed this request for a local service:\n\n"
            . "\"{$query}\"\n\n"
            . "Here are the ONLY real catalog items you may choose from:\n{$catalog}\n\n"
            . "Pick the item(s) whose service best matches what the customer needs. "
            . "You may pick more than one if they are equally good. "
            . "Do not invent, rename, or describe anything not in the list. "
            . "If none of them fit, return [\"none\"].";

        try {
            $res = Http::baseUrl(rtrim($cfg['base_url'], '/'))
                ->timeout((int) $cfg['timeout'])
                ->withHeaders([
                    'x-api-key'         => $apiKey,
                    'anthropic-version' => $cfg['version'],
                    'content-type'      => 'application/json',
                ])
                ->post('/v1/messages', [
                    'model'       => $cfg['model'],
                    'max_tokens'  => (int) $cfg['max_tokens'],
                    'tools'       => [$tool],
                    'tool_choice' => ['type' => 'tool', 'name' => 'select_services'],
                    'messages'    => [['role' => 'user', 'content' => $prompt]],
                ]);

            if (! $res->successful()) {
                Log::warning('AnthropicDisambiguator: non-2xx', ['status' => $res->status()]);
                return [];
            }

            // Pull the forced tool_use block's input.matches.
            $matches = [];
            foreach ($res->json('content', []) as $block) {
                if (($block['type'] ?? null) === 'tool_use' && ($block['name'] ?? null) === 'select_services') {
                    $matches = $block['input']['matches'] ?? [];
                    break;
                }
            }

            // Validate: keep only refs that were genuinely offered; drop "none".
            $valid = array_values(array_intersect($matches, $refs));

            return $valid;
        } catch (\Throwable $e) {
            Log::warning('AnthropicDisambiguator: request failed', ['error' => $e->getMessage()]);
            return [];
        }
    }
}
