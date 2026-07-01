<?php

namespace App\Services\WhatsApp;

use InvalidArgumentException;

class MessageBuilder
{
    /**
     * Build an interactive button message. When $imageUrl is provided the message gets an
     * image header (button messages support image/text headers — lists do not), turning a
     * plain prompt into a picture-led card. A text $header is ignored if $imageUrl is set.
     */
    public static function replyButtons(
        string $body,
        array $buttons,
        ?string $header = null,
        ?string $footer = null,
        ?string $imageUrl = null,
    ): array {
        if (count($buttons) > 3) {
            throw new InvalidArgumentException('WhatsApp reply buttons hard cap is 3. Got ' . count($buttons));
        }

        $action = [
            'buttons' => array_map(fn (array $btn) => [
                'type'  => 'reply',
                'reply' => [
                    'id'    => substr($btn['id'], 0, 256),
                    'title' => substr($btn['title'], 0, 20),
                ],
            ], $buttons),
        ];

        $interactive = [
            'type' => 'button',
            'body' => ['text' => substr($body, 0, 1024)],
            'action' => $action,
        ];

        if ($imageUrl) {
            $interactive['header'] = ['type' => 'image', 'image' => ['link' => $imageUrl]];
        } elseif ($header) {
            $interactive['header'] = ['type' => 'text', 'text' => substr($header, 0, 60)];
        }
        if ($footer) {
            $interactive['footer'] = ['text' => substr($footer, 0, 60)];
        }

        return $interactive;
    }

    public static function listMessage(
        string $body,
        string $buttonText,
        array $sections,
        ?string $header = null,
        ?string $footer = null,
    ): array {
        $totalRows = 0;
        foreach ($sections as $section) {
            $totalRows += count($section['rows'] ?? []);
        }
        if ($totalRows > 10) {
            throw new InvalidArgumentException("WhatsApp list hard cap is 10 rows total. Got {$totalRows}");
        }

        $formattedSections = array_map(function (array $section) {
            return [
                'title' => substr($section['title'] ?? '', 0, 24),
                'rows'  => array_map(fn (array $row) => [
                    'id'          => substr($row['id'], 0, 200),
                    'title'       => substr($row['title'], 0, 24),
                    'description' => isset($row['description']) ? substr($row['description'], 0, 72) : null,
                ], $section['rows'] ?? []),
            ];
        }, $sections);

        $interactive = [
            'type' => 'list',
            'body' => ['text' => substr($body, 0, 1024)],
            'action' => [
                'button'   => substr($buttonText, 0, 20),
                'sections' => $formattedSections,
            ],
        ];

        if ($header) {
            $interactive['header'] = ['type' => 'text', 'text' => substr($header, 0, 60)];
        }
        if ($footer) {
            $interactive['footer'] = ['text' => substr($footer, 0, 60)];
        }

        return $interactive;
    }

    public static function locationRequest(string $body): array
    {
        return [
            'type' => 'location_request_message',
            'body' => ['text' => substr($body, 0, 1024)],
            'action' => ['name' => 'send_location'],
        ];
    }

    public static function menuButtons(): array
    {
        return self::replyButtons(
            "Welcome to Sebenza! How can we help you today?\n\nChoose an option below:",
            [
                ['id' => 'menu_browse',   'title' => 'Browse Services'],
                ['id' => 'menu_book_now', 'title' => 'Book Now'],
                ['id' => 'menu_my_bookings', 'title' => 'My Bookings'],
            ],
            'Sebenza',
        );
    }

    public static function categoryList(array $categories): array
    {
        $rows = [];
        foreach ($categories as $cat) {
            $rows[] = [
                'id'          => 'cat_' . $cat['id'],
                'title'       => $cat['name'],
                'description' => $cat['description'] ?? null,
            ];
            if (count($rows) >= 10) break;
        }

        return self::listMessage(
            'Choose a category to browse:',
            'Categories',
            [['title' => 'Categories', 'rows' => $rows]],
            'Browse Services',
        );
    }

    public static function serviceCards(array $services, bool $hasMore = false): array
    {
        $rows = [];
        foreach ($services as $svc) {
            $price = isset($svc['min_price']) ? 'From K' . number_format($svc['min_price'], 0) : 'Get quote';
            $rows[] = [
                'id'          => 'svc_' . $svc['id'],
                'title'       => $svc['name'],
                'description' => $price,
            ];
            if (count($rows) >= 9) break;
        }

        if ($hasMore && count($rows) < 10) {
            $rows[] = [
                'id'    => 'see_more',
                'title' => 'See more...',
            ];
        }

        return self::listMessage(
            'Here are the services available. Tap one for details:',
            'Services',
            [['title' => 'Services', 'rows' => $rows]],
        );
    }

    public static function serviceDetail(array $service, array $trustSurface): string
    {
        $lines = [];
        $lines[] = "*{$service['name']}*";
        $lines[] = '';

        if (! empty($service['description'])) {
            $lines[] = $service['description'];
            $lines[] = '';
        }

        $price = isset($service['min_price']) ? 'From K' . number_format($service['min_price'], 0) : 'Quote-based';
        $lines[] = "Price: {$price}";

        if (! empty($service['provider_count'])) {
            $lines[] = "Providers: {$service['provider_count']} available";
        }

        if (! empty($trustSurface['tier_label'])) {
            $lines[] = "Trust: {$trustSurface['tier_label']}";
        }

        if (! empty($trustSurface['verified_facts'])) {
            foreach ($trustSurface['verified_facts'] as $fact) {
                $lines[] = "  - {$fact}";
            }
        }

        return implode("\n", $lines);
    }

    public static function dateList(array $dates): array
    {
        $rows = [];
        foreach ($dates as $date) {
            $slotCount = count($date['slots'] ?? []);
            $rows[] = [
                'id'          => 'date_' . $date['date'],
                'title'       => $date['day'] . ', ' . $date['date'],
                'description' => "{$slotCount} slot(s) available",
            ];
            if (count($rows) >= 10) break;
        }

        if (empty($rows)) {
            return self::replyButtons(
                'No available dates in the next 2 weeks. Would you like to try a different service?',
                [
                    ['id' => 'back_browse', 'title' => 'Browse again'],
                    ['id' => 'back_menu',   'title' => 'Main menu'],
                ],
            );
        }

        return self::listMessage(
            'Pick a date for your booking:',
            'Available Dates',
            [['title' => 'Dates', 'rows' => $rows]],
            'Choose a Date',
        );
    }

    public static function slotList(array $slots, string $date): array
    {
        $rows = [];
        foreach ($slots as $slot) {
            $rows[] = [
                'id'    => 'slot_' . $slot['start'] . '_' . $slot['end'],
                'title' => $slot['start'] . ' - ' . $slot['end'],
            ];
            if (count($rows) >= 10) break;
        }

        return self::listMessage(
            "Available time slots for {$date}:",
            'Time Slots',
            [['title' => 'Slots', 'rows' => $rows]],
        );
    }

    public static function shortlistButtons(array $providers): array
    {
        $buttons = [];
        foreach (array_slice($providers, 0, 3) as $p) {
            $price = isset($p['price']) ? ' - K' . number_format($p['price'], 0) : '';
            $buttons[] = [
                'id'    => 'provider_' . $p['provider_id'],
                'title' => substr(($p['name'] ?? 'Provider') . $price, 0, 20),
            ];
        }

        return self::replyButtons(
            "We found providers for your request! Choose one to proceed:",
            $buttons,
            'Available Providers',
        );
    }

    public static function providerOffer(array $booking, ?string $imageUrl = null): array
    {
        $lines = [];
        $lines[] = "*New Job Request*";
        $lines[] = '';
        $lines[] = "Service: {$booking['service_title']}";
        $lines[] = "Date: {$booking['scheduled_start']}";
        $lines[] = "Location: {$booking['delivery_label']}";
        $lines[] = "Amount: K" . number_format($booking['amount'], 2);
        $lines[] = '';
        $lines[] = 'Respond within the time limit.';

        return self::replyButtons(
            implode("\n", $lines),
            [
                ['id' => 'offer_accept_' . $booking['booking_id'], 'title' => 'Accept'],
                ['id' => 'offer_decline_' . $booking['booking_id'], 'title' => 'Decline'],
            ],
            imageUrl: $imageUrl,
        );
    }

    public static function paymentPrompt(array $booking): string
    {
        $total = (float) ($booking['amount'] ?? 0) + (float) ($booking['buyer_protection_fee'] ?? 0);

        $lines = [];
        $lines[] = "*Payment Required*";
        $lines[] = '';
        $lines[] = "Service: {$booking['service_title']}";
        $lines[] = "Total: K" . number_format($total, 2);
        $lines[] = '';
        $lines[] = 'You will receive a Mobile Money prompt on your phone. Please approve the payment to confirm your booking.';
        $lines[] = '';
        $lines[] = "_Payment window: 30 minutes_";

        return implode("\n", $lines);
    }

    public static function bookingConfirmation(array $booking, ?string $providerPhone = null): string
    {
        $lines = [];
        $lines[] = "*Booking Confirmed!*";
        $lines[] = '';
        $lines[] = "Service: {$booking['service_title']}";
        $lines[] = "Date: {$booking['scheduled_start']}";
        $lines[] = "Location: {$booking['delivery_label']}";

        if ($providerPhone) {
            $lines[] = "Provider contact: {$providerPhone}";
        }

        $lines[] = '';
        $lines[] = 'Your provider has been notified and will be in touch.';

        return implode("\n", $lines);
    }
}
