<?php

/**
 * What this node is, and the two things a node cannot borrow.
 *
 * `NODE_SECRET` is the node's own secret: it signs the leases on the number blocks the cloud reserves for this node,
 * which is what lets a node that has been offline for a week prove which numbers were its own when it drains. It is
 * per node and never shared between branches — two branches with one secret is one branch that can mint the other's
 * MRNs.
 *
 * `auth.secret` signs the preview tokens described in `App\Http\Middleware\Authenticate`: Keycloak is the intended
 * issuer (P0-205, ticket #24) and is not wired yet, and the honest thing is a signed token with a real expiry and a
 * named driver, not a middleware that lets everything through.
 */

declare(strict_types=1);

return [
    'node' => [
        'id' => env('DIZI_NODE_ID', 'cloud-1'),
        'branch' => env('DIZI_BRANCH', 'Main Campus'),
        'secret' => env('NODE_SECRET', ''),
    ],

    'auth' => [
        /* Two drivers, both implemented (P0-205, ticket #24). `preview` exchanges a token this repository signs for
           itself, which is what a checkout with no Keycloak runs; `keycloak` verifies a real OIDC access token
           against the realm's published keys. Which one is in force is a deployment decision and a named one —
           there is no fallback between them, because a verifier that falls back is a verifier that can be made to
           fall back. */
        'driver' => env('DIZI_AUTH_DRIVER', 'preview'),
        'drivers' => ['preview', 'keycloak'],
        'secret' => env('AUTH_PREVIEW_SECRET', ''),
        'leeway_seconds' => (int) env('AUTH_LEEWAY_SECONDS', 30),
    ],

    /* The realm the staff app signs in to (`infra/keycloak/realm-dizihospital.json`). Only read when the driver is
       `keycloak`; a service configured for it with no issuer refuses every request rather than guessing. */
    'oidc' => [
        'issuer' => env('OIDC_ISSUER', ''),
        'audience' => env('OIDC_AUDIENCE', 'dizi-api'),
        /* Keycloak publishes keys under the realm; the override is for deployments that front it with another name. */
        'jwks_uri' => env('OIDC_JWKS_URI', ''),
        /* How long a fetched key set is trusted. An hour is well inside Keycloak's own key rotation window, and a
           `kid` that is not in the cache forces one more fetch before a refusal, so a rotation mid-hour is a
           non-event rather than an outage. */
        'jwks_ttl_seconds' => (int) env('OIDC_JWKS_TTL_SECONDS', 3600),
        'timeout_seconds' => (int) env('OIDC_TIMEOUT_SECONDS', 5),
    ],

    'blocks' => [
        /* A block is leased, not owned: the lease is the answer to "how long may this node keep minting from it
           without being heard from", and it is short enough that a node which has gone away does not hold a year of
           numbers hostage. */
        'size' => (int) env('DIZI_BLOCK_SIZE', 500),
        'lease_hours' => (int) env('DIZI_BLOCK_LEASE_HOURS', 72),
        'series' => ['mrn', 'invoice', 'receipt'],
        'prefixes' => [
            'mrn' => env('DIZI_MRN_PREFIX', 'MRN'),
            'invoice' => env('DIZI_INVOICE_PREFIX', 'INV'),
            'receipt' => env('DIZI_RECEIPT_PREFIX', 'RCP'),
        ],
    ],

    'messaging' => [
        /* Which driver carries which channel. `preview` renders the sentence and records it, and every row it writes
           says `preview`, so a log of preview rows can never be read as evidence that a patient was told. The real
           drivers (`meta-cloud`, `smtp`) are what a branch with a paid account runs, and there is no fallback between
           them: a channel whose driver is misconfigured is refused, never quietly carried by something that sends
           nothing. */
        'channels' => [
            'whatsapp' => ['driver' => env('DIZI_WHATSAPP_DRIVER', 'preview')],
            'email' => ['driver' => env('DIZI_EMAIL_DRIVER', 'preview')],
        ],

        /* The WhatsApp Business account. Empty values are a `502` naming the missing setting rather than an attempt
           against a half-configured account. */
        'whatsapp' => [
            'graph_url' => env('DIZI_WHATSAPP_GRAPH_URL', 'https://graph.facebook.com/v21.0'),
            'phone_number_id' => env('DIZI_WHATSAPP_PHONE_NUMBER_ID', ''),
            'token' => env('DIZI_WHATSAPP_TOKEN', ''),
        ],

        /* Where the hospital's own notifications go — a low shelf, a sync conflict. A patient's address comes from the
           consent they gave and never from here. */
        'staff_address' => env('DIZI_STAFF_ADDRESS', ''),

        /* The sender an e-mail is from. Empty is a refusal: a message from nowhere is discarded by every relay. */
        'mail_from' => env('DIZI_MAIL_FROM', ''),
    ],

    'contract' => [
        /* The API reads the same contract the app generates its client from. The duplicate rules are the sharp end of
           that: one tunable table, two readers, so a branch that changes a weight changes it for the desk form and
           for the register at once. */
        'path' => env('DIZI_CONTRACT_PATH', dirname(__DIR__, 3).'/packages/contracts/openapi.json'),
    ],
];
