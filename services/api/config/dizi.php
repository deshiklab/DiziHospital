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
        /* `preview` verifies a signed token this repository issues to itself; `keycloak` is the destination and is
           not implemented until #24 lands. Naming them both keeps the gap legible instead of implied. */
        'driver' => env('DIZI_AUTH_DRIVER', 'preview'),
        'drivers' => ['preview', 'keycloak'],
        'secret' => env('AUTH_PREVIEW_SECRET', ''),
        'leeway_seconds' => (int) env('AUTH_LEEWAY_SECONDS', 30),
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

    'contract' => [
        /* The API reads the same contract the app generates its client from. The duplicate rules are the sharp end of
           that: one tunable table, two readers, so a branch that changes a weight changes it for the desk form and
           for the register at once. */
        'path' => env('DIZI_CONTRACT_PATH', dirname(__DIR__, 3).'/packages/contracts/openapi.json'),
    ],
];
