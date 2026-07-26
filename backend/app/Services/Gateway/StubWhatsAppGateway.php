<?php

namespace App\Services\Gateway;

use App\Contracts\WhatsAppGateway;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

class StubWhatsAppGateway implements WhatsAppGateway
{
    public function sendText(string $to, string $text): string
    {
        $msgId = 'wamid.stub.' . Str::random(20);
        Log::info('StubWhatsAppGateway::sendText', compact('to', 'text', 'msgId'));
        return $msgId;
    }

    public function sendTemplate(
        string $to,
        string $templateName,
        string $languageCode,
        array  $components = [],
    ): string {
        $msgId = 'wamid.stub.' . Str::random(20);
        Log::info('StubWhatsAppGateway::sendTemplate', compact('to', 'templateName', 'languageCode', 'msgId'));
        return $msgId;
    }

    public function sendInteractive(string $to, array $interactive): string
    {
        $msgId = 'wamid.stub.' . Str::random(20);
        Log::info('StubWhatsAppGateway::sendInteractive', compact('to', 'msgId'));
        return $msgId;
    }

    public function sendLocationRequest(string $to, string $body): string
    {
        $msgId = 'wamid.stub.' . Str::random(20);
        Log::info('StubWhatsAppGateway::sendLocationRequest', compact('to', 'body', 'msgId'));
        return $msgId;
    }

    public function sendLocation(string $to, float $lat, float $lng, string $name, string $address): string
    {
        $msgId = 'wamid.stub.' . Str::random(20);
        Log::info('StubWhatsAppGateway::sendLocation', compact('to', 'lat', 'lng', 'name', 'msgId'));
        return $msgId;
    }

    public function sendImage(string $to, string $imageUrl, ?string $caption = null): string
    {
        $msgId = 'wamid.stub.' . Str::random(20);
        Log::info('StubWhatsAppGateway::sendImage', compact('to', 'imageUrl', 'msgId'));
        return $msgId;
    }

    public function sendDocument(string $to, string $documentUrl, string $filename, ?string $caption = null): string
    {
        $msgId = 'wamid.stub.' . Str::random(20);
        Log::info('StubWhatsAppGateway::sendDocument', compact('to', 'filename', 'msgId'));
        return $msgId;
    }

    public function markRead(string $messageId, bool $typing = false): bool
    {
        Log::info('StubWhatsAppGateway::markRead', compact('messageId', 'typing'));
        return true;
    }
}
