<?php

namespace App\Jobs;

use App\Models\IdentityDocument;
use App\Models\User;
use App\Services\KycService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

class VerifyIdentityDocumentJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries   = 3;
    public int $timeout = 120;

    public function __construct(
        public readonly string $documentId,
        public readonly string $userId,
    ) {}

    public function handle(KycService $kycService): void
    {
        $doc  = IdentityDocument::find($this->documentId);
        $user = User::find($this->userId);

        if (!$doc || !$user) {
            Log::warning('VerifyIdentityDocumentJob: document or user not found', [
                'document_id' => $this->documentId,
                'user_id'     => $this->userId,
            ]);
            return;
        }

        $kycService->runVerificationPipeline($doc, $user);
    }

    public function failed(\Throwable $e): void
    {
        Log::error('VerifyIdentityDocumentJob failed permanently', [
            'document_id' => $this->documentId,
            'user_id'     => $this->userId,
            'error'       => $e->getMessage(),
        ]);
    }
}
