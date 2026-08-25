<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Http;

/**
 * Read-only preflight for the Lipila integration.
 *
 * Lipila has no `/accounts` endpoint to enumerate (one key = one wallet), so the
 * useful check is different from the Lenco command this replaces: prove the key
 * authenticates, show the float, and — separately — prove the key's wallet is
 * authorised to DISBURSE, which is a distinct permission that fails with a bare
 * 401 and no body when it is missing.
 */
class LipilaPing extends Command
{
    protected $signature   = 'lipila:ping';
    protected $description = 'Check Lipila connectivity, wallet balance, and disbursement authorisation.';

    public function handle(): int
    {
        $baseUrl = rtrim((string) config('lipila.base_url'), '/');
        $apiKey  = (string) config('lipila.api_key');
        $disbKey = (string) (config('lipila.disbursement_api_key') ?: $apiKey);

        if ($apiKey === '') {
            $this->error('LIPILA_API_KEY is not set.');
            return self::FAILURE;
        }

        $this->line("Base URL: <comment>{$baseUrl}</comment>");
        $this->line('Enabled:  ' . (config('lipila.enabled') ? '<info>yes</info>' : '<comment>no (stub gateway bound)</comment>'));
        $this->newLine();

        // ── 1. Collections key: balance read ────────────────────────────────
        $this->line("GET {$baseUrl}/api/v1/merchants/balance");

        $response = Http::withHeaders(['x-api-key' => $apiKey])
            ->acceptJson()->timeout(20)
            ->get("{$baseUrl}/api/v1/merchants/balance");

        if ($response->failed()) {
            $this->error("Lipila returned {$response->status()}: " . ($response->body() ?: '(empty body)'));
            $this->line('  A 401 here means the key does not match this environment '
                . '(sandbox keys only work against api.lipila.dev).');
            return self::FAILURE;
        }

        $balance = $response->json('data.balance');
        $this->info('✔ Authenticated. Wallet balance: ' . number_format((float) $balance, 4)
            . ' ' . config('lipila.currency', 'ZMW'));

        // ── 2. Disbursement key: authorisation probe ────────────────────────
        // Deliberately malformed (empty MSISDN) so nothing can move: a 400 proves
        // the wallet IS authorised and we merely failed validation, while a 401
        // proves it is not. Sending a well-formed body here would risk a payout.
        $this->newLine();
        $this->line("POST {$baseUrl}/api/v1/disbursements/mobile-money  (validation probe — no money moves)");

        $probe = Http::withHeaders(['x-api-key' => $disbKey])
            ->acceptJson()->timeout(20)
            ->post("{$baseUrl}/api/v1/disbursements/mobile-money", [
                'referenceId'   => 'ping-' . uniqid(),
                'amount'        => 0,
                'narration'     => 'authorisation probe',
                'accountNumber' => '',
                'currency'      => config('lipila.currency', 'ZMW'),
            ]);

        match (true) {
            $probe->status() === 401 => $this->warnDisbursementUnauthorised(),
            $probe->status() === 400 => $this->info('✔ Disbursements authorised (validation rejected the probe, as intended).'),
            default                  => $this->warn("? Disbursement probe returned {$probe->status()}: " . substr($probe->body(), 0, 200)),
        };

        return self::SUCCESS;
    }

    private function warnDisbursementUnauthorised(): void
    {
        $this->error('✘ Disbursements NOT authorised for this key (401).');
        $this->line('  Payouts and refunds will fail until this is resolved. Either the merchant');
        $this->line('  wallet has not been enabled for disbursements, or Lipila issues a separate');
        $this->line('  disbursement-wallet key — set it as LIPILA_DISBURSEMENT_API_KEY.');
    }
}
