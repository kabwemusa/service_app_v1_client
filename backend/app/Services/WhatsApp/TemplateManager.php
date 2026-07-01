<?php

namespace App\Services\WhatsApp;

use App\Contracts\WhatsAppGateway;
use App\Models\ConversationState;
use Illuminate\Support\Facades\Log;

class TemplateManager
{
    private const TEMPLATES = [
        'provider_job_offer' => [
            'name'     => 'provider_job_offer',
            'category' => 'UTILITY',
            'body'     => 'New job request: {{1}} on {{2}} at {{3}}. Amount: K{{4}}. Reply to this message to respond.',
            'params'   => ['service_title', 'date', 'location', 'amount'],
        ],
        'booking_confirmation' => [
            'name'     => 'booking_confirmation',
            'category' => 'UTILITY',
            'body'     => 'Your booking for {{1}} on {{2}} is confirmed! Your provider {{3}} will be in touch. Booking ref: {{4}}.',
            'params'   => ['service_title', 'date', 'provider_name', 'booking_id'],
        ],
        'provider_on_the_way' => [
            'name'     => 'provider_on_the_way',
            'category' => 'UTILITY',
            'body'     => 'Your provider {{1}} is on the way for your {{2}} appointment. They should arrive shortly.',
            'params'   => ['provider_name', 'service_title'],
        ],
        'completion_confirmation' => [
            'name'     => 'completion_confirmation',
            'category' => 'UTILITY',
            'body'     => 'Your booking for {{1}} has been completed. We hope you had a great experience!',
            'params'   => ['service_title'],
        ],
        'review_request' => [
            'name'     => 'review_request',
            'category' => 'UTILITY',
            'body'     => 'How was your {{1}} experience? Reply with a rating from 1-5 to help other customers.',
            'params'   => ['service_title'],
        ],
        'payment_reminder' => [
            'name'     => 'payment_reminder',
            'category' => 'UTILITY',
            'body'     => 'Reminder: Your booking for {{1}} requires payment of K{{2}} to proceed. The payment window closes soon.',
            'params'   => ['service_title', 'amount'],
        ],
        're_engagement' => [
            'name'     => 're_engagement',
            'category' => 'MARKETING',
            'body'     => 'Hi {{1}}! It\'s been a while. Need a hand with anything? Reply "Hi" to browse our services.',
            'params'   => ['customer_name'],
        ],
    ];

    public function __construct(
        private readonly WhatsAppGateway $gateway,
    ) {}

    public function sendMessage(
        string $to,
        string $text,
        ?ConversationState $conversation = null,
    ): string {
        if ($this->isWithinSessionWindow($conversation)) {
            return $this->gateway->sendText($to, $text);
        }

        Log::info('TemplateManager: outside 24h window, text message blocked', ['to' => $to]);
        return '';
    }

    public function sendInteractive(
        string $to,
        array $interactive,
        ?ConversationState $conversation = null,
    ): string {
        if ($this->isWithinSessionWindow($conversation)) {
            return $this->gateway->sendInteractive($to, $interactive);
        }

        Log::info('TemplateManager: outside 24h window, interactive blocked', ['to' => $to]);
        return '';
    }

    public function sendTemplateMessage(
        string $to,
        string $templateKey,
        array $variables = [],
        ?ConversationState $conversation = null,
    ): string {
        $template = self::TEMPLATES[$templateKey] ?? null;

        if (! $template) {
            Log::error('TemplateManager: unknown template key', ['key' => $templateKey]);
            return '';
        }

        if (config('whatsapp.test_mode') && $this->isWithinSessionWindow($conversation)) {
            $text = $this->renderTemplateAsText($template, $variables);
            return $this->gateway->sendText($to, $text);
        }

        $components = [];
        if (! empty($variables)) {
            $params = [];
            foreach ($template['params'] as $i => $paramName) {
                $params[] = [
                    'type' => 'text',
                    'text' => (string) ($variables[$paramName] ?? $variables[$i] ?? ''),
                ];
            }
            $components[] = [
                'type'       => 'body',
                'parameters' => $params,
            ];
        }

        $lang = config('whatsapp.template_language', 'en');

        return $this->gateway->sendTemplate($to, $template['name'], $lang, $components);
    }

    public function sendProactiveOrTemplate(
        string $to,
        string $templateKey,
        array $variables,
        string $sessionFallbackText,
        ?ConversationState $conversation = null,
    ): string {
        if ($this->isWithinSessionWindow($conversation)) {
            return $this->gateway->sendText($to, $sessionFallbackText);
        }

        try {
            return $this->sendTemplateMessage($to, $templateKey, $variables, $conversation);
        } catch (\Throwable $e) {
            Log::warning('TemplateManager: template failed, trying session fallback', [
                'template' => $templateKey, 'error' => $e->getMessage(),
            ]);
            return $this->gateway->sendText($to, $sessionFallbackText);
        }
    }

    public function getTemplateRegistry(): array
    {
        return self::TEMPLATES;
    }

    private function isWithinSessionWindow(?ConversationState $conversation): bool
    {
        if (! $conversation) return false;
        return $conversation->isWithin24hWindow();
    }

    private function renderTemplateAsText(array $template, array $variables): string
    {
        $text = $template['body'];
        foreach ($template['params'] as $i => $paramName) {
            $value = (string) ($variables[$paramName] ?? $variables[$i] ?? '???');
            $placeholder = '{{' . ($i + 1) . '}}';
            $text = str_replace($placeholder, $value, $text);
        }
        return "[Template: {$template['name']}]\n{$text}";
    }
}
