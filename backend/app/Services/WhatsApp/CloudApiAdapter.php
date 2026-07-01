<?php

namespace App\Services\WhatsApp;

use App\Contracts\WhatsAppGateway;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use RuntimeException;

class CloudApiAdapter implements WhatsAppGateway
{
    private string $baseUrl;
    private string $token;
    private string $phoneNumberId;

    public function __construct()
    {
        $version             = config('whatsapp.graph_api_version', 'v21.0');
        $this->phoneNumberId = config('whatsapp.phone_number_id');
        $this->token         = config('whatsapp.access_token');
        $this->baseUrl       = "https://graph.facebook.com/{$version}/{$this->phoneNumberId}";
    }

    public function sendText(string $to, string $text): string
    {
        return $this->send([
            'messaging_product' => 'whatsapp',
            'to'                => $to,
            'type'              => 'text',
            'text'              => ['body' => $text],
        ]);
    }

    public function sendTemplate(
        string $to,
        string $templateName,
        string $languageCode,
        array  $components = [],
    ): string {
        $payload = [
            'messaging_product' => 'whatsapp',
            'to'                => $to,
            'type'              => 'template',
            'template'          => [
                'name'     => $templateName,
                'language' => ['code' => $languageCode],
            ],
        ];

        if (! empty($components)) {
            $payload['template']['components'] = $components;
        }

        return $this->send($payload);
    }

    public function sendInteractive(string $to, array $interactive): string
    {
        return $this->send([
            'messaging_product' => 'whatsapp',
            'to'                => $to,
            'type'              => 'interactive',
            'interactive'       => $interactive,
        ]);
    }

    public function sendLocationRequest(string $to, string $body): string
    {
        return $this->send([
            'messaging_product' => 'whatsapp',
            'recipient_type'    => 'individual',
            'to'                => $to,
            'type'              => 'interactive',
            'interactive'       => MessageBuilder::locationRequest($body),
        ]);
    }

    public function sendLocation(string $to, float $lat, float $lng, string $name, string $address): string
    {
        return $this->send([
            'messaging_product' => 'whatsapp',
            'to'                => $to,
            'type'              => 'location',
            'location'          => [
                'latitude'  => $lat,
                'longitude' => $lng,
                'name'      => $name,
                'address'   => $address,
            ],
        ]);
    }

    public function sendImage(string $to, string $imageUrl, ?string $caption = null): string
    {
        $image = ['link' => $imageUrl];
        if ($caption) {
            $image['caption'] = $caption;
        }

        return $this->send([
            'messaging_product' => 'whatsapp',
            'to'                => $to,
            'type'              => 'image',
            'image'             => $image,
        ]);
    }

    public function markRead(string $messageId, bool $typing = false): bool
    {
        $payload = [
            'messaging_product' => 'whatsapp',
            'status'            => 'read',
            'message_id'        => $messageId,
        ];

        if ($typing) {
            // Piggybacks the typing indicator on the read receipt — shows "typing…"
            // for ~25s or until the next outbound message is delivered.
            $payload['typing_indicator'] = ['type' => 'text'];
        }

        try {
            Http::withToken($this->token)
                ->post("{$this->baseUrl}/messages", $payload);
            return true;
        } catch (\Throwable $e) {
            Log::warning('CloudApiAdapter::markRead failed', ['message_id' => $messageId, 'error' => $e->getMessage()]);
            return false;
        }
    }

    private function send(array $payload): string
    {
        $response = Http::withToken($this->token)
            ->post("{$this->baseUrl}/messages", $payload);

        if (! $response->successful()) {
            Log::error('WhatsApp API error', [
                'status'  => $response->status(),
                'body'    => $response->body(),
                'payload' => $payload,
            ]);
            throw new RuntimeException('WhatsApp API returned ' . $response->status() . ': ' . $response->body());
        }

        $msgId = $response->json('messages.0.id');

        if (! $msgId) {
            Log::error('WhatsApp API: no message ID in response', ['body' => $response->body()]);
            throw new RuntimeException('WhatsApp API returned no message ID');
        }

        return $msgId;
    }
}
