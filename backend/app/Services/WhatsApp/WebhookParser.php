<?php

namespace App\Services\WhatsApp;

class WebhookParser
{
    public static function parse(array $payload): ?array
    {
        $entry = $payload['entry'][0] ?? null;
        if (! $entry) return null;

        $change = $entry['changes'][0] ?? null;
        if (! $change || ($change['field'] ?? '') !== 'messages') return null;

        $value = $change['value'] ?? [];

        if (! empty($value['statuses'])) {
            return [
                'type'     => 'status',
                'statuses' => $value['statuses'],
            ];
        }

        $message = $value['messages'][0] ?? null;
        if (! $message) return null;

        $contact = $value['contacts'][0] ?? null;

        $base = [
            'message_id'  => $message['id'],
            'from'        => $message['from'],
            'timestamp'   => $message['timestamp'],
            'sender_name' => $contact['profile']['name'] ?? null,
        ];

        $msgType = $message['type'] ?? 'unknown';

        return match ($msgType) {
            'text'        => array_merge($base, self::parseText($message)),
            'interactive' => array_merge($base, self::parseInteractive($message)),
            'location'    => array_merge($base, self::parseLocation($message)),
            'image'       => array_merge($base, self::parseImage($message)),
            default       => array_merge($base, ['type' => 'unsupported', 'raw_type' => $msgType]),
        };
    }

    private static function parseText(array $message): array
    {
        return [
            'type' => 'text',
            'text' => $message['text']['body'] ?? '',
        ];
    }

    private static function parseInteractive(array $message): array
    {
        $interactive = $message['interactive'] ?? [];
        $interactiveType = $interactive['type'] ?? '';

        if ($interactiveType === 'button_reply') {
            return [
                'type'      => 'button_reply',
                'button_id' => $interactive['button_reply']['id'] ?? '',
                'title'     => $interactive['button_reply']['title'] ?? '',
            ];
        }

        if ($interactiveType === 'list_reply') {
            return [
                'type'    => 'list_reply',
                'list_id' => $interactive['list_reply']['id'] ?? '',
                'title'   => $interactive['list_reply']['title'] ?? '',
            ];
        }

        return ['type' => 'unsupported', 'raw_type' => 'interactive:' . $interactiveType];
    }

    private static function parseLocation(array $message): array
    {
        $loc = $message['location'] ?? [];
        return [
            'type'      => 'location',
            'latitude'  => (float) ($loc['latitude'] ?? 0),
            'longitude' => (float) ($loc['longitude'] ?? 0),
            'name'      => $loc['name'] ?? null,
            'address'   => $loc['address'] ?? null,
        ];
    }

    private static function parseImage(array $message): array
    {
        $img = $message['image'] ?? [];
        return [
            'type'     => 'image',
            'image_id' => $img['id'] ?? '',
            'mime'     => $img['mime_type'] ?? '',
            'caption'  => $img['caption'] ?? null,
        ];
    }
}
