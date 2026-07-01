<?php

namespace App\Services\Gateway;

use App\Contracts\SmsGateway;
use Illuminate\Support\Facades\Log;

/**
 * Development / test SMS gateway: logs the message instead of sending it.
 *
 * The OTP is written to the log so a developer can complete the phone-OTP flow
 * locally without a live SMS provider. Production binds a real adapter
 * (Africa's Talking) in AppServiceProvider.
 */
class LogSmsGateway implements SmsGateway
{
    public function send(string $e164Phone, string $message): bool
    {
        Log::info('[SMS:stub] outbound message', [
            'to'      => $e164Phone,
            'message' => $message,
        ]);

        return true;
    }
}
