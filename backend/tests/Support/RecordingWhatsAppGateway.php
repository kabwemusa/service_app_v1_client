<?php

namespace Tests\Support;

use App\Contracts\WhatsAppGateway;
use Illuminate\Support\Str;

/**
 * Test double that records every outbound call so assertions can verify the WhatsApp
 * UX behaviour (images, location pins, typing indicator) without a live Meta number.
 */
class RecordingWhatsAppGateway implements WhatsAppGateway
{
    /** @var array<int, array<string, mixed>> */
    public array $calls = [];

    public function sendText(string $to, string $text): string
    {
        return $this->record('text', compact('to', 'text'));
    }

    public function sendTemplate(string $to, string $templateName, string $languageCode, array $components = []): string
    {
        return $this->record('template', compact('to', 'templateName', 'languageCode', 'components'));
    }

    public function sendInteractive(string $to, array $interactive): string
    {
        return $this->record('interactive', compact('to', 'interactive'));
    }

    public function sendLocationRequest(string $to, string $body): string
    {
        return $this->record('location_request', compact('to', 'body'));
    }

    public function sendLocation(string $to, float $lat, float $lng, string $name, string $address): string
    {
        return $this->record('location', compact('to', 'lat', 'lng', 'name', 'address'));
    }

    public function sendImage(string $to, string $imageUrl, ?string $caption = null): string
    {
        return $this->record('image', compact('to', 'imageUrl', 'caption'));
    }

    public function markRead(string $messageId, bool $typing = false): bool
    {
        $this->record('mark_read', compact('messageId', 'typing'));
        return true;
    }

    /** @return array<int, array<string, mixed>> */
    public function callsOfType(string $type): array
    {
        return array_values(array_filter($this->calls, fn ($c) => $c['type'] === $type));
    }

    public function hasCallOfType(string $type): bool
    {
        return $this->callsOfType($type) !== [];
    }

    private function record(string $type, array $data): string
    {
        $this->calls[] = ['type' => $type] + $data;
        return 'wamid.rec.' . Str::random(16);
    }
}
