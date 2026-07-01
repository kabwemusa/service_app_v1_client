<?php

namespace App\Contracts;

interface WhatsAppGateway
{
    /**
     * Send a text message to a WhatsApp user.
     *
     * @param  string  $to       Recipient WhatsApp ID (phone number)
     * @param  string  $text     Message body
     * @return string  Message ID from the API
     */
    public function sendText(string $to, string $text): string;

    /**
     * Send a pre-approved template message (outside 24h window).
     *
     * @param  string  $to              Recipient WhatsApp ID
     * @param  string  $templateName    Approved template name
     * @param  string  $languageCode    e.g. 'en'
     * @param  array   $components      Template variable components
     * @return string  Message ID
     */
    public function sendTemplate(
        string $to,
        string $templateName,
        string $languageCode,
        array  $components = [],
    ): string;

    /**
     * Send an interactive message (buttons or list).
     *
     * @param  string  $to           Recipient WhatsApp ID
     * @param  array   $interactive  Interactive message payload
     * @return string  Message ID
     */
    public function sendInteractive(string $to, array $interactive): string;

    /**
     * Send a location-request message prompting the user to share their pin.
     *
     * @param  string  $to    Recipient WhatsApp ID
     * @param  string  $body  Prompt text
     * @return string  Message ID
     */
    public function sendLocationRequest(string $to, string $body): string;

    /**
     * Send a location message (e.g. provider-on-the-way pin).
     *
     * @param  string  $to
     * @param  float   $lat
     * @param  float   $lng
     * @param  string  $name
     * @param  string  $address
     * @return string  Message ID
     */
    public function sendLocation(string $to, float $lat, float $lng, string $name, string $address): string;

    /**
     * Send an image message.
     *
     * @param  string       $to
     * @param  string       $imageUrl
     * @param  string|null  $caption
     * @return string  Message ID
     */
    public function sendImage(string $to, string $imageUrl, ?string $caption = null): string;

    /**
     * Mark a received message as read, optionally showing the "typing…" indicator.
     *
     * The WhatsApp Cloud API exposes the typing indicator on the read receipt: when
     * $typing is true the recipient sees "typing…" for ~25s or until the next outbound
     * message, giving immediate "we're working on it" feedback during processing.
     *
     * @param  string  $messageId  The inbound message to mark as read
     * @param  bool    $typing     Whether to also show the typing indicator
     * @return bool
     */
    public function markRead(string $messageId, bool $typing = false): bool;
}
