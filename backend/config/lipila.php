<?php

return [

    // Master switch for the real, money-moving gateway. When false the container
    // binds a stub/test gateway and the booking lifecycle runs synchronously.
    'enabled' => env('LIPILA_ENABLED', false),

    // Sandbox: https://api.lipila.dev
    // Live:    https://blz.lipila.io
    // (The *dashboards* are dashboard.lipila.dev / dashboard.lipila.io — those are
    // where the keys and the webhook signing secret live, not where we call.)
    'base_url' => env('LIPILA_BASE_URL', 'https://api.lipila.dev'),

    // Secret API key — server side ONLY, never shipped to a client. Sent as the
    // `x-api-key` header (NOT a Bearer token). Sandbox keys and live keys are
    // distinct; using the wrong one against an environment returns 401.
    'api_key' => env('LIPILA_API_KEY'),

    // Lipila scopes a key to a wallet, and a collections wallet is not necessarily
    // authorised to disburse — an unauthorised key gets a bare 401 on
    // /disbursements/*. Set this when the merchant has a separate disbursement
    // wallet key; blank falls back to `api_key`.
    'disbursement_api_key' => env('LIPILA_DISBURSEMENT_API_KEY'),

    'currency' => env('LIPILA_CURRENCY', 'ZMW'),

    // Narration shown on the transaction. Lipila REQUIRES it on collections and
    // validates 3–200 characters, so it is never allowed to be empty.
    'narration' => env('LIPILA_NARRATION', 'Sebenza'),

    // Prefix on every reference we generate. Lipila's only hard rule is that
    // referenceId is unique per merchant (a repeat is a 400 "Duplicate reference
    // ID attempted"); the `sbz-dep-` style prefix makes references self-describing
    // in Lipila's dashboard and in our own logs.
    'reference_prefix' => env('LIPILA_REFERENCE_PREFIX', 'sbz'),

    // Absolute URL Lipila posts transaction outcomes to. Sent per-request as the
    // `callbackUrl` HEADER (Lipila's callback target is per-transaction, not a
    // dashboard-wide setting). Blank falls back to route('lipila.webhook').
    'callback_url' => env('LIPILA_CALLBACK_URL'),

    // Zambian MSISDN prefix → MNO label. Lipila resolves the operator itself from
    // accountNumber (it returns `paymentType`: MtnMoney | AirtelMoney |
    // ZamtelKwacha), so this is NOT used for payment routing — only for
    // admin-facing MNO grouping via MnoResolver. Matched on the local 0-form.
    'prefix_map' => [
        '097' => 'airtel',
        '077' => 'airtel',
        '096' => 'mtn',
        '076' => 'mtn',
        '095' => 'zamtel',
        '075' => 'zamtel',
    ],

    'timeout' => [
        'write' => (int) env('LIPILA_HTTP_WRITE_TIMEOUT', 30),
        'read'  => (int) env('LIPILA_HTTP_READ_TIMEOUT', 15),
    ],

    'webhook' => [
        // Standard Webhooks signing secret: a base64-encoded 32-byte key from the
        // dashboard under Settings → Webhooks. NOT derived from the API key.
        'secret' => env('LIPILA_WEBHOOK_SECRET'),

        // Reject unsigned/badly-signed webhooks. Only turn this off to replay a
        // captured payload locally — NEVER in production.
        'verify_signature' => env('LIPILA_WEBHOOK_VERIFY', true),

        // Reject webhooks whose `webhook-timestamp` is older than this many
        // seconds (replay-attack window). Standard Webhooks specifies 300.
        'tolerance' => (int) env('LIPILA_WEBHOOK_TOLERANCE', 300),
    ],

    // SANDBOX TESTING ONLY. When set (and base_url points at the sandbox), every
    // collection's payer MSISDN is replaced with this number so the outcome is
    // deterministic and no real handset is prompted. Leave UNSET in production.
    // Format is the same 260XXXXXXXXX Lipila expects everywhere.
    'sandbox_force_payer' => env('LIPILA_SANDBOX_FORCE_PAYER'),

    // Minutes a `Pending` collection may sit unanswered before the funding window
    // is treated as expired.
    'collection_timeout_minutes' => (int) env('LIPILA_COLLECTION_TIMEOUT', 15),
];
