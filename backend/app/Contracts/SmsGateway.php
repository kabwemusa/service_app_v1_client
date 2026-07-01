<?php

namespace App\Contracts;

/**
 * Outbound SMS channel — the rail OTP codes travel on for phone-first auth.
 *
 * Kept behind an interface (like PaymentGateway / WhatsAppGateway) so the
 * domain never depends on a concrete provider. Dev/test uses LogSmsGateway;
 * production swaps in an Africa's Talking adapter without touching AuthService.
 */
interface SmsGateway
{
    /**
     * Send a plain-text SMS to an E.164 number.
     *
     * @return bool  true when the message was accepted for delivery.
     */
    public function send(string $e164Phone, string $message): bool;
}
