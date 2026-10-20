<?php

declare(strict_types=1);

/**
 * The disks, and the one decision this service makes about them.
 *
 * Laravel serves the `local` disk at `/storage/{path}` and names that route `storage.local`. There is no operation for
 * it in the contract and there should not be: this tier answers JSON, and a path that hands out whatever is under
 * `storage/app/private` to anybody who guesses it is not an endpoint this product agreed to. `serve` is what registers
 * that route, so it is off — which is also how `tests/Contract/ContractTest.php` compares the router against the
 * contract and finds an undocumented endpoint before anybody deploys it.
 *
 * The rest is the framework's own shape, spelled out because this file replaces it: `local` is private application
 * storage, and `public` is the disk a later upload slice would link.
 */

return [
    'default' => env('FILESYSTEM_DISK', 'local'),

    'disks' => [
        'local' => [
            'driver' => 'local',
            'root' => storage_path('app/private'),
            'serve' => false,
            'throw' => false,
            'report' => false,
        ],

        'public' => [
            'driver' => 'local',
            'root' => storage_path('app/public'),
            'url' => env('APP_URL').'/storage',
            'visibility' => 'public',
            'throw' => false,
            'report' => false,
        ],
    ],

    'links' => [
        public_path('storage') => storage_path('app/public'),
    ],
];
