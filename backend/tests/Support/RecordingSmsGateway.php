<?php

namespace Tests\Support;

use App\Contracts\SmsGateway;

/**
 * Test SMS gateway that records every message instead of sending it, so a test
 * can read back the OTP it would have texted and complete the verify step.
 */
class RecordingSmsGateway implements SmsGateway
{
    /** @var array<int, array{to: string, message: string}> */
    public array $sent = [];

    public function send(string $e164Phone, string $message): bool
    {
        $this->sent[] = ['to' => $e164Phone, 'message' => $message];

        return true;
    }

    /** The 6-digit code from the most recent message to a number (or any). */
    public function lastOtp(?string $e164Phone = null): ?string
    {
        foreach (array_reverse($this->sent) as $msg) {
            if ($e164Phone !== null && $msg['to'] !== $e164Phone) {
                continue;
            }
            if (preg_match('/\b(\d{6})\b/', $msg['message'], $m)) {
                return $m[1];
            }
        }

        return null;
    }
}
